const express=require('express');
const cors=require('cors');
const config=require('./config');
const {getPool}=require('./db');
const {bookingLimiter}=require('./middleware');
const {getTours,computeQuote}=require('./services/catalog');
const {createRequestHandler}=require('./services/requests');
const app=express();
const payments=require('./services/payments');
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use((req,res,next)=>{
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 const ownOrigin=req.protocol+'://'+req.get('host');
 if(req.get('origin')&&req.get('origin')!==ownOrigin&&!config.corsOriginOk(req.get('origin')))return res.status(403).json({error:'Origin not allowed'});
 next();
});
app.use(cors({origin:(origin,cb)=>cb(null,config.corsOriginOk(origin)),methods:['GET','POST'],allowedHeaders:['Content-Type','Authorization']}));
// Verify Stripe's signature over the original bytes, before JSON parsing.
app.post('/webhooks/stripe',express.raw({type:'application/json',limit:'1mb'}),asyncRoute(payments.webhook));
app.use(express.json({limit:'24kb'}));
app.use(require('./routes/admin-maximo'));
app.use('/ogre', (req,res,next)=>{res.set('X-Robots-Tag','noindex, nofollow');res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");next();},express.static(require('node:path').join(__dirname,'../public/admin')));
app.get('/booking/config',(req,res)=>res.json({paymentsEnabled:config.paymentReady(),timeZone:'Europe/Rome',cancellationHours:24,minimumNoticeHours:2,termsVersion:config.termsVersion}));
app.get('/availability',asyncRoute(async(req,res)=>res.json(await require('./services/availability').availability(getPool(),{tourId:req.query.tourId,date:req.query.date,extraStops:Number(req.query.extraStops||0)}))));
app.post('/checkout/session',bookingLimiter,asyncRoute(async(req,res)=>res.json(await payments.beginCheckout(req.body))));
app.post('/booking/status',asyncRoute(async(req,res)=>{const row=await payments.refreshBooking(req.body?.token);res.json({...payments.publicBooking(row),checkoutUrl:row.checkout_state==='open'?row.checkout_url:null});}));
app.post('/booking/cancel',bookingLimiter,asyncRoute(async(req,res)=>{if(req.body?.confirmed!==true)return res.status(422).json({error:'CONFIRM_CANCELLATION'});res.json(await payments.cancelBooking(req.body?.token));}));
app.get('/health',asyncRoute(async(req,res)=>{
 try{if(!getPool())throw new Error();await getPool().query('SELECT 1');res.json({status:'ok',service:'maximo-tours'});}
 catch{res.status(503).json({status:'unavailable'});}
}));
app.get('/catalog/tours',asyncRoute(async(req,res)=>res.json({tours:await getTours()})));
app.get('/blocked-dates',asyncRoute(async(req,res)=>{
 const r=await getPool().query('SELECT date FROM blocked_dates ORDER BY date');res.json({dates:r.rows.map(v=>v.date)});
}));
app.post('/quote',bookingLimiter,asyncRoute(async(req,res)=>{
 const quote=await computeQuote(req.body||{});res.status(quote.ok?200:422).json(quote);
}));
app.post('/requests',bookingLimiter,asyncRoute(createRequestHandler({getPool,computeQuote})));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.use((err,req,res,next)=>{
 if(err.status)return res.status(err.status).json({error:err.code||err.message,...(err.accessToken?{accessToken:err.accessToken}:{})});
 if(err.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON'});
 if(err.type==='entity.too.large')return res.status(413).json({error:'Request too large'});
 console.error('API operation failed');res.status(503).json({error:'SERVICE_UNAVAILABLE',...(err.accessToken?{accessToken:err.accessToken}:{})});
});
module.exports=app;
