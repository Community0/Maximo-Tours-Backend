'use strict';
const crypto=require('node:crypto');
const {getPool}=require('../db');
const config=require('../config');
const {computeQuote}=require('./catalog');
const {romeSlotEpoch}=require('./booking-time');
const {remaining}=require('./availability');
const C=require('./operations-common');
const sources=['phone','whatsapp','hotel','email','walk-in','partner','other'];
const durations={'roma-iconica':150,'roma-completa':180,'la-dolce-vita':180,'roma-by-night':150};
function details(input){
 const name=C.text(input.name,150,true),email=C.text(input.email,254),phone=C.text(input.phone,40,true);
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw C.fail(422,'Email non valida.');
 if(!/^[+\d\s().-]{6,40}$/.test(phone))throw C.fail(422,'Telefono non valido.');
 if(!Object.hasOwn(durations,input.tourId)||!C.day(input.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw C.fail(422,'Tour, data o orario non validi.');
 if(!Number.isInteger(input.extraStops)||input.extraStops<0||input.extraStops>6||(input.tourId!=='la-dolce-vita'&&input.extraStops))throw C.fail(422,'Controlla le tappe extra.');
 if(!['it','en','fr','es','de'].includes(input.lang))throw C.fail(422,'Seleziona la lingua.');
 if(!Array.isArray(input.carts)||!input.carts.length||input.carts.length>config.fleetSize)throw C.fail(422,'Controlla il numero di golf cart.');
 const carts=input.carts.map(c=>{
  if(!Number.isInteger(c.people)||c.people<1||c.people>7)throw C.fail(422,'Ogni golf cart può avere da 1 a 7 ospiti.');
  return {people:c.people,vehicleId:C.text(c.vehicleId||'',80),driverId:C.text(c.driverId||'',80)};
 });
 const start=romeSlotEpoch(input.date,input.time);
 if(start===null||start>Date.now()+730*86400000)throw C.fail(422,'Orario non valido nel fuso di Roma.');
 return {name,email,phone,tourId:input.tourId,date:input.date,time:input.time,extraStops:input.extraStops,lang:input.lang,
  hotel:C.text(input.hotel,300,true),notes:C.text(input.notes||'',3000),notesAdmin:C.text(input.notesAdmin||'',5000),
  source:sources.includes(input.source)?input.source:'other',sourceLabel:C.text(input.sourceLabel||'',200),carts,
  people:carts.reduce((n,c)=>n+c.people,0),window:{start:new Date(start),end:new Date(start+(durations[input.tourId]+input.extraStops*15)*60000)}};
}
async function quote(input){
 const d=details(input),quotes=[];
 for(const cart of d.carts){const q=await computeQuote({tourId:d.tourId,people:cart.people,extraStops:d.extraStops,lang:d.lang});if(!q.ok)throw C.fail(422,q.error);quotes.push(q);}
 return {details:d,totalCents:quotes.reduce((n,q)=>n+q.totalCents,0),tourName:quotes[0].tourName,carts:quotes.map((q,i)=>({people:d.carts[i].people,total:q.total}))};
}
async function checkResources(c,d,id=''){
 const seen={vehicle:new Set(),driver:new Set()};
 for(const cart of d.carts)for(const kind of ['vehicle','driver']){
  const rid=cart[kind+'Id'];if(!rid)continue;
  if(seen[kind].has(rid))throw C.fail(409,'Ogni mezzo e autista può essere assegnato una sola volta al gruppo.');seen[kind].add(rid);
  const resource=(await c.query('SELECT * FROM maximo_resources WHERE id=$1 AND kind=$2 AND active',[rid,kind])).rows[0];
  if(!resource)throw C.fail(422,'Mezzo o autista non disponibile.');
  if(kind==='vehicle'&&cart.people>resource.seats)throw C.fail(409,'Gli ospiti superano i posti del mezzo selezionato.');
  const field=kind==='vehicle'?'vehicle_id':'driver_id';
  const overlap=await c.query(`SELECT b.id FROM maximo_assignments a JOIN bookings b ON b.id=a.booking_id
   WHERE a.${field}=$1 AND b.id<>$2 AND b.start_at<$4 AND b.end_at>$3 AND ${C.reservedSQL}`,[rid,id,d.window.start,d.window.end]);
  if(overlap.rows.length)throw C.fail(409,`${resource.name} è già assegnato a un tour sovrapposto (${overlap.rows[0].id}).`);
 }
}
async function checkAvailability(c,d,id=''){
 if((await c.query('SELECT date FROM blocked_dates WHERE date=$1',[d.date])).rows.length)throw C.fail(409,'La giornata è bloccata. Riaprila prima di prenotare.');
 if(await remaining(c,d.window,id)<d.carts.length)throw C.fail(409,'Golf cart insufficienti per questa fascia oraria.');
 await checkResources(c,d,id);
 await checkSeats(c,d,id);
}
async function checkSeats(c,d,id=''){
 const vehicles=(await c.query("SELECT id,seats FROM maximo_resources WHERE kind='vehicle' AND active")).rows;
 const rows=(await c.query(`SELECT b.id,b.start_at,b.end_at,b.people,b.cart_count,a.cart_index,a.people AS cart_people,a.vehicle_id FROM bookings b LEFT JOIN maximo_assignments a ON a.booking_id=b.id
 WHERE b.id<>$3 AND b.start_at<$2 AND b.end_at>$1 AND ${C.reservedSQL}`,[d.window.start,d.window.end,id])).rows;
 const groups=new Map();for(const r of rows){if(!groups.has(r.id))groups.set(r.id,{start:+new Date(r.start_at),end:+new Date(r.end_at),carts:[],people:Number(r.people),count:r.cart_count});if(r.cart_index!==null)groups.get(r.id).carts.push({people:r.cart_people,vehicleId:r.vehicle_id});}
 for(const g of groups.values())if(!g.carts.length){let people=g.people;for(let i=0;i<g.count;i++){const n=Math.min(7,people-(g.count-i-1));g.carts.push({people:n});people-=n;}}
 const start=+new Date(d.window.start),end=+new Date(d.window.end),points=[start,...[...groups.values()].flatMap(g=>[g.start,g.end]).filter(t=>t>start&&t<end)];
 for(const point of points){const demands=[...d.carts,...[...groups.values()].filter(g=>g.start<=point&&g.end>point).flatMap(g=>g.carts)],pool=new Map(vehicles.map(v=>[v.id,v.seats]));
  for(const demand of demands.filter(v=>v.vehicleId)){const seats=pool.get(demand.vehicleId);if(!seats||seats<demand.people)throw C.fail(409,'I mezzi assegnati non possono coprire questa partenza.');pool.delete(demand.vehicleId);}
  const free=[...pool.values()].sort((a,b)=>a-b);for(const demand of demands.filter(v=>!v.vehicleId).sort((a,b)=>b.people-a.people)){const index=free.findIndex(n=>n>=demand.people);if(index<0)throw C.fail(409,'Non ci sono abbastanza mezzi con i posti richiesti per gli ospiti.');free.splice(index,1);}
 }
}
async function assignments(c,id,carts){
 await c.query('DELETE FROM maximo_assignments WHERE booking_id=$1',[id]);
 for(const [i,a] of carts.entries())await c.query('INSERT INTO maximo_assignments(booking_id,cart_index,people,vehicle_id,driver_id) VALUES($1,$2,$3,$4,$5)',[id,i,a.people,a.vehicleId||null,a.driverId||null]);
}
async function create(input){
 if(!C.uuid(input.requestId))throw C.fail(422,'Ricarica il modulo e riprova.');
 const q=await quote(input),d=q.details;
 if(+d.window.start<Date.now())throw C.fail(422,'La partenza deve essere futura.');
 if(!['cash','bank_transfer','external_pos','unpaid'].includes(input.paymentMethod)||!['unpaid','paid'].includes(input.paymentStatus)||(input.paymentMethod==='unpaid'&&input.paymentStatus==='paid'))throw C.fail(422,'Metodo o stato di pagamento non valido.');
 const cents=input.totalCents;
 if(!Number.isSafeInteger(cents)||cents<1||cents>10000000)throw C.fail(422,'Importo non valido.');
 const reason=C.text(input.priceReason||'',500);
 if(cents!==q.totalCents&&!reason)throw C.fail(422,'Indica il motivo del prezzo concordato.');
 const payloadHash=crypto.createHash('sha256').update(JSON.stringify({d,cents,reason,paymentMethod:input.paymentMethod,paymentStatus:input.paymentStatus})).digest('hex');
 return C.transaction(async c=>{
  const existing=(await c.query('SELECT * FROM maximo_operations_keys WHERE key=$1',[input.requestId])).rows[0];
  if(existing){if(existing.payload_hash!==payloadHash)throw C.fail(409,'Richiesta già usata con dati differenti.');return {id:existing.booking_id,duplicate:true};}
  await checkAvailability(c,d);
  const id='MX'+crypto.randomUUID().replaceAll('-','');
  const breakdown={tourId:d.tourId,lang:d.lang,hotel:d.hotel,extraStops:d.extraStops,cartPrices:q.carts,quotedTotal:q.totalCents/100,priceReason:reason,total:cents/100,totalCents:cents,source:d.source};
  await c.query(`INSERT INTO bookings(id,name,email,phone,tour,people,date,time,notes,notes_admin,payment_method,status,amount,breakdown,channel,payment_status,start_at,end_at,cart_count,source_kind,source_label,paid_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,'maximo-web',$14,$15,$16,$17,$18,$19,CASE WHEN $14='paid' THEN NOW() ELSE NULL END)`,
   [id,d.name,d.email,d.phone,q.tourName,String(d.people),d.date,d.time,d.notes,d.notesAdmin,input.paymentMethod,cents/100,JSON.stringify(breakdown),input.paymentStatus,d.window.start,d.window.end,d.carts.length,d.source,d.sourceLabel]);
  await assignments(c,id,d.carts);await c.query('INSERT INTO maximo_operations_keys(key,payload_hash,booking_id) VALUES($1,$2,$3)',[input.requestId,payloadHash,id]);
  await C.audit(c,id,'manual_booking_created',null,{...d,amount:cents/100,paymentMethod:input.paymentMethod,paymentStatus:input.paymentStatus});return {id,ok:true};
 });
}
async function edit(id,input){
 const q=await quote(input),d=q.details;
 return C.transaction(async c=>{
  const old=await C.booking(c,id,input.version);
  if(['cancelled','completed'].includes(old.status)||['creating','open'].includes(old.checkout_state)||['refund_pending','refund_failed','refunded'].includes(old.payment_status))throw C.fail(409,'Questa prenotazione non può essere riprogrammata nello stato attuale.');
  if(+d.window.start<Date.now())throw C.fail(422,'Scegli una nuova partenza futura.');
  const previousCents=Math.round(Number(old.amount)*100),reason=C.text(input.priceReason||'',500);
  let totalCents=input.totalCents;
  if(old.payment_method==='stripe'){
   totalCents=previousCents;
   if(q.totalCents!==previousCents&&(input.keepAgreedPrice!==true||!reason))throw C.fail(409,'Il nuovo listino cambia il prezzo: conferma esplicitamente il mantenimento del totale già pagato e indica il motivo. Nessun addebito o rimborso automatico.');
  }else{
   if(!Number.isSafeInteger(totalCents)||totalCents<1||totalCents>10000000)throw C.fail(422,'Importo non valido.');
   if(old.payment_status==='paid'&&totalCents!==previousCents)throw C.fail(409,'Per una prenotazione già incassata il totale resta quello registrato.');
   if(totalCents!==q.totalCents&&!reason)throw C.fail(422,'Indica il motivo del prezzo concordato.');
  }
  await checkAvailability(c,d,id);
  const breakdown={...old.breakdown,tourId:d.tourId,hotel:d.hotel,lang:d.lang,extraStops:d.extraStops,cartPrices:q.carts,quotedTotal:q.totalCents/100,priceReason:reason,total:totalCents/100,totalCents};
  await c.query(`UPDATE bookings SET name=$2,email=$3,phone=$4,tour=$5,people=$6,date=$7,time=$8,notes=$9,notes_admin=$10,amount=$11,breakdown=$12,start_at=$13,end_at=$14,cart_count=$15,source_label=$16,updated_at=NOW() WHERE id=$1`,
   [id,d.name,d.email,d.phone,q.tourName,String(d.people),d.date,d.time,d.notes,d.notesAdmin,totalCents/100,JSON.stringify(breakdown),d.window.start,d.window.end,d.carts.length,d.sourceLabel]);
  await assignments(c,id,d.carts);await C.audit(c,id,'booking_details_updated',C.safeBooking(old),{...d,amount:totalCents/100,priceReason:reason});return {ok:true,id};
 });
}
async function detail(id){
 const row=(await getPool().query("SELECT * FROM bookings WHERE id=$1 AND channel='maximo-web'",[id])).rows[0];if(!row)throw C.fail(404,'Prenotazione non trovata.');
 const carts=(await getPool().query('SELECT * FROM maximo_assignments WHERE booking_id=$1 ORDER BY cart_index',[id])).rows;
 const history=(await getPool().query("SELECT id,action,created_at,before,after FROM audit_log WHERE entity='booking' AND entity_id=$1 ORDER BY id DESC LIMIT 100",[id])).rows;
 return {booking:C.safeBooking(row),carts,history};
}
module.exports={create,edit,quote,detail,checkAvailability,checkResources,checkSeats,assignments};
