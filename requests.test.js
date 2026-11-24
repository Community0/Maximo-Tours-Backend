const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {validateRequest,createRequestHandler}=require('../src/services/requests');
const body=()=>({requestId:crypto.randomUUID(),privacyAccepted:true,customer:{name:'Test Guest',email:'test@example.com',phone:'+39 320 0000000'},booking:{tourId:'roma-iconica',people:2,date:new Date(Date.now()+86400000*30).toISOString().slice(0,10),hotel:'Hotel Test, Rome',lang:'en',extraStops:0}});
test('valid request preserves contact and hotel; ignores client amount',()=>{
 const b=body();b.amount=1;const value=validateRequest(b);assert.equal(value.phone,'+393200000000');assert.equal(value.hotel,'Hotel Test, Rome');assert.equal(value.amount,undefined);
});
test('invalid date, guest count, phone, hotel and privacy rejected',()=>{
 for(const mutate of [b=>b.booking.date='2027-02-30',b=>b.booking.people=8,b=>b.booking.people='2',b=>b.customer.phone='320000000',b=>b.booking.hotel='',b=>b.privacyAccepted=false,b=>b.booking.extraStops=-1,b=>b.booking.notes='a'.repeat(2001)]){
  const b=body();mutate(b);assert.throws(()=>validateRequest(b));
 }
});
function fakeDB({failure=false,blocked=false}={}){
 const store={keys:new Map(),bookings:[],outbox:[],log:[],released:0};
 const client={release(){store.released++},async query(sql,v=[]){
  store.log.push(sql);
  if(sql.includes('JOIN bookings'))return {rows:store.keys.has(v[0])?[store.keys.get(v[0])]:[]};
  if(sql.includes('FROM blocked_dates'))return {rows:blocked?[{date:'blocked'}]:[]};
  if(sql.startsWith('INSERT INTO bookings')){if(failure)throw new Error('db offline');store.bookings.push(v);}
  if(sql.startsWith('INSERT INTO request_keys'))store.keys.set(v[0],{payload_hash:v[1],id:v[2],amount:320,status:'pending'});
  if(sql.startsWith('INSERT INTO notification_outbox'))store.outbox.push(v);
  return {rows:[]};
 }};return {store,pool:{connect:async()=>client}};
}
const response=()=>({code:200,status(n){this.code=n;return this},json(v){this.value=v;return this}});
const quote=async()=>({ok:true,total:320,tourName:'Iconic Rome'});
test('request is stored at server price and queued before returning success; retries do not duplicate',async()=>{
 const {store,pool}=fakeDB(),b=body();b.amount=1;
 const handler=createRequestHandler({getPool:()=>pool,computeQuote:quote}),r=response();await handler({body:b},r);
 assert.equal(r.code,201);assert.equal(r.value.total,320);assert.equal(r.value.paymentCollected,false);assert.equal(store.outbox.length,1);assert.equal(store.log.at(-1),'COMMIT');
 const retry=response();await handler({body:b},retry);assert.equal(retry.code,200);assert.equal(retry.value.duplicate,true);assert.equal(store.bookings.length,1);
 b.booking.people=3;const conflict=response();await handler({body:b},conflict);assert.equal(conflict.code,409);assert.equal(store.released,3);
});
test('database failure rolls back and cannot return success',async()=>{
 const {store,pool}=fakeDB({failure:true}),r=response();
 await assert.rejects(createRequestHandler({getPool:()=>pool,computeQuote:quote})({body:body()},r));
 assert.equal(r.value,undefined);assert.equal(store.log.at(-1),'ROLLBACK');assert.equal(store.released,1);assert.equal(store.outbox.length,0);
});
test('blocked date cannot create request',async()=>{
 const {store,pool}=fakeDB({blocked:true}),r=response();
 await createRequestHandler({getPool:()=>pool,computeQuote:quote})({body:body()},r);
 assert.equal(r.code,409);assert.equal(store.bookings.length,0);
});
