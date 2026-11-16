const express=require('express');
const crypto=require('node:crypto');
const config=require('../config');
const {getPool}=require('../db');
const {loginLimiter}=require('../middleware');
const router=express.Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const cookieName=process.env.NODE_ENV==='production'?'__Host-maximo_admin':'maximo_admin';
const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:8*3600000};
const fingerprint=()=>digest(config.adminPassword);
router.post('/ogre/api/login',loginLimiter,wrap(async(req,res)=>{
 const password=req.body?.password;
 if(typeof password!=='string'||!config.adminPassword||!crypto.timingSafeEqual(Buffer.from(digest(password)),Buffer.from(fingerprint())))return res.status(401).json({error:'Password non corretta.'});
 const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
 await getPool().query('DELETE FROM admin_sessions WHERE expires_at<NOW()');
 await getPool().query("INSERT INTO admin_sessions(token_hash,csrf,password_version,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '8 hours')",[digest(token),csrf,fingerprint()]);
 res.cookie(cookieName,token,cookieOptions);res.json({ok:true,csrf});
}));
router.use('/ogre/api',wrap(async(req,res,next)=>{
 const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!value||!/^[a-f0-9]{64}$/.test(value))return res.status(401).json({error:'Accedi per continuare.'});
 const r=await getPool().query('SELECT csrf FROM admin_sessions WHERE token_hash=$1 AND expires_at>NOW() AND password_version=$2',[digest(value),fingerprint()]);
 if(!r.rows.length)return res.status(401).json({error:'Sessione scaduta. Accedi di nuovo.'});
 req.admin={tokenHash:digest(value),csrf:r.rows[0].csrf};
 if(req.method!=='GET'&&req.get('x-csrf-token')!==req.admin.csrf)return res.status(403).json({error:'Sessione non valida. Ricarica la pagina.'});
 next();
}));
router.get('/ogre/api/session',(req,res)=>res.json({csrf:req.admin.csrf}));
router.post('/ogre/api/logout',wrap(async(req,res)=>{
 await getPool().query('DELETE FROM admin_sessions WHERE token_hash=$1',[req.admin.tokenHash]);res.clearCookie(cookieName,{...cookieOptions,maxAge:undefined});res.json({ok:true});
}));
router.get('/ogre/api/requests',wrap(async(req,res)=>{
 const offset=Math.max(0,Math.min(1000000,parseInt(req.query.offset)||0));
 const search=String(req.query.search||'').trim().slice(0,120),status=String(req.query.status||'');
 const result=await getPool().query(`SELECT id,name,email,phone,tour,people,date,notes,notes_admin,status,amount,payment_status,breakdown,created_at,updated_at,
 COUNT(*) OVER() AS filtered_count FROM bookings WHERE channel='maximo-web'
 AND ($1='' OR name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR id ILIKE '%'||$1||'%')
 AND ($2='' OR status=$2) ORDER BY date DESC,created_at DESC,id DESC LIMIT 50 OFFSET $3`,[search,status,offset]);
 res.json({requests:result.rows,total:Number(result.rows[0]?.filtered_count||0),offset,limit:50});
}));
router.get('/ogre/api/overview',wrap(async(req,res)=>{
 const r=await getPool().query(`SELECT COUNT(*) AS requests,
 COUNT(*) FILTER(WHERE status='pending') AS pending,
 COUNT(*) FILTER(WHERE status='confirmed') AS confirmed,
 COALESCE(SUM(amount) FILTER(WHERE payment_status='paid'),0) AS collected
 FROM bookings WHERE channel='maximo-web'`);
 const mail=await getPool().query("SELECT COUNT(*) AS pending FROM notification_outbox WHERE status='pending'");
 res.json({...r.rows[0],notificationsPending:Number(mail.rows[0].pending),emailConfigured:!!(config.resendApiKey&&config.resendFromEmail&&config.adminEmail)});
}));
router.post('/ogre/api/requests/:id',wrap(async(req,res)=>{
 const {status,paymentStatus,notes,version}=req.body||{};
 if(!['pending','confirmed','cancelled','completed'].includes(status)||!['unpaid','paid','refunded'].includes(paymentStatus)||typeof notes!=='string'||notes.length>5000||!Number.isFinite(Date.parse(version)))return res.status(422).json({error:'Controlla stato, pagamento e note.'});
 const client=await getPool().connect();
 try{
  await client.query('BEGIN');
  const previous=await client.query("SELECT * FROM bookings WHERE id=$1 AND channel='maximo-web' FOR UPDATE",[req.params.id]);
  const old=previous.rows[0];if(!old){await client.query('ROLLBACK');return res.status(404).json({error:'Richiesta non trovata.'});}
  if(new Date(old.updated_at).getTime()!==new Date(version).getTime()){await client.query('ROLLBACK');return res.status(409).json({error:'La richiesta è stata modificata. Ricarica e riprova.'});}
  const updated=await client.query('UPDATE bookings SET status=$1,payment_status=$2,notes_admin=$3,updated_at=NOW() WHERE id=$4 RETURNING updated_at',[status,paymentStatus,notes,req.params.id]);
  await client.query("INSERT INTO audit_log(entity,entity_id,action,before,after) VALUES('booking',$1,'admin_update',$2,$3)",[req.params.id,JSON.stringify({status:old.status,paymentStatus:old.payment_status,notes:old.notes_admin}),JSON.stringify({status,paymentStatus,notes})]);
  await client.query('COMMIT');res.json({ok:true,updatedAt:updated.rows[0].updated_at});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
router.get('/ogre/api/blocked-dates',wrap(async(req,res)=>res.json({dates:(await getPool().query('SELECT date,reason FROM blocked_dates ORDER BY date')).rows})));
router.post('/ogre/api/blocked-dates',wrap(async(req,res)=>{
 const {date,reason,blocked}=req.body||{};
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||typeof blocked!=='boolean'||(reason!==undefined&&(typeof reason!=='string'||reason.length>200)))return res.status(422).json({error:'Data o motivazione non valida.'});
 if(blocked)await getPool().query('INSERT INTO blocked_dates(date,reason) VALUES($1,$2) ON CONFLICT(date) DO UPDATE SET reason=EXCLUDED.reason',[date,reason||'Non disponibile']);
 else await getPool().query('DELETE FROM blocked_dates WHERE date=$1',[date]);
 res.json({ok:true});
}));
module.exports=router;
