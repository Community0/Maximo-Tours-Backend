'use strict';
const config=require('../config');
const {romeSlotEpoch}=require('./booking-time');
const durations={'roma-iconica':150,'roma-completa':180,'la-dolce-vita':180,'roma-by-night':150};
function windowFor({tourId,date,time,extraStops=0},now=Date.now()){
 if(!Object.hasOwn(durations,tourId)||!config.timeSlots.includes(time))throw Object.assign(new Error('Select a valid departure time.'),{status:422,code:'INVALID_TIME'});
 const start=romeSlotEpoch(date,time);
 if(start===null||start-now<config.minimumNoticeHours*3600000||start-now>730*86400000)throw Object.assign(new Error('Choose a departure at least two hours from now, within two years.'),{status:422,code:'INVALID_TIME'});
 return {start:new Date(start),end:new Date(start+(durations[tourId]+(tourId==='la-dolce-vita'?extraStops*15:0))*60000)};
}
async function remaining(client,window){
 const result=await client.query(`SELECT start_at,end_at FROM bookings WHERE start_at<$2 AND end_at>$1
 AND status<>'cancelled' AND (payment_status IN ('paid','partially_refunded','refund_pending') OR checkout_state IN ('creating','open'))`,[window.start,window.end]);
 const events=[];
 for(const b of result.rows){events.push([Math.max(+new Date(b.start_at),+window.start),1],[Math.min(+new Date(b.end_at),+window.end),-1]);}
 events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,peak=0;
 for(const [,delta] of events){active+=delta;peak=Math.max(peak,active);}
 return Math.max(0,config.fleetSize-peak);
}
async function availability(pool,input){
 if(!Object.hasOwn(durations,input.tourId)||!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!Number.isInteger(input.extraStops)||input.extraStops<0||input.extraStops>6)throw Object.assign(new Error('Invalid tour or date.'),{status:422});
 const blocked=(await pool.query('SELECT date FROM blocked_dates WHERE date=$1',[input.date])).rows.length>0;
 const slots=[];
 for(const time of config.timeSlots){let count=0;try{const w=windowFor({...input,time});if(!blocked)count=await remaining(pool,w);}catch{}slots.push({time,available:count>0});}
 return {date:input.date,timeZone:'Europe/Rome',slots};
}
module.exports={windowFor,remaining,availability};
