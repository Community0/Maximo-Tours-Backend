require('dotenv').config();
const config={
 port:process.env.PORT||8080,
 databaseUrl:process.env.DATABASE_URL||'',
 adminPassword:process.env.ADMIN_PASSWORD||'',
 siteUrl:process.env.SITE_URL||'https://maximotours.it',
 publicPhone:process.env.PUBLIC_PHONE||'+39 320 689 1014',
 publicWhatsapp:process.env.PUBLIC_WHATSAPP||'+39 320 689 1014',
 whatsappHref:process.env.PUBLIC_WHATSAPP_HREF||'https://wa.me/393206891014',
 resendApiKey:process.env.RESEND_API_KEY||'',
 resendFromEmail:process.env.RESEND_FROM_EMAIL||'',
 adminEmail:process.env.ADMIN_EMAIL||'',
 replyToEmail:process.env.REPLY_TO_EMAIL||process.env.ADMIN_EMAIL||'',
 stripeSecretKey:process.env.STRIPE_SECRET_KEY||'',
 stripeWebhookSecret:process.env.STRIPE_WEBHOOK_SECRET||'',
 paymentsEnabled:process.env.PAYMENTS_ENABLED==='true',
 fleetSize:Number(process.env.GOLF_CART_COUNT||8),
 timeSlots:(process.env.BOOKING_TIME_SLOTS||'09:00,10:30,12:00,14:30,16:00,17:30,19:00,20:30').split(',').map(v=>v.trim()),
 cancellationHours:24,
 minimumNoticeHours:2,
 termsVersion:'2026-11-17',
};
config.siteUrl=config.siteUrl.replace(/\/$/,'');
if(!Number.isInteger(config.fleetSize)||config.fleetSize<1||config.fleetSize>100)throw new Error('Invalid GOLF_CART_COUNT');
if(config.timeSlots.some(v=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)))throw new Error('Invalid BOOKING_TIME_SLOTS');
// Stripe is verified through its API, including by the background reconciliation worker.
// A signed webhook is an optional additional trigger, not a prerequisite for payments.
config.paymentReady=()=>config.paymentsEnabled&&!!config.stripeSecretKey;
config.paymentMode=()=>config.stripeSecretKey.startsWith('sk_live_')?'live':config.stripeSecretKey.startsWith('sk_test_')?'test':'unconfigured';
config.allowedOrigins=(process.env.ALLOWED_ORIGINS||'https://maximotours.it,https://www.maximotours.it').split(',').map(v=>v.trim()).filter(Boolean);
config.corsOriginOk=origin=>!origin||config.allowedOrigins.includes(origin);
if(process.env.NODE_ENV==='production'&&(!config.databaseUrl||config.adminPassword.length<32))throw new Error('DATABASE_URL and ADMIN_PASSWORD (32+ characters) required');
module.exports=config;
