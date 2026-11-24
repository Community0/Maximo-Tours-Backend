'use strict';
const {getPool}=require('../db');
const C=require('./operations-common');
const sources=['direct','organic_search','paid_search','social','email','referral'];
function validPage(value){return typeof value==='string'&&/^\/(?:(?:it|fr|es|de)\/)?(?:|tours\/(?:roma-iconica|roma-completa|la-dolce-vita|roma-by-night)\/|checkout\.html|informazioni\.html|sitemap\/)$/.test(value);}
async function record(body){
 if(body?.consent!==true||!C.uuid(body.id)||!C.uuid(body.sessionId)||!['page_view','begin_checkout'].includes(body.event)||!validPage(body.page)||!sources.includes(body.source))throw C.fail(422,'Invalid analytics event');
 await getPool().query('INSERT INTO maximo_visit_events(id,session_id,event,page,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[body.id,body.sessionId,body.event,body.page,body.source]);
 return {ok:true};
}
async function attribution(body){
 if(body?.consent!==true||!C.uuid(body.sessionId))return null;
 const r=(await getPool().query('SELECT source FROM maximo_visit_events WHERE session_id=$1 AND created_at>NOW()-INTERVAL \'24 hours\' ORDER BY created_at LIMIT 1',[body.sessionId])).rows[0];
 return r?{sessionId:body.sessionId,source:r.source}:null;
}
async function report(query){
 const [from,to]=C.range(query),p=[from,to];
 const dates="created_at>=($1::date::timestamp AT TIME ZONE 'Europe/Rome') AND created_at<(($2::date+1)::timestamp AT TIME ZONE 'Europe/Rome')";
 const summary=(await getPool().query(`SELECT COUNT(*) FILTER(WHERE event='page_view') AS views,COUNT(DISTINCT session_id) AS sessions,COUNT(DISTINCT session_id) FILTER(WHERE event='begin_checkout') AS checkouts FROM maximo_visit_events WHERE ${dates}`,p)).rows[0];
 const channels=(await getPool().query(`SELECT source,COUNT(*) FILTER(WHERE event='page_view') AS views,COUNT(DISTINCT session_id) AS sessions FROM maximo_visit_events WHERE ${dates} GROUP BY source ORDER BY sessions DESC`,p)).rows;
 const pages=(await getPool().query(`SELECT page,COUNT(*) AS views FROM maximo_visit_events WHERE ${dates} AND event='page_view' GROUP BY page ORDER BY views DESC LIMIT 30`,p)).rows;
 // Confirmed payments come from the booking ledger, never from a browser purchase event.
 const purchases=(await getPool().query(`SELECT acquisition_source AS source,COUNT(*) AS bookings,COALESCE(SUM(amount-COALESCE(refunded_cents,0)/100.0),0) AS revenue FROM bookings
 WHERE channel='maximo-web' AND analytics_session IS NOT NULL AND payment_status IN ('paid','partially_refunded','refund_pending','refund_failed')
 AND paid_at>=($1::date::timestamp AT TIME ZONE 'Europe/Rome') AND paid_at<(($2::date+1)::timestamp AT TIME ZONE 'Europe/Rome') GROUP BY acquisition_source`,p)).rows;
 const cohort=(await getPool().query(`SELECT COUNT(DISTINCT b.analytics_session) AS converted_sessions FROM bookings b WHERE b.analytics_session IS NOT NULL AND b.payment_status IN ('paid','partially_refunded','refund_pending','refund_failed') AND b.analytics_session IN (SELECT session_id::text FROM maximo_visit_events WHERE ${dates})`,p)).rows[0];
 return {from,to,summary,channels,pages,purchases,convertedSessions:Number(cohort.converted_sessions),consentedOnly:true};
}
function startRetention(){let busy=false;const run=async()=>{if(busy)return;busy=true;try{await getPool().query("DELETE FROM maximo_visit_events WHERE created_at<NOW()-INTERVAL '183 days'");await getPool().query("UPDATE bookings SET analytics_session=NULL,acquisition_source=NULL WHERE analytics_session IS NOT NULL AND created_at<NOW()-INTERVAL '183 days'");}catch{console.error('Analytics retention deferred');}finally{busy=false;}};const timer=setInterval(run,86400000);timer.unref();run();return ()=>clearInterval(timer);}
module.exports={record,attribution,report,startRetention,validPage};
