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
};
config.allowedOrigins=(process.env.ALLOWED_ORIGINS||'https://maximotours.it,https://www.maximotours.it').split(',').map(v=>v.trim()).filter(Boolean);
config.corsOriginOk=origin=>!origin||config.allowedOrigins.includes(origin);
if(process.env.NODE_ENV==='production'&&(!config.databaseUrl||config.adminPassword.length<32))throw new Error('DATABASE_URL and ADMIN_PASSWORD (32+ characters) required');
module.exports=config;
