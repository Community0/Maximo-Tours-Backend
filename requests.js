const crypto=require('node:crypto');
const locales=['en','it','fr','es','de'];
function validateRequest(body,now=new Date(),options={}){
 if(!body||typeof body!=='object')throw new Error('Invalid request');
 const {customer:c,booking:b}=body;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestId||''))throw new Error('A UUID v4 requestId is required');
 if(!c||!b||body.privacyAccepted!==true)throw new Error('Customer, booking and privacy acceptance are required');
 const clean=(v,max)=>typeof v==='string'&&v.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(v)?v.trim():'';
 const name=clean(c.name,120),email=clean(c.email,254).toLowerCase(),phone=clean(c.phone,32).replace(/[ ()-]/g,'');
 if(name.length<2||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Valid name, email and international phone are required');
 if(!locales.includes(b.lang))throw new Error('Unsupported language');
 if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date))throw new Error('Invalid date');
 const parsed=new Date(b.date+'T12:00:00Z');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==b.date||(options.allowToday?b.date<today:b.date<=today)||parsed-now>730*86400000)throw new Error('Choose a future date within two years');
 if(typeof b.notes!=='undefined'&&(typeof b.notes!=='string'||b.notes.length>2000))throw new Error('Notes must be at most 2000 characters');
 const hotel=clean(b.hotel,200);if(!hotel)throw new Error('Hotel or pickup address is required');
 if(!Number.isInteger(b.people)||b.people<1||b.people>7)throw new Error('Guests must be 1 to 7');
 const extraStops=b.extraStops??0;if(!Number.isInteger(extraStops)||extraStops<0||extraStops>6)throw new Error('Invalid extra stops');
 return {requestId:body.requestId.toLowerCase(),name,email,phone,tourId:clean(b.tourId,64),people:b.people,extraStops,date:b.date,notes:(b.notes||'').trim(),hotel,lang:b.lang,privacyAccepted:true};
}
function createRequestHandler({getPool,computeQuote}){
 return async(req,res)=>{
  let data;try{data=validateRequest(req.body);}catch(e){return res.status(422).json({error:e.message});}
  const hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  // Resolve the catalogue before reserving a connection for the transaction.
  const quote=await computeQuote(data);
  const client=await getPool().connect();
  try{
   await client.query('BEGIN');
   // Serializes simultaneous submissions of the same idempotency key across replicas.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.requestId]);
   const existing=await client.query(`SELECT k.payload_hash,b.id,b.amount,b.status FROM request_keys k JOIN bookings b ON b.id=k.booking_id WHERE k.key=$1`,[data.requestId]);
   if(existing.rows.length){
    await client.query('COMMIT');const row=existing.rows[0];
    if(row.payload_hash!==hash)return res.status(409).json({error:'This requestId was already used with different details'});
    return res.status(200).json({requestId:data.requestId,bookingId:row.id,status:row.status,total:Number(row.amount),currency:'eur',duplicate:true});
   }
   if(!quote.ok){await client.query('ROLLBACK');return res.status(422).json({error:quote.error});}
   const blocked=await client.query('SELECT date FROM blocked_dates WHERE date=$1',[data.date]);
   if(blocked.rows.length){await client.query('ROLLBACK');return res.status(409).json({error:'This date is unavailable'});}
   const id='MX'+crypto.randomUUID().replaceAll('-','');
   await client.query(`INSERT INTO bookings(id,name,email,phone,tour,people,date,notes,payment_method,status,amount,breakdown,channel,payment_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'not_collected','pending',$9,$10,'maximo-web','unpaid')`,
    [id,data.name,data.email,data.phone,quote.tourName,String(data.people),data.date,data.notes,quote.total,JSON.stringify({...quote,hotel:data.hotel,lang:data.lang,extraStops:data.extraStops,privacyAcceptedAt:new Date().toISOString()})]);
   await client.query('INSERT INTO request_keys(key,payload_hash,booking_id) VALUES($1,$2,$3)',[data.requestId,hash,id]);
   await client.query('INSERT INTO notification_outbox(id,booking_id) VALUES($1,$2)',[id+'-admin',id]);
   await client.query('COMMIT');
   return res.status(201).json({requestId:data.requestId,bookingId:id,status:'pending',total:quote.total,currency:'eur',paymentCollected:false});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 };
}
module.exports={validateRequest,createRequestHandler};
