const {test}=require('node:test');
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/db');
const tours=['roma-iconica','roma-completa','la-dolce-vita','roma-by-night'].map(id=>({id,active:true,data:{names:{en:'Tour EN',it:'Tour IT'},pricing:{private:{'1-3':320,'4':390,'5-7':470}},maxPax:7,...(id==='la-dolce-vita'?{custom:{extraStopFee:19.5}}:{})}}));
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{q:async()=>({rows:tours})}};
const {computeQuote}=require('../src/services/catalog');
test('all four tours use server price bands for every group size',async()=>{
 for(const t of tours)for(let people=1;people<=7;people++){
  const r=await computeQuote({tourId:t.id,people,lang:'en',amount:1});assert.equal(r.total,people<=3?320:people===4?390:470);assert.equal(r.totalCents,r.total*100);assert.equal(r.tourName,'Tour EN');
 }
});
test('extra stops: correct cents, constraints and no extras for standard tours',async()=>{
 assert.equal((await computeQuote({tourId:'la-dolce-vita',people:4,extraStops:2})).totalCents,42900);
 for(const payload of [{people:8},{people:2.5},{people:'2'},{people:2,mode:'shared'},{people:2,extraStops:1},{people:2,coupon:'FREE'},{people:2,extras:{childSeat:true}}])assert.equal((await computeQuote({tourId:'roma-iconica',...payload})).ok,false);
});
