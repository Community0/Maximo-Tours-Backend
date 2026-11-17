'use strict';
const crypto=require('node:crypto');
const Stripe=require('stripe');
const config=require('../config');
const {getPool}=require('../db');
const {computeQuote}=require('./catalog');
const {validateRequest}=require('./requests');
const {windowFor,remaining}=require('./availability');
let stripeClient;
function stripe(){if(!config.stripeSecretKey)throw failure(503,'PAYMENTS_UNAVAILABLE');return stripeClient||(stripeClient=new Stripe(config.stripeSecretKey,{apiVersion:'2024-12-18.acacia',timeout:12000,maxNetworkRetries:2}));}
function failure(status,code){return Object.assign(new Error(code),{status,code});}
const tokenOK=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const page=(lang)=>config.siteUrl+(lang==='en'?'/':'/'+lang+'/')+'checkout.html';
function manageURL(row){return page(row.breakdown.lang)+'#booking='+row.access_token;}
function publicBooking(row){return {bookingId:row.id,status:row.status,paymentStatus:row.payment_status,checkoutState:row.checkout_state,tourId:row.breakdown.tourId,tourName:row.tour,date:row.date,time:row.time,people:Number(row.people),extraStops:row.breakdown.extraStops||0,total:Number(row.amount),refunded:Number(row.refunded_cents)/100,currency:'eur',lang:row.breakdown.lang,cancellationDeadline:new Date(+new Date(row.start_at)-config.cancellationHours*3600000).toISOString(),cancellationRequestedAt:row.cancellation_requested_at||null,canCancel:!row.cancellation_requested_at&&row.payment_status==='paid'&&row.status==='confirmed'&&+new Date(row.start_at)-Date.now()>=config.cancellationHours*3600000};}
async function tokenBooking(token){if(!tokenOK(token))throw failure(404,'BOOKING_NOT_FOUND');const r=await getPool().query("SELECT * FROM bookings WHERE access_token=$1 AND channel='maximo-web'",[token]);if(!r.rows.length)throw failure(404,'BOOKING_NOT_FOUND');return r.rows[0];}
async function queue(client,id,kind){for(const audience of ['admin','customer'])await client.query('INSERT INTO notification_outbox(id,booking_id,kind,audience) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[id+'-'+kind+'-'+audience,id,kind,audience]);}
async function ensureSession(row){
 if(row.checkout_session_id)return row;
 if(row.checkout_state!=='creating')return row;
 // A fixed payload and idempotency key recover timeouts without a second charge.
 if(+new Date(row.checkout_expires_at)-Date.now()<31*60000)throw failure(409,'CHECKOUT_RECOVERING');
 const session=await stripe().checkout.sessions.create({mode:'payment',payment_method_types:['card'],locale:row.breakdown.lang,customer_email:row.email,client_reference_id:row.id,
  metadata:{bookingId:row.id},payment_intent_data:{metadata:{bookingId:row.id}},
  line_items:[{quantity:1,price_data:{currency:'eur',unit_amount:row.stripe_amount_cents,product_data:{name:'Maximo Tours — '+row.tour,description:row.date+' · '+row.time+' Europe/Rome · '+row.people+' guests · private golf cart'}}}],
  expires_at:Math.floor(+new Date(row.checkout_expires_at)/1000),success_url:manageURL(row),cancel_url:manageURL(row),
 },{idempotencyKey:'maximo-checkout-'+row.id});
 await getPool().query(`UPDATE bookings SET checkout_session_id=$2,checkout_url=$3,checkout_state=CASE WHEN checkout_state='creating' THEN 'open' ELSE checkout_state END,updated_at=NOW() WHERE id=$1`,[row.id,session.id,session.url]);
 return (await getPool().query('SELECT * FROM bookings WHERE id=$1',[row.id])).rows[0];
}
async function beginCheckout(body){
 if(!config.paymentReady())throw failure(503,'PAYMENTS_UNAVAILABLE');
 let data;try{data=validateRequest(body, new Date(), {allowToday:true});}catch{throw failure(422,'INVALID_DETAILS');}
 if(body.termsAccepted!==true||body.termsVersion!==config.termsVersion)throw failure(422,'TERMS_REQUIRED');
 data.time=body.booking.time;data.termsVersion=config.termsVersion;
 const window=windowFor(data),hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const quote=await computeQuote(data);if(!quote.ok)throw failure(422,'INVALID_QUOTE');
 if(!Number.isInteger(body.expectedTotalCents)||body.expectedTotalCents!==quote.totalCents)throw failure(409,'PRICE_CHANGED');
 const client=await getPool().connect();let row;
 try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.requestId]);
  const old=await client.query('SELECT b.*,k.payload_hash FROM request_keys k JOIN bookings b ON b.id=k.booking_id WHERE k.key=$1',[data.requestId]);
  if(old.rows.length){row=old.rows[0];if(row.payload_hash!==hash)throw failure(409,'REQUEST_CONFLICT');}
  else{
   // One fleet lock across replicas protects overlapping tours, not just identical slots.
   await client.query('SELECT pg_advisory_xact_lock(78243191)');
   if((await client.query('SELECT date FROM blocked_dates WHERE date=$1',[data.date])).rows.length||await remaining(client,window)<1)throw failure(409,'SOLD_OUT');
   const id='MX'+crypto.randomUUID().replaceAll('-',''),token=crypto.randomBytes(32).toString('hex');
   const expires=new Date(Math.floor(Date.now()/1000)*1000+40*60000);
   const result=await client.query(`INSERT INTO bookings(id,name,email,phone,tour,people,date,time,notes,payment_method,status,amount,breakdown,channel,payment_status,access_token,start_at,end_at,checkout_state,checkout_expires_at,stripe_amount_cents)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'stripe','awaiting_payment',$10,$11,'maximo-web','unpaid',$12,$13,$14,'creating',$15,$16) RETURNING *`,
    [id,data.name,data.email,data.phone,quote.tourName,String(data.people),data.date,data.time,data.notes,quote.total,JSON.stringify({...quote,hotel:data.hotel,lang:data.lang,extraStops:data.extraStops,termsVersion:config.termsVersion,cancellationHours:24,acceptedAt:new Date().toISOString()}),token,window.start,window.end,expires,quote.totalCents]);row=result.rows[0];
   await client.query('INSERT INTO request_keys(key,payload_hash,booking_id) VALUES($1,$2,$3)',[data.requestId,hash,id]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 try{row=await ensureSession(row);}catch(e){e.accessToken=row.access_token;throw e;}
 if(row.checkout_state==='expired')throw failure(410,'CHECKOUT_EXPIRED');
 return {accessToken:row.access_token,url:row.payment_status==='paid'?manageURL(row):row.checkout_url,booking:publicBooking(row)};
}
async function syncSession(sessionId,eventId){
 const session=await stripe().checkout.sessions.retrieve(sessionId);
 const id=session.metadata?.bookingId;
 if(!id?.startsWith('MX'))return;
 const intentId=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
 let charge;
 if(intentId&&session.payment_status==='paid'){
  const pi=await stripe().paymentIntents.retrieve(intentId,{expand:['latest_charge']});
  charge=typeof pi.latest_charge==='object'?pi.latest_charge:null;
 }
 const client=await getPool().connect();
 try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(78243191)');
  const row=(await client.query("SELECT * FROM bookings WHERE id=$1 AND payment_method='stripe' FOR UPDATE",[id])).rows[0];
  if(!row){await client.query('COMMIT');return;}
  if((row.checkout_session_id&&row.checkout_session_id!==session.id)||session.client_reference_id!==row.id||session.mode!=='payment'||session.currency!=='eur'||session.amount_total!==row.stripe_amount_cents||session.livemode!==config.stripeSecretKey.startsWith('sk_live_'))throw failure(409,'PAYMENT_MISMATCH');
  if(session.payment_status==='paid'){
   const refunded=Math.max(row.refunded_cents,charge?.amount_refunded||0),full=refunded>=row.stripe_amount_cents;
   const payment=full?'refunded':refunded?'partially_refunded':row.payment_status==='refund_failed'?'refund_failed':row.refund_requested_at?'refund_pending':'paid';
   const status=full?'cancelled':row.status==='completed'?'completed':'confirmed';
   await client.query(`UPDATE bookings SET checkout_session_id=$2,stripe_payment_id=$3,checkout_state='complete',payment_status=$4,status=$5,refunded_cents=$6,paid_at=COALESCE(paid_at,NOW()),updated_at=NOW() WHERE id=$1`,[id,session.id,intentId,payment,status,refunded]);
   // Delayed/out-of-order events cannot reverse a refund or send a false confirmation.
   if(payment==='paid')await queue(client,id,'paid');
   if(full)await queue(client,id,'refunded');
  }else if(session.status==='expired'&&!row.paid_at){
   await client.query("UPDATE bookings SET checkout_state='expired',status='cancelled',updated_at=NOW() WHERE id=$1",[id]);
  }
  if(eventId)await client.query('INSERT INTO stripe_events(id,type) VALUES($1,$2) ON CONFLICT DO NOTHING',[eventId,'checkout']);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
async function webhook(req,res){
 if(!config.stripeWebhookSecret)return res.status(503).json({error:'WEBHOOK_NOT_CONFIGURED'});
 let event;try{event=stripe().webhooks.constructEvent(req.body,req.get('stripe-signature'),config.stripeWebhookSecret);}catch{return res.status(400).json({error:'INVALID_SIGNATURE'});}
 if((await getPool().query('SELECT id FROM stripe_events WHERE id=$1',[event.id])).rows.length)return res.json({received:true});
 if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))await syncSession(event.data.object.id,event.id);
 else if(['charge.refunded','refund.updated','refund.failed'].includes(event.type)){
  const pi=event.data.object.payment_intent;
  const result=await getPool().query('SELECT checkout_session_id FROM bookings WHERE stripe_payment_id=$1',[typeof pi==='string'?pi:pi?.id]);
  if(result.rows[0]?.checkout_session_id)await syncSession(result.rows[0].checkout_session_id,event.id);
 }
 res.json({received:true});
}
async function finishRefund(row,allowCreate=false){
 if(!row.refund_requested_at||row.refunded_cents>=row.stripe_amount_cents)return row;
 if(!row.stripe_refund_id){
  // Only an explicit, authenticated admin action may start a refund.
  if(!allowCreate)return row;
  if(Date.now()-new Date(row.refund_requested_at).getTime()>23*3600000)throw failure(409,'REFUND_REQUIRES_REVIEW');
  const refund=await stripe().refunds.create({payment_intent:row.stripe_payment_id,metadata:{bookingId:row.id},reason:'requested_by_customer'},{idempotencyKey:'maximo-cancellation-'+row.id});
  await getPool().query('UPDATE bookings SET stripe_refund_id=$2,updated_at=NOW() WHERE id=$1',[row.id,refund.id]);
  row.stripe_refund_id=refund.id;
 }
 if(stripe().refunds.retrieve){const refund=await stripe().refunds.retrieve(row.stripe_refund_id);if(['failed','canceled'].includes(refund.status)){await getPool().query("UPDATE bookings SET payment_status='refund_failed',updated_at=NOW() WHERE id=$1",[row.id]);await queue(getPool(),row.id,'refund_failed');return tokenBooking(row.access_token);}}
 await syncSession(row.checkout_session_id);
 return tokenBooking(row.access_token);
}
async function cancelBooking(token){
 const original=await tokenBooking(token),client=await getPool().connect();let row;
 try{await client.query('BEGIN');row=(await client.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[original.id])).rows[0];
  if(!row.cancellation_requested_at){
   if(row.payment_status!=='paid'||row.status!=='confirmed')throw failure(409,'CANNOT_CANCEL');
   if(+new Date(row.start_at)-Date.now()<24*3600000)throw failure(409,'CANCELLATION_DEADLINE');
   row=(await client.query('UPDATE bookings SET cancellation_requested_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *',[row.id])).rows[0];
   await client.query("INSERT INTO audit_log(entity,entity_id,action,after) VALUES('booking',$1,'customer_cancellation_request',$2)",[row.id,JSON.stringify({requestedAt:row.cancellation_requested_at})]);
   await queue(client,row.id,'cancellation_requested');
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 return publicBooking(row);
}
async function approveRefund(id,input,admin){
 if(input?.confirmed!==true||!Number.isInteger(input.amountCents))throw failure(422,'REFUND_CONFIRMATION_REQUIRED');
 const client=await getPool().connect();let row;
 try{await client.query('BEGIN');row=(await client.query("SELECT * FROM bookings WHERE id=$1 AND channel='maximo-web' AND payment_method='stripe' FOR UPDATE",[id])).rows[0];
  if(!row)throw failure(404,'BOOKING_NOT_FOUND');
  if(row.payment_status==='refunded'){await client.query('COMMIT');return publicBooking(row);}
  if(!row.stripe_payment_id||!['paid','partially_refunded','refund_pending'].includes(row.payment_status))throw failure(409,'REFUND_NOT_AVAILABLE');
  if(row.stripe_amount_cents-row.refunded_cents!==input.amountCents)throw failure(409,'REFUND_AMOUNT_CHANGED');
  if(!row.refund_requested_at){
   if(+new Date(row.updated_at)!==+new Date(input.version))throw failure(409,'BOOKING_CHANGED');
   row=(await client.query("UPDATE bookings SET refund_requested_at=NOW(),payment_status='refund_pending',updated_at=NOW() WHERE id=$1 RETURNING *",[id])).rows[0];
   await client.query("INSERT INTO audit_log(entity,entity_id,action,after) VALUES('booking',$1,'admin_refund_approved',$2)",[id,JSON.stringify({amountCents:input.amountCents,session:admin.tokenHash.slice(0,12),approvedAt:row.refund_requested_at})]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 return publicBooking(await finishRefund(row,true));
}
let reconcileBusy=false;
async function reconcile(){
 if(reconcileBusy||!config.stripeSecretKey||!getPool())return;reconcileBusy=true;
 try{
  const rows=(await getPool().query(`SELECT * FROM bookings WHERE payment_method='stripe' AND (checkout_state IN ('creating','open') OR payment_status='refund_pending') ORDER BY updated_at LIMIT 25`)).rows;
  for(let row of rows){try{
   if(row.checkout_state==='creating'){
    // Retry the exact create call, including after a timeout. Stripe retains the idempotency key for 24h.
    if(+new Date(row.created_at)+23*3600000>Date.now()){
     const paramsTime=+new Date(row.checkout_expires_at)-Date.now();
     if(paramsTime>=31*60000)row=await ensureSession(row);
     else{
      // Resolve a possibly created session before releasing inventory. No blind expiry of holds.
      const list=await stripe().checkout.sessions.list({created:{gte:Math.floor(+new Date(row.created_at)/1000)-5},limit:100});
      const found=list.data.find(s=>s.client_reference_id===row.id);
      if(found){await getPool().query('UPDATE bookings SET checkout_session_id=$2,checkout_state=$3 WHERE id=$1',[row.id,found.id,'open']);row.checkout_session_id=found.id;}
      else if(!list.has_more&&+new Date(row.checkout_expires_at)<Date.now())await getPool().query("UPDATE bookings SET checkout_state='expired',status='cancelled' WHERE id=$1 AND checkout_state='creating'",[row.id]);
     }
    }
   }
   if(row.checkout_session_id)await syncSession(row.checkout_session_id);
   if(row.refund_requested_at)await finishRefund(row);
  }catch{console.error('Payment reconciliation pending:',row.id);}}
 }finally{reconcileBusy=false;}
}
function startReconciliation(){const timer=setInterval(()=>reconcile().catch(()=>console.error('Payment reconciliation unavailable')),30000);timer.unref();reconcile().catch(()=>{});return ()=>clearInterval(timer);}
module.exports={beginCheckout,webhook,tokenBooking,publicBooking,cancelBooking,approveRefund,syncSession,startReconciliation,reconcile,manageURL,queue};
