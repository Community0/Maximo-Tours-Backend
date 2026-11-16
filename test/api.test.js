const {test}=require('node:test');
const assert=require('node:assert/strict');
const app=require('../src/app');
test('HTTP health, authorization, exact CORS, malformed JSON and disabled legacy routes',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(url+'/health')).status,503);
  assert.equal((await fetch(url+'/ogre/api/requests')).status,401);
  for(const origin of ['https://maximotours.it.evil.example','https://evil-railway.app'])assert.equal((await fetch(url+'/health',{headers:{Origin:origin}})).status,403);
  const good=await fetch(url+'/health',{headers:{Origin:'https://maximotours.it'}});assert.equal(good.headers.get('access-control-allow-origin'),'https://maximotours.it');
  assert.equal((await fetch(url+'/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(url+'/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:'a'.repeat(30000)})})).status,413);
  for(const route of ['/checkout','/booking','/create-payment-intent','/webhook'])assert.equal((await fetch(url+route,{method:'POST'})).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
