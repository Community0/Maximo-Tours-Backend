'use strict';
const {range}=require('./operations-common');
let auth,credentialKey='',cache=new Map();
function settings(){return {configured:!!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,ga4PropertyId:process.env.GA4_PROPERTY_ID||'565751125',searchConsoleProperty:'sc-domain:maximotours.it'};}
async function getAuth(){
 const json=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!json)return null;
 if(auth&&credentialKey===json)return auth;
 const credentials=JSON.parse(json);
 if(credentials.type!=='service_account'||!credentials.client_email||!credentials.private_key)throw Error('Invalid service account');
 const {GoogleAuth}=require('google-auth-library');
 auth=new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/analytics.readonly','https://www.googleapis.com/auth/webmasters.readonly']});credentialKey=json;return auth;
}
async function report(query){
 const [from,to]=range(query),cfg=settings(),key=from+to+cfg.ga4PropertyId;
 if(!cfg.configured)return {configured:false,ga4:{status:'not_connected'},searchConsole:{status:'not_connected'}};
 if(cache.has(key)&&Date.now()-cache.get(key).at<300000)return cache.get(key).data;
 let client;try{client=await (await getAuth()).getClient();}catch{return {configured:true,error:'Credenziali Google non valide. Verifica la configurazione su Railway.'};}
 const fetchReport=async(url,data)=>{try{return {status:'connected',data:(await client.request({url,method:'POST',data,timeout:15000})).data};}catch(e){return {status:'error',code:e.response?.status||503,message:'Report non disponibile. Verifica API attive e accesso della proprietà all’account di servizio.'};}};
 const [ga4,searchConsole]=await Promise.all([
  /^\d+$/.test(cfg.ga4PropertyId)?fetchReport(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4PropertyId}:runReport`,{dateRanges:[{startDate:from,endDate:to}],dimensions:[{name:'sessionDefaultChannelGroup'}],metrics:[{name:'sessions'},{name:'totalUsers'},{name:'screenPageViews'}],limit:30}):Promise.resolve({status:'not_connected',message:'Inserisci GA4_PROPERTY_ID numerico su Railway.'}),
  fetchReport('https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(cfg.searchConsoleProperty)+'/searchAnalytics/query',{startDate:from,endDate:to,dimensions:['query'],rowLimit:50,type:'web'})
 ]);
 const data={configured:true,ga4,searchConsole,observedAt:new Date().toISOString()};if(cache.size>50)cache.clear();cache.set(key,{at:Date.now(),data});return data;
}
module.exports={report,settings};
