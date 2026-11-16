const config=require('../config');
const {getPool}=require('../db');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function startNotifications(){
 if(!config.resendApiKey||!config.resendFromEmail||!config.adminEmail){console.log('Email notifications not configured; requests remain in database');return ()=>{};}
 let busy=false,stopped=false;
 async function tick(){
  if(busy||stopped)return;busy=true;let client;
  try{
   client=await getPool().connect();await client.query('BEGIN');
   const found=await client.query(`SELECT o.id AS notification_id,b.* FROM notification_outbox o JOIN bookings b ON b.id=o.booking_id
    WHERE o.status='pending' AND o.next_attempt<=NOW() ORDER BY o.next_attempt LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
   const b=found.rows[0];
   if(b){
    const rows={Reference:b.id,Name:b.name,Email:b.email,Phone:b.phone,Tour:b.tour,Guests:b.people,Date:b.date,Hotel:b.breakdown?.hotel,Notes:b.notes,Total:'EUR '+b.amount};
    const html='<div style="font-family:Arial,sans-serif;color:#242424;max-width:620px"><h1>Maximo Tours</h1><h2>New tour request</h2><p>Pending: contact the guest to confirm availability. No payment collected.</p>'+Object.entries(rows).map(([k,v])=>'<p><strong>'+escape(k)+':</strong> '+escape(v)+'</p>').join('')+'</div>';
    const reply=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+config.resendApiKey,'Content-Type':'application/json','Idempotency-Key':b.notification_id},body:JSON.stringify({from:config.resendFromEmail,to:[config.adminEmail],reply_to:config.replyToEmail||b.email,subject:'Maximo Tours — new request '+b.id,html})});
    if(reply.ok){await client.query("UPDATE notification_outbox SET status='sent',attempts=attempts+1,updated_at=NOW() WHERE id=$1",[b.notification_id]);}
    else{await client.query("UPDATE notification_outbox SET attempts=attempts+1,next_attempt=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1",[b.notification_id]);console.error('Notification provider rejected request');}
   }
   await client.query('COMMIT');
  }catch{if(client)await client.query('ROLLBACK').catch(()=>{});console.error('Notification delivery deferred');}
  finally{client?.release();busy=false;}
 }
 const timer=setInterval(tick,30000);timer.unref();tick();return ()=>{stopped=true;clearInterval(timer);};
}
module.exports={startNotifications};
