const config=require('../config');
const copy=require('../booking-copy.json');
const {manageURL}=require('./payments');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function emailMessage(b){
 const customer=b.audience==='customer',lang=customer?b.breakdown?.lang:'it',d=copy[lang]||copy.en,t=s=>d[s]||s;
 const title=b.kind==='cancellation_requested'?'Cancellation request received':b.kind==='refunded'?'Tour cancelled and refunded':b.kind==='paid'?'Your tour is confirmed':b.kind==='refund_failed'?'Your refund needs assistance. Please contact Maximo Tours.':'New tour request';
 const description=b.kind==='cancellation_requested'?'Our team will review your request. No refund is issued automatically.':b.kind==='refunded'?'The refund has been issued to the original payment method. Your bank determines when it appears.':b.kind==='paid'?'Payment received. Keep your booking reference and this private link to manage your tour.':'Please check this booking in the administration panel.';
 const url=customer&&b.access_token?manageURL(b):config.siteUrl+'/ogre';
 const entries=[[t('Booking reference'),b.id],['Tour',b.tour],['Date',b.date],[t('Departure time (Rome)'),b.time],['Guests',b.people],['Hotel / pickup',b.breakdown?.hotel],['Total','EUR '+b.amount]];
 if(!customer)entries.push(['Name',b.name],['Email',b.email],['Phone',b.phone],['Notes',b.notes]);
 const html='<div style="font-family:Arial,sans-serif;color:#242424;max-width:620px;margin:auto;padding:28px"><img width="160" src="'+config.siteUrl+'/assets/logo.webp" alt="Maximo Tours"><h1 style="font-size:26px">'+escape(t(title))+'</h1><p>'+escape(t(description))+'</p><table style="width:100%;border-collapse:collapse">'+entries.filter(([,v])=>v).map(([k,v])=>'<tr><th style="text-align:left;padding:10px;border-bottom:1px solid #ddd">'+escape(k)+'</th><td style="padding:10px;border-bottom:1px solid #ddd">'+escape(v)+'</td></tr>').join('')+'</table><p><a href="'+escape(url)+'">'+escape(t('Manage your booking'))+'</a></p><p>'+escape(t('Free cancellation with a full refund at least 24 hours before departure.'))+'</p><p>Maximo Tours · '+escape(config.publicPhone)+'</p></div>';
 return {from:config.resendFromEmail,to:[customer?b.email:config.adminEmail],reply_to:customer?(config.replyToEmail||config.adminEmail):b.email,subject:'Maximo Tours — '+t(title)+' · '+b.id,html,text:[t(title),t(description),...entries.map(([k,v])=>k+': '+(v||'')),t('Manage your booking')+': '+url].join('\n')};
}
module.exports={emailMessage};
