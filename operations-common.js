'use strict';
const {getPool}=require('../db');
const config=require('../config');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function text(value,max=200,required=false){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail(422,'Controlla i campi obbligatori e la lunghezza dei testi.');
 return value.trim();
}
function day(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function range(query,maxDays=366){
 if(!day(query.from)||!day(query.to)||query.from>query.to||(Date.parse(query.to)-Date.parse(query.from))/86400000>maxDays)throw fail(422,`Scegli un intervallo valido, fino a ${maxDays} giorni.`);
 return [query.from,query.to];
}
async function transaction(fn){
 const c=await getPool().connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(78243191)');const result=await fn(c);await c.query('COMMIT');return result;}
 catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
async function audit(c,id,action,before,after){await c.query("INSERT INTO audit_log(entity,entity_id,action,before,after) VALUES('booking',$1,$2,$3,$4)",[id,action,JSON.stringify(before??null),JSON.stringify(after??null)]);}
async function booking(c,id,version){
 const row=(await c.query("SELECT * FROM bookings WHERE id=$1 AND channel='maximo-web' FOR UPDATE",[id])).rows[0];
 if(!row)throw fail(404,'Prenotazione non trovata.');
 if(!Number.isFinite(Date.parse(version))||+new Date(row.updated_at)!==+new Date(version))throw fail(409,'La prenotazione è stata modificata. Riaprila prima di salvare.');
 return row;
}
const safeBooking=r=>{const {access_token,checkout_url,...rest}=r;return rest;};
const reservedSQL="status<>'cancelled' AND (status IN ('confirmed','completed') OR payment_status IN ('paid','partially_refunded','refund_pending') OR checkout_state IN ('creating','open'))";
async function fleetCapacity(c){
 const r=(await c.query("SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE active) AS active FROM maximo_resources WHERE kind='vehicle'")).rows[0];
 return Number(r.total)?Math.min(config.fleetSize,Number(r.active)):config.fleetSize;
}
function csv(rows,columns){
 const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\ufeff'+[columns.map(c=>cell(c[0])).join(';'),...rows.map(r=>columns.map(c=>cell(typeof c[1]==='function'?c[1](r):r[c[1]])).join(';'))].join('\r\n');
}
module.exports={fail,text,uuid,day,range,transaction,audit,booking,safeBooking,reservedSQL,fleetCapacity,csv};
