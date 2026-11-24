'use strict';
// Mounted only AFTER the existing session and CSRF middleware.
const router=require('express').Router(),{getPool}=require('../db');
const C=require('../services/operations-common'),bookings=require('../services/operations-bookings'),resources=require('../services/operations-resources'),reports=require('../services/operations-reports');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.get('/capabilities',(req,res)=>res.json({version:'2.0.0',operations:true,analytics:true}));
router.get('/resources',wrap(async(req,res)=>res.json({resources:await resources.list()})));
router.post('/resources',wrap(async(req,res)=>res.json(await resources.save(req.body||{}))));
router.get('/calendar',wrap(async(req,res)=>res.json(await resources.calendar(req.query))));
router.post('/manual-quote',wrap(async(req,res)=>{const q=await bookings.quote(req.body||{});res.json({totalCents:q.totalCents,carts:q.carts});}));
router.post('/manual-bookings',wrap(async(req,res)=>res.status(201).json(await bookings.create(req.body||{}))));
router.get('/bookings/:id',wrap(async(req,res)=>res.json(await bookings.detail(req.params.id))));
router.post('/bookings/:id/details',wrap(async(req,res)=>res.json(await bookings.edit(req.params.id,req.body||{}))));
router.post('/bookings/:id/assignments',wrap(async(req,res)=>res.json(await C.transaction(async c=>{
 const old=await C.booking(c,req.params.id,req.body?.version),carts=req.body?.carts;
 if(!old.start_at||!old.end_at||old.status==='cancelled'||!Array.isArray(carts)||carts.length!==old.cart_count||carts.some(a=>!Number.isInteger(a.people)||a.people<1||a.people>7)||carts.reduce((n,a)=>n+a.people,0)!==Number(old.people))throw C.fail(422,'Controlla distribuzione degli ospiti e numero di mezzi.');
 const normalized=carts.map(a=>({people:a.people,vehicleId:C.text(a.vehicleId||'',80),driverId:C.text(a.driverId||'',80)}));
 await bookings.checkResources(c,{carts:normalized,window:{start:old.start_at,end:old.end_at}},old.id);
 await bookings.checkSeats(c,{carts:normalized,window:{start:old.start_at,end:old.end_at}},old.id);
 await bookings.assignments(c,old.id,normalized);await c.query('UPDATE bookings SET updated_at=NOW() WHERE id=$1',[old.id]);await C.audit(c,old.id,'assignments_updated',null,normalized);return {ok:true};
}))));
router.post('/bookings/:id/offline-payment',wrap(async(req,res)=>res.json(await C.transaction(async c=>{
 const old=await C.booking(c,req.params.id,req.body?.version);
 if(req.body?.confirmed!==true||old.payment_method==='stripe'||old.payment_status!=='unpaid'||old.status==='cancelled'||!['cash','bank_transfer','external_pos'].includes(req.body.method))throw C.fail(422,'Controlla la conferma e il metodo di incasso.');
 const reference=C.text(req.body.reference||'',300,true);
 await c.query("UPDATE bookings SET payment_status='paid',payment_method=$2,paid_at=NOW(),updated_at=NOW() WHERE id=$1",[old.id,req.body.method]);
 await C.audit(c,old.id,'offline_payment_recorded',{paymentStatus:old.payment_status},{method:req.body.method,amount:old.amount,reference});return {ok:true};
}))));
router.get('/reports',wrap(async(req,res)=>res.json(await reports.report(req.query))));
router.get('/export',wrap(async(req,res)=>res.type('text/csv').attachment('maximo-prenotazioni-'+req.query.from+'-'+req.query.to+'.csv').send(await reports.exportCsv(req.query))));
router.get('/traffic',wrap(async(req,res)=>res.json(await require('../services/traffic').report(req.query))));
router.get('/google-reports',wrap(async(req,res)=>res.json(await require('../services/google-reports').report(req.query))));
router.get('/notifications',wrap(async(req,res)=>res.json({notifications:(await getPool().query(`SELECT o.id,o.booking_id,o.kind,o.audience,o.status,o.attempts,o.next_attempt,o.updated_at,b.name FROM notification_outbox o JOIN bookings b ON b.id=o.booking_id WHERE b.channel='maximo-web' ORDER BY o.updated_at DESC LIMIT 200`)).rows})));
module.exports=router;
