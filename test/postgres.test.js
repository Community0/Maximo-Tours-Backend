const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const engine=new PGlite();
class TestPool{
 on(){}
 async query(sql,values){
  if(values===undefined&&sql.includes(';')){const r=await engine.exec(sql);return r.at(-1)||{rows:[]};}
  return engine.query(sql,values);
 }
 async connect(){return {query:this.query.bind(this),release(){}};}
 async end(){await engine.close();}
}
const pgPath=require.resolve('pg');require.cache[pgPath]={id:pgPath,filename:pgPath,loaded:true,exports:{Pool:TestPool}};
process.env.DATABASE_URL='postgresql://test-local';process.env.ADMIN_PASSWORD='local-test-password-not-a-production-secret';
const {initDB,getPool}=require('../src/db');const app=require('../src/app');
test('PostgreSQL schema, requests, retries, admin sessions, CSRF, updates and availability',async()=>{
 await initDB();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function call(path,{body,cookie,csrf}={}){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();return {response,data};}
 try{
  assert.equal((await call('/health')).response.status,200);
  assert.equal((await call('/catalog/tours')).data.tours.length,4);
  const quote=await call('/quote',{body:{tourId:'la-dolce-vita',people:5,extraStops:2,lang:'en',amount:1}});assert.equal(quote.data.total,509);
  const body={requestId:crypto.randomUUID(),privacyAccepted:true,customer:{name:'Integration Guest',email:'test@example.com',phone:'+393200000000'},booking:{tourId:'roma-iconica',people:4,date:new Date(Date.now()+86400000*30).toISOString().slice(0,10),hotel:'Test Hotel Rome',lang:'en'}};
  const request=await call('/requests',{body});assert.equal(request.response.status,201,JSON.stringify(request.data));assert.equal(request.data.total,390);
  assert.equal((await call('/requests',{body})).data.duplicate,true);
  const conflict=structuredClone(body);conflict.booking.people=5;assert.equal((await call('/requests',{body:conflict})).response.status,409);
  assert.equal((await getPool().query('SELECT COUNT(*) FROM bookings')).rows[0].count,1);
  assert.equal((await getPool().query('SELECT COUNT(*) FROM notification_outbox')).rows[0].count,1);
  assert.equal((await call('/ogre/api/requests')).response.status,401);
  assert.equal((await call('/ogre/api/login',{body:{password:'wrong'}})).response.status,401);
  const login=await call('/ogre/api/login',{body:{password:process.env.ADMIN_PASSWORD}});assert.equal(login.response.status,200);
  const cookie=login.response.headers.get('set-cookie').split(';')[0],csrf=login.data.csrf;
  assert.match(login.response.headers.get('set-cookie'),/HttpOnly/);assert.match(login.response.headers.get('set-cookie'),/SameSite=Strict/);
  const list=await call('/ogre/api/requests',{cookie});assert.equal(list.data.requests.length,1);let booking=list.data.requests[0];
  const scheduled={name:booking.name,email:booking.email,phone:booking.phone,tourId:'roma-iconica',date:booking.date,time:'10:30',hotel:'Test Hotel Rome',lang:'en',extraStops:0,notes:'',notesAdmin:'',source:'phone',sourceLabel:'',carts:[{people:4}],totalCents:39000,version:booking.updated_at};
  assert.equal((await call('/ogre/api/bookings/'+booking.id+'/details',{cookie,csrf,body:scheduled})).response.status,200);
  booking=(await call('/ogre/api/requests',{cookie})).data.requests[0];
  assert.equal((await call('/ogre/api/bookings/'+booking.id+'/offline-payment',{cookie,csrf,body:{version:booking.updated_at,confirmed:true,method:'cash',reference:'Integration test cash receipt'}})).response.status,200);
  booking=(await call('/ogre/api/requests',{cookie})).data.requests[0];
  const update={status:'confirmed',paymentStatus:'paid',notes:'Recorded offline',version:booking.updated_at};
  assert.equal((await call('/ogre/api/requests/'+booking.id,{cookie,body:update})).response.status,403);
  assert.equal((await call('/ogre/api/requests/'+booking.id,{cookie,csrf,body:update})).response.status,200);
  assert.equal((await call('/ogre/api/requests/'+booking.id,{cookie,csrf,body:update})).response.status,409);
  const overview=await call('/ogre/api/overview',{cookie});assert.equal(Number(overview.data.collected),390);assert.equal(Number(overview.data.confirmed),1);
  assert.equal((await getPool().query('SELECT COUNT(*) FROM audit_log')).rows[0].count,3);
  assert.equal((await call('/ogre/api/blocked-dates',{cookie,csrf,body:{date:body.booking.date,blocked:true,reason:'Full'}})).response.status,200);
  body.requestId=crypto.randomUUID();assert.equal((await call('/requests',{body})).response.status,409);
  assert.equal((await call('/ogre/api/logout',{cookie,csrf,body:{}})).response.status,200);assert.equal((await call('/ogre/api/session',{cookie})).response.status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await engine.close();}
});
