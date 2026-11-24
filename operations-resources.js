'use strict';
const crypto=require('node:crypto');
const config=require('../config');
const {getPool}=require('../db');
const C=require('./operations-common');
async function list(){return (await getPool().query('SELECT * FROM maximo_resources ORDER BY kind,name,id')).rows;}
async function save(input){
 if(!['vehicle','driver'].includes(input.kind)||typeof input.active!=='boolean')throw C.fail(422,'Tipo di risorsa non valido.');
 const name=C.text(input.name,100,true),phone=C.text(input.phone||'',40),notes=C.text(input.notes||'',2000),seats=input.kind==='vehicle'?input.seats:7;
 if(!Number.isInteger(seats)||seats<1||seats>7)throw C.fail(422,'I posti devono essere da 1 a 7.');
 return C.transaction(async c=>{
  let old;if(input.id){old=(await c.query('SELECT * FROM maximo_resources WHERE id=$1 FOR UPDATE',[input.id])).rows[0];if(!old||old.kind!==input.kind)throw C.fail(404,'Risorsa non trovata.');if(+new Date(old.updated_at)!==Date.parse(input.version))throw C.fail(409,'Risorsa modificata: ricarica prima di salvare.');}
  const id=old?.id||(input.kind==='vehicle'?'cart-':'driver-')+crypto.randomUUID();
  if(old&&(!input.active||seats<old.seats)){
   const field=input.kind==='vehicle'?'vehicle_id':'driver_id';
   const busy=await c.query(`SELECT b.id FROM maximo_assignments a JOIN bookings b ON b.id=a.booking_id WHERE a.${field}=$1 AND b.end_at>NOW() AND ${C.reservedSQL} AND ($2=false OR a.people>$3) LIMIT 1`,[id,input.active,seats]);
   if(busy.rows.length)throw C.fail(409,'Riassegna prima le prenotazioni future di questa risorsa.');
  }
  if(input.kind==='vehicle'&&input.active&&(!old||!old.active)){
   const count=Number((await c.query("SELECT COUNT(*) FROM maximo_resources WHERE kind='vehicle' AND active")).rows[0].count);
   if(count>=config.fleetSize)throw C.fail(409,'È stato raggiunto il limite della flotta configurato su Railway.');
  }
  if(old)await c.query('UPDATE maximo_resources SET name=$2,phone=$3,seats=$4,notes=$5,active=$6,updated_at=NOW() WHERE id=$1',[id,name,phone,seats,notes,input.active]);
  else await c.query('INSERT INTO maximo_resources(id,kind,name,phone,seats,notes,active) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,input.kind,name,phone,seats,notes,input.active]);
  if(input.kind==='vehicle'&&!input.active){
   const events=(await c.query(`SELECT start_at,end_at,cart_count FROM bookings WHERE end_at>NOW() AND ${C.reservedSQL}`)).rows.flatMap(r=>[[+new Date(r.start_at),r.cart_count],[+new Date(r.end_at),-r.cart_count]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
   const capacity=await C.fleetCapacity(c);let active=0;for(const [,n] of events){active+=n;if(active>capacity)throw C.fail(409,'Questo mezzo serve per coprire prenotazioni già confermate.');}
  }
  if(old&&input.kind==='vehicle'&&(!input.active||seats<old.seats)){
   const future=(await c.query(`SELECT MIN(start_at) AS start,MAX(end_at) AS end FROM bookings WHERE end_at>NOW() AND ${C.reservedSQL}`)).rows[0];
   if(future.start)await require('./operations-bookings').checkSeats(c,{window:{start:future.start,end:future.end},carts:[]});
  }
  await c.query("INSERT INTO audit_log(entity,entity_id,action,before,after) VALUES('resource',$1,'resource_saved',$2,$3)",[id,JSON.stringify(old??null),JSON.stringify({name,phone,seats,notes,active:input.active})]);return {id,ok:true};
 });
}
async function calendar(query){
 const [from,to]=C.range(query,93);
 const bookings=(await getPool().query(`SELECT id,name,email,phone,tour,people,date,time,start_at,end_at,cart_count,status,payment_status,amount,breakdown,source_kind,source_label,updated_at
 FROM bookings WHERE channel='maximo-web' AND date BETWEEN $1 AND $2 AND status<>'cancelled' AND (status IN ('confirmed','completed') OR payment_status IN ('paid','partially_refunded','refund_pending') OR checkout_state IN ('creating','open')) ORDER BY start_at,id`,[from,to])).rows;
 const assignments=(await getPool().query(`SELECT a.*,v.name AS vehicle_name,d.name AS driver_name FROM maximo_assignments a JOIN bookings b ON b.id=a.booking_id
 LEFT JOIN maximo_resources v ON v.id=a.vehicle_id LEFT JOIN maximo_resources d ON d.id=a.driver_id WHERE b.channel='maximo-web' AND b.date BETWEEN $1 AND $2`,[from,to])).rows;
 return {from,to,bookings:bookings.map(b=>({...b,carts:assignments.filter(a=>a.booking_id===b.id)})),resources:await list(),blocked:(await getPool().query('SELECT date,reason FROM blocked_dates WHERE date BETWEEN $1 AND $2',[from,to])).rows};
}
module.exports={list,save,calendar};
