'use strict';
const {getPool}=require('../db');
const C=require('./operations-common');
async function rows(query){const [from,to]=C.range(query);return (await getPool().query(`SELECT b.id,b.name,b.email,b.phone,b.tour,b.people,b.date,b.time,b.cart_count,b.status,b.payment_status,b.payment_method,b.amount,b.refunded_cents,b.source_kind,b.source_label,b.breakdown,b.paid_at,b.created_at,b.notes_admin,
 COALESCE((SELECT string_agg(r.name,', ' ORDER BY a.cart_index) FROM maximo_assignments a JOIN maximo_resources r ON r.id=a.driver_id WHERE a.booking_id=b.id),'') AS drivers,
 COALESCE((SELECT string_agg(r.name,', ' ORDER BY a.cart_index) FROM maximo_assignments a JOIN maximo_resources r ON r.id=a.vehicle_id WHERE a.booking_id=b.id),'') AS vehicles
 FROM bookings b WHERE b.channel='maximo-web' AND b.date BETWEEN $1 AND $2 ORDER BY b.date,b.time,b.id`,[from,to])).rows;}
function summarize(items){return items.reduce((s,r)=>{
 s.bookings++;if(r.status==='cancelled')s.cancelled++;else{s.guests+=Number(r.people)||0;s.carts+=Number(r.cart_count)||1;}
 const paid=['paid','partially_refunded','refund_pending','refund_failed','refunded'].includes(r.payment_status);
 if(paid)s.grossCents+=Math.round(Number(r.amount)*100);
 s.refundedCents+=r.refunded_cents||0;
 if(!paid&&r.status!=='cancelled')s.outstandingCents+=Math.round(Number(r.amount)*100);
 s.netCents=s.grossCents-s.refundedCents;return s;
},{bookings:0,cancelled:0,guests:0,carts:0,grossCents:0,refundedCents:0,netCents:0,outstandingCents:0});}
function grouped(items,key){const groups=new Map();for(const r of items){const name=key(r);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(r);}return [...groups].map(([name,group])=>({name,...summarize(group)}));}
async function report(query){const items=await rows(query);return {from:query.from,to:query.to,basis:'tour_date',summary:summarize(items),byTour:grouped(items,r=>r.tour),bySource:grouped(items,r=>r.source_kind+(r.source_label?' · '+r.source_label:'')),byDay:grouped(items,r=>r.date),bookings:items};}
async function exportCsv(query){return C.csv(await rows(query),[
 ['Riferimento','id'],['Cliente','name'],['Email','email'],['Telefono','phone'],['Tour','tour'],['Data','date'],['Ora Roma','time'],['Ospiti','people'],['Golf cart','cart_count'],['Stato','status'],['Pagamento','payment_status'],['Metodo','payment_method'],['Totale EUR','amount'],['Rimborsi EUR',r=>(r.refunded_cents||0)/100],['Origine','source_kind'],['Partner / riferimento','source_label'],['Hotel',r=>r.breakdown?.hotel],['Lingua',r=>r.breakdown?.lang],['Autisti','drivers'],['Mezzi','vehicles'],['Note interne','notes_admin']]);}
module.exports={report,exportCsv};
