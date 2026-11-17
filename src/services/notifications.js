const config=require('../config');
const {getPool}=require('../db');
const {emailMessage}=require('./email-message');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function startNotifications(){
 if(!config.resendApiKey||!config.resendFromEmail||!config.adminEmail){console.log('Email notifications not configured; requests remain in database');return ()=>{};}
 let busy=false,stopped=false;
 async function tick(){
  if(busy||stopped)return;busy=true;let client;
  try{
   client=await getPool().connect();await client.query('BEGIN');
   const found=await client.query(`SELECT o.id AS notification_id,o.kind,o.audience,b.* FROM notification_outbox o JOIN bookings b ON b.id=o.booking_id
    WHERE o.status='pending' AND o.next_attempt<=NOW() ORDER BY o.next_attempt LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
   const b=found.rows[0];
   if(b){
    if(b.kind==='paid'&&['refund_pending','refunded','refund_failed'].includes(b.payment_status)){await client.query("UPDATE notification_outbox SET status='superseded',updated_at=NOW() WHERE id=$1",[b.notification_id]);await client.query('COMMIT');return;}
    const reply=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+config.resendApiKey,'Content-Type':'application/json','Idempotency-Key':b.notification_id},body:JSON.stringify(emailMessage(b))});
    if(reply.ok){await client.query("UPDATE notification_outbox SET status='sent',attempts=attempts+1,updated_at=NOW() WHERE id=$1",[b.notification_id]);}
    else{await client.query("UPDATE notification_outbox SET attempts=attempts+1,next_attempt=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1",[b.notification_id]);console.error('Notification provider rejected request');}
   }
   await client.query('COMMIT');
  }catch{if(client)await client.query('ROLLBACK').catch(()=>{});console.error('Notification delivery deferred');}
  finally{client?.release();busy=false;}
 }
 const timer=setInterval(tick,2000);timer.unref();tick();return ()=>{stopped=true;clearInterval(timer);};
}
module.exports={startNotifications};
