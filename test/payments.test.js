const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const realStripe=require('stripe');
const engine=new PGlite();let createCalls=0,refundCalls=0;
const sessions=new Map(),keys=new Map(),charges=new Map(),unavailableSessions=new Set();let retrieveCalls=0;
const fake={webhooks:realStripe.webhooks,checkout:{sessions:{
 async create(p,o){createCalls++;if(keys.has(o.idempotencyKey))return sessions.get(keys.get(o.idempotencyKey));const id='cs_test_'+crypto.randomBytes(6).toString('hex');const s={...p,id,amount_total:p.line_items[0].price_data.unit_amount,currency:'eur',status:'open',payment_status:'unpaid',payment_intent:null,livemode:false,url:'https://checkout.stripe.com/c/pay/'+id};sessions.set(id,s);keys.set(o.idempotencyKey,id);return s;},
 async retrieve(id){retrieveCalls++;if(unavailableSessions.has(id))throw new Error('Stripe temporarily unavailable');return structuredClone(sessions.get(id));},async list(){return {data:[...sessions.values()],has_more:false};}
}},paymentIntents:{async retrieve(id){const s=[...sessions.values()].find(s=>s.payment_intent===id);return {id,status:'succeeded',currency:'eur',amount_received:s.amount_total,metadata:s.metadata,latest_charge:structuredClone(charges.get(id))};}},refunds:{async create({payment_intent}){refundCalls++;charges.get(payment_intent).amount_refunded=charges.get(payment_intent).amount;return {id:'re_test_'+payment_intent,status:'succeeded'};}}};
const stripePath=require.resolve('stripe');require.cache[stripePath]={id:stripePath,filename:stripePath,loaded:true,exports:function(){return fake;}};
let gate=Promise.resolve();
class Pool{on(){}async query(sql,values){if(values===undefined&&sql.includes(';'))return (await engine.exec(sql)).at(-1)||{rows:[]};return engine.query(sql,values);}async connect(){let release;const wait=gate;gate=new Promise(r=>release=r);await wait;return {query:this.query.bind(this),release};}}
const pgPath=require.resolve('pg');require.cache[pgPath]={id:pgPath,filename:pgPath,loaded:true,exports:{Pool}};
Object.assign(process.env,{DATABASE_URL:'postgres://test',ADMIN_PASSWORD:'test-only-admin-password-32-characters',STRIPE_SECRET_KEY:'sk_test_local',STRIPE_WEBHOOK_SECRET:'whsec_test_local',PAYMENTS_ENABLED:'true'});
const {initDB,getPool}=require('../src/db');const app=require('../src/app');const payments=require('../src/services/payments');const {windowFor}=require('../src/services/availability');const config=require('../src/config');
const day=()=>new Date(Date.now()+10*86400000).toISOString().slice(0,10);
function body(){return {requestId:crypto.randomUUID(),privacyAccepted:true,termsAccepted:true,termsVersion:'2026-11-17',expectedTotalCents:32000,customer:{name:'Payment Guest',email:'guest@example.com',phone:'+393200000000'},booking:{tourId:'roma-iconica',date:day(),time:'10:30',people:2,extraStops:0,hotel:'Test Hotel Rome',lang:'en'}};}
function pay(session){session.status='complete';session.payment_status='paid';session.payment_intent='pi_'+session.id;charges.set(session.payment_intent,{id:'ch_'+session.id,amount:session.amount_total,amount_refunded:0});}
test('Stripe checkout: server prices, idempotency, signatures, fleet overlap, refunds and admin integrity',async()=>{
 await initDB();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 let ip=0;async function call(path,data,headers={}){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-Forwarded-For':'192.0.2.'+(++ip),...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),headers:r.headers};}
 async function event(session,type='checkout.session.completed',id='evt_'+crypto.randomUUID()){
  const payload=JSON.stringify({id,type,data:{object:{id:session.id}}});const signature=realStripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
  const r=await fetch(base+'/webhooks/stripe',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});return {status:r.status,id};
 }
 try{
  assert.equal((await call('/booking/config')).data.paymentsEnabled,true);
  const bad=body();bad.expectedTotalCents=1;assert.equal((await call('/checkout/session',bad)).status,409);assert.equal(createCalls,0);
  delete bad.termsAccepted;assert.equal((await call('/checkout/session',bad)).status,422);
  const b=body(),first=await call('/checkout/session',b);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.booking.total,320);assert.equal(first.data.booking.status,'awaiting_payment');
  const again=await call('/checkout/session',b);assert.equal(again.data.url,first.data.url);assert.equal(createCalls,1);
  const conflicting=structuredClone(b);conflicting.customer.name='Another Guest';assert.equal((await call('/checkout/session',conflicting)).status,409);
  const session=[...sessions.values()][0];pay(session);
  assert.equal((await call('/webhooks/stripe',{bad:true},{'stripe-signature':'forged'})).status,400);
  const webhook=await event(session);assert.equal(webhook.status,200);assert.equal((await event(session,undefined,webhook.id)).status,200);
  const token=first.data.accessToken;assert.equal((await call('/booking/status',{token})).data.paymentStatus,'paid');
  assert.equal((await getPool().query("SELECT COUNT(*) FROM notification_outbox WHERE kind='paid'")).rows[0].count,2);
  assert.equal((await call('/booking/status',{token:'0'.repeat(64)})).status,404);
  const login=await call('/ogre/api/login',{password:process.env.ADMIN_PASSWORD});const cookie=login.headers.get('set-cookie').split(';')[0];
  const list=await call('/ogre/api/requests',null,{Cookie:cookie});const r=list.data.requests[0];
  assert.equal((await call('/ogre/api/requests/'+r.id,{status:'confirmed',paymentStatus:'refunded',notes:'',version:r.updated_at},{Cookie:cookie,'x-csrf-token':login.data.csrf})).status,409);
  assert.equal((await call('/booking/cancel',{token,confirmed:true})).data.paymentStatus,'paid');
  assert.ok((await call('/booking/status',{token})).data.cancellationRequestedAt);assert.equal(refundCalls,0);
  await payments.reconcile();assert.equal(refundCalls,0);
  const current=(await call('/ogre/api/requests',null,{Cookie:cookie})).data.requests[0];
  const approval={confirmed:true,amountCents:32000,version:current.updated_at};
  assert.equal((await call('/ogre/api/requests/'+current.id+'/refund',approval)).status,401);
  assert.equal((await call('/ogre/api/requests/'+current.id+'/refund',approval,{Cookie:cookie})).status,403);
  assert.equal((await call('/ogre/api/requests/'+current.id+'/refund',approval,{Cookie:cookie,'x-csrf-token':login.data.csrf})).data.paymentStatus,'refunded');
  assert.equal((await call('/ogre/api/requests/'+current.id+'/refund',approval,{Cookie:cookie,'x-csrf-token':login.data.csrf})).data.paymentStatus,'refunded');assert.equal(refundCalls,1);
  assert.equal((await event(session)).status,200);assert.equal((await call('/booking/status',{token})).data.status,'cancelled');
  // New different departures overlapping the same 8 carts are counted together.
  for(let i=0;i<8;i++){const req=body();req.booking.time=i%2?'12:00':'10:30';assert.equal((await call('/checkout/session',req)).status,200);}
  const ninth=await call('/checkout/session',body());assert.equal(ninth.status,409);assert.equal(ninth.data.error,'SOLD_OUT');
  const available=await call('/availability?'+new URLSearchParams({tourId:'roma-iconica',date:day(),extraStops:0}));assert.equal(available.data.slots.find(s=>s.time==='10:30').available,false);assert.equal(available.data.slots.find(s=>s.time==='17:30').available,true);
  const open=[...sessions.values()][1];open.status='expired';assert.equal((await event(open,'checkout.session.expired')).status,200);
  assert.equal((await call('/checkout/session',body())).status,200);
  const mismatched=[...sessions.values()][2];pay(mismatched);mismatched.amount_total=1;assert.equal((await event(mismatched)).status,409);mismatched.amount_total=32000;
  await event(mismatched);const paidRow=(await getPool().query('SELECT * FROM bookings WHERE checkout_session_id=$1',[mismatched.id])).rows[0];
  await getPool().query("UPDATE bookings SET start_at=NOW()+INTERVAL '23 hours' WHERE id=$1",[paidRow.id]);
  assert.equal((await call('/booking/cancel',{token:paidRow.access_token,confirmed:true})).status,409);assert.equal(refundCalls,1);
  assert.equal(+windowFor({tourId:'roma-iconica',date:'2027-01-15',time:'10:30'}).start,Date.parse('2027-01-15T09:30:00Z'));
  // No webhook secret: the server verifies canonical Stripe data on customer return.
  config.stripeWebhookSecret='';
  assert.equal((await call('/booking/config')).data.paymentsEnabled,true);
  assert.equal((await call('/webhooks/stripe',{bad:true})).status,503);
  const directBody=body();directBody.booking.date=new Date(Date.now()+12*86400000).toISOString().slice(0,10);
  const direct=await call('/checkout/session',directBody);assert.equal(direct.status,200);
  const directRow=await payments.tokenBooking(direct.data.accessToken),directSession=sessions.get(directRow.checkout_session_id);
  const pending=await call('/booking/status',{token:direct.data.accessToken,paid:true});
  assert.equal(pending.data.paymentStatus,'unpaid');assert.equal(pending.data.status,'awaiting_payment');
  const reads=retrieveCalls;await call('/booking/status',{token:direct.data.accessToken});assert.equal(retrieveCalls,reads);
  pay(directSession);await getPool().query('UPDATE bookings SET stripe_checked_at=NULL WHERE id=$1',[directRow.id]);
  unavailableSessions.add(directSession.id);
  assert.equal((await call('/booking/status',{token:direct.data.accessToken})).data.paymentStatus,'unpaid');
  unavailableSessions.delete(directSession.id);await getPool().query('UPDATE bookings SET stripe_checked_at=NULL WHERE id=$1',[directRow.id]);
  assert.equal((await call('/booking/status',{token:direct.data.accessToken})).data.paymentStatus,'paid');
  assert.equal((await getPool().query("SELECT COUNT(*) FROM notification_outbox WHERE booking_id=$1 AND kind='paid'",[directRow.id])).rows[0].count,2);
  // A refund issued in the Stripe dashboard is discovered without a webhook.
  charges.get(directSession.payment_intent).amount_refunded=32000;
  await getPool().query('UPDATE bookings SET stripe_checked_at=NULL WHERE id=$1',[directRow.id]);await payments.reconcile();
  assert.equal((await payments.tokenBooking(direct.data.accessToken)).payment_status,'refunded');assert.equal(refundCalls,1);
  // More than one batch: unpaid older sessions cannot starve a paid customer who closed the browser.
  await getPool().query("UPDATE bookings SET stripe_checked_at=NOW()+INTERVAL '1 hour'");config.fleetSize=100;
  const fresh=[];
  for(let i=0;i<26;i++){const req=body();req.booking.date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);const result=await call('/checkout/session',req);assert.equal(result.status,200);fresh.push(await payments.tokenBooking(result.data.accessToken));}
  const last=fresh.at(-1),lastSession=sessions.get(last.checkout_session_id);pay(lastSession);
  await payments.reconcile();assert.equal((await payments.tokenBooking(last.access_token)).payment_status,'unpaid');
  await payments.reconcile();assert.equal((await payments.tokenBooking(last.access_token)).payment_status,'paid');
  assert.equal((await getPool().query("SELECT COUNT(*) FROM notification_outbox WHERE booking_id=$1 AND kind='paid'",[last.id])).rows[0].count,2);
  // Cancellation and background reconciliation still never initiate refunds.
  await call('/booking/cancel',{token:last.access_token,confirmed:true});await payments.reconcile();assert.equal(refundCalls,1);
  const expired=fresh[0];sessions.get(expired.checkout_session_id).status='expired';
  await getPool().query('UPDATE bookings SET stripe_checked_at=NULL WHERE id=$1',[expired.id]);await payments.reconcile();
  assert.equal((await payments.tokenBooking(expired.access_token)).checkout_state,'expired');
  const overview=await call('/ogre/api/overview',null,{Cookie:cookie});assert.equal(overview.data.paymentVerification,'api-polling');assert.equal(overview.data.paymentMode,'test');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await engine.close();}
});
