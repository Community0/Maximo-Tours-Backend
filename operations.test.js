'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),engine=new PGlite();let gate=Promise.resolve();
class Pool{on(){}async query(sql,values){if(values===undefined&&sql.includes(';'))return (await engine.exec(sql)).at(-1)||{rows:[]};return engine.query(sql,values);}async connect(){let release;const before=gate;gate=new Promise(r=>release=r);await before;return {query:this.query.bind(this),release};}}
const pg=require.resolve('pg');require.cache[pg]={id:pg,filename:pg,loaded:true,exports:{Pool}};
Object.assign(process.env,{DATABASE_URL:'postgresql://isolated-test',ADMIN_PASSWORD:'local-operations-test-not-production',GOOGLE_SERVICE_ACCOUNT_JSON:'',PAYMENTS_ENABLED:'false'});
const db=require('../src/db'),app=require('../src/app'),config=require('../src/config'),ops=require('../src/services/operations-bookings');
const date=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
const baseDetails=()=>({requestId:crypto.randomUUID(),name:'Test Group',phone:'+393200000000',email:'guest@example.com',tourId:'roma-iconica',date,time:'09:00',hotel:'Test Hotel Rome',lang:'en',extraStops:0,notes:'Dietary preference',notesAdmin:'Internal test',source:'hotel',sourceLabel:'Hotel example',carts:[{people:4},{people:3}],totalCents:71000,paymentMethod:'unpaid',paymentStatus:'unpaid'});
test('Ogre operations: atomic multi-cart bookings, assignments, edits, reports, privacy and access',async()=>{
 await db.initDB();await db.initDB();assert.equal(Number((await db.getPool().query("SELECT COUNT(*) FROM maximo_resources WHERE kind='vehicle'")).rows[0].count),8,'migration is idempotent');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 let cookie='',csrf='',ip=0;
 async function call(path,body,auth=true){const res=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Forwarded-For':'192.0.2.'+(++ip),...(auth?{cookie,'x-csrf-token':csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:res.headers.get('content-type')?.includes('json')?await res.json():await res.text(),headers:res.headers};}
 async function get(id){return (await call('/ogre/api/bookings/'+id)).data.booking;}
 try{
  assert.equal((await call('/ogre/api/calendar?from='+date+'&to='+date)).status,401);
  const login=await call('/ogre/api/login',{password:process.env.ADMIN_PASSWORD},false);cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;
  assert.equal((await call('/ogre/api/capabilities')).data.version,'2.0.0');
  const driver=await call('/ogre/api/resources',{kind:'driver',name:'Autista Test',active:true,phone:'+393201234567',notes:'English / Italian'});assert.equal(driver.status,200);
  const body=baseDetails();body.carts[0].driverId=driver.data.id;body.carts[0].vehicleId='cart-01';
  const quote=await call('/ogre/api/manual-quote',body);assert.equal(quote.data.totalCents,71000);
  const badCsrf=csrf;csrf='incorrect';assert.equal((await call('/ogre/api/manual-bookings',body)).status,403);csrf=badCsrf;
  const first=await call('/ogre/api/manual-bookings',body);if(first.status!==201)await ops.create({...body,requestId:crypto.randomUUID()});assert.equal(first.status,201,JSON.stringify(first));const id=first.data.id;
  assert.equal((await call('/ogre/api/manual-bookings',body)).data.duplicate,true);assert.equal(Number((await db.getPool().query('SELECT COUNT(*) FROM bookings')).rows[0].count),1);
  assert.equal((await call('/ogre/api/manual-bookings',{...body,name:'Changed'})).status,409);
  const other=baseDetails();other.time='10:30';other.carts=[{people:2,driverId:driver.data.id,vehicleId:'cart-02'}];other.totalCents=32000;assert.equal((await call('/ogre/api/manual-bookings',other)).status,409,'driver overlap');
  other.carts=[{people:2,vehicleId:'cart-01'}];assert.equal((await call('/ogre/api/manual-bookings',other)).status,409,'vehicle overlap');
  other.carts=[{people:2,vehicleId:'cart-02'},{people:2,vehicleId:'cart-02'}];other.totalCents=64000;assert.equal((await call('/ogre/api/manual-bookings',other)).status,409,'duplicate assignment');
  const full=baseDetails();full.carts=Array.from({length:7},()=>({people:1}));full.totalCents=224000;assert.equal((await call('/ogre/api/manual-bookings',full)).status,409,'weighted fleet capacity');
  let booking=await get(id);assert.equal(booking.cart_count,2);assert.equal(booking.people,'7');assert.equal(booking.access_token,undefined);assert.equal(booking.checkout_url,undefined);
  const moved={...body,time:'14:30',version:booking.updated_at};assert.equal((await call('/ogre/api/bookings/'+id+'/details',moved)).status,200);assert.equal((await call('/ogre/api/bookings/'+id+'/details',moved)).status,409,'stale edit');
  assert.equal((await call('/availability?tourId=roma-iconica&date='+date+'&extraStops=0')).data.slots.find(x=>x.time==='09:00').available,true);
  booking=await get(id);assert.equal((await call('/ogre/api/bookings/'+id+'/offline-payment',{version:booking.updated_at,method:'cash',reference:'Receipt 42',confirmed:false})).status,422);
  assert.equal((await call('/ogre/api/bookings/'+id+'/offline-payment',{version:booking.updated_at,method:'cash',reference:'Receipt 42',confirmed:true})).status,200);
  booking=await get(id);assert.equal(booking.payment_status,'paid');assert.ok(booking.paid_at);
  assert.equal((await call('/ogre/api/bookings/'+id+'/details',{...moved,version:booking.updated_at,totalCents:1,priceReason:'Incorrect edit'})).status,409,'paid total protected');
  const cal=await call('/ogre/api/calendar?from='+date+'&to='+date);assert.equal(cal.data.bookings[0].carts.length,2);assert.equal(cal.data.bookings[0].carts[0].driver_name,'Autista Test');
  const report=await call('/ogre/api/reports?from='+date+'&to='+date);assert.equal(report.data.summary.netCents,71000);assert.equal(report.data.summary.guests,7);
  await db.getPool().query("UPDATE bookings SET name='=HYPERLINK(\"bad\")' WHERE id=$1",[id]);
  const exported=await call('/ogre/api/export?from='+date+'&to='+date);assert.equal(exported.status,200);assert.match(exported.data,/'=HYPERLINK/,'spreadsheet formulas escaped');assert.ok(exported.headers.get('content-disposition').includes('attachment'));
  assert.equal((await call('/ogre/api/reports?from=bad&to='+date)).status,422);
  const resource=(await call('/ogre/api/resources')).data.resources.find(r=>r.id==='cart-01');assert.equal((await call('/ogre/api/resources',{...resource,version:resource.updated_at,active:false})).status,409,'cannot retire assigned vehicle');
  const event={id:crypto.randomUUID(),sessionId:crypto.randomUUID(),consent:true,event:'page_view',page:'/',source:'organic_search'};
  assert.equal((await call('/analytics/event',{...event,consent:false},false)).status,422);assert.equal((await call('/analytics/event',{...event,page:'/checkout.html#booking=private'},false)).status,422);
  assert.equal((await call('/analytics/event',event,false)).status,200);assert.equal((await call('/analytics/event',event,false)).status,200);assert.equal(Number((await db.getPool().query('SELECT COUNT(*) FROM maximo_visit_events')).rows[0].count),1);
  const now=new Date().toISOString().slice(0,10),traffic=await call('/ogre/api/traffic?from='+now+'&to='+now);assert.equal(Number(traffic.data.summary.sessions),1);assert.equal(traffic.data.purchases.length,0);
  const google=await call('/ogre/api/google-reports?from='+date+'&to='+date);assert.equal(google.data.configured,false);
  // Non-Stripe reservations reserve capacity even before offline payment.
  const many=baseDetails();many.time='09:00';many.carts=Array.from({length:8},()=>({people:1}));many.totalCents=256000;assert.equal((await call('/ogre/api/manual-bookings',many)).status,201);
  assert.equal((await call('/availability?tourId=roma-iconica&date='+date+'&extraStops=0')).data.slots.find(x=>x.time==='10:30').available,false);
  // Seat feasibility accounts for unassigned existing bookings, not only total carts.
  const another=new Date(Date.now()+31*86400000).toISOString().slice(0,10);await db.getPool().query("UPDATE maximo_resources SET seats=4 WHERE kind='vehicle' AND id<>'cart-08'");
  const seven={...baseDetails(),date:another,carts:[{people:7}],totalCents:47000};assert.equal((await call('/ogre/api/manual-bookings',seven)).status,201);
  assert.equal((await call('/ogre/api/manual-bookings',{...seven,requestId:crypto.randomUUID()})).status,409,'only one seven-seat cart');
  const four={...seven,requestId:crypto.randomUUID(),carts:[{people:4,vehicleId:'cart-08'}],totalCents:39000};assert.equal((await call('/ogre/api/manual-bookings',four)).status,409,'cannot take only suitable vehicle from unassigned seven-person reservation');
  const lastCart=(await call('/ogre/api/resources')).data.resources.find(r=>r.id==='cart-08');
  assert.equal((await call('/ogre/api/resources',{...lastCart,version:lastCart.updated_at,seats:4})).status,409,'cannot reduce seats needed by unassigned group');
  assert.equal((await call('/ogre/api/export?from='+date+'&to='+date,undefined,false)).status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await engine.close();}
});
