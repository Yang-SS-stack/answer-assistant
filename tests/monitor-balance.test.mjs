import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDeepSeekBalance,deepSeekBalance} from '../src/monitoring/balance.js';
const KEY='aaV4monitorBalance';
const raw=(total='1.2300')=>({is_available:true,balance_infos:[{currency:'CNY',total_balance:total,granted_balance:'0',topped_up_balance:'+1.2300'}]});
const response=(value=raw(),status=200)=>new Response(JSON.stringify(value),{status});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function setup(overrides={}) {
  let time=100000,profile={apiKey:'synthetic-A'},scope='account-A',calls=0;
  const saved={};
  const storage={async get(key){return {[key]:structuredClone(saved[key])};},async set(value){Object.assign(saved,structuredClone(value));}};
  const options={storage,getProfile:async()=>profile,getScope:async()=>scope,now:()=>time,fetchImpl:async()=>{calls++;return response();},...overrides};
  const monitor=deepSeekBalance(options);
  return {monitor,options,saved,storage,get calls(){return calls;},tick(ms=60000){time+=ms;},account(key,s){profile={apiKey:key};scope=s;}};
}
test('parser preserves bounded signed decimal strings and separate currencies',()=>{
 const value=raw('-0.0500');value.is_available=false;value.balance_infos.push({currency:'USD',total_balance:'2',granted_balance:'.5',topped_up_balance:'1.5'});
 assert.deepEqual(parseDeepSeekBalance(value),{available:false,balances:[{currency:'CNY',total:'-0.0500',granted:'0',toppedUp:'+1.2300'},{currency:'USD',total:'2',granted:'.5',toppedUp:'1.5'}]});
});
test('parser rejects malformed schemas, unsupported currencies and unsafe decimals with fixed error',()=>{
 const bad=[null,{}, {...raw(),is_available:1},{...raw(),balance_infos:[]},...['EUR','cny','CNY\n'].map(currency=>({...raw(),balance_infos:[{...raw().balance_infos[0],currency}]})),...['1e4','NaN','Infinity',' 1','1\n','1'.repeat(129),3].map(total=>raw(total))];
 for(const value of bad)assert.throws(()=>parseDeepSeekBalance(value),{message:'BALANCE_INVALID_RESPONSE'});
});
test('official GET uses bearer only in header, redirect error and strips private cache fields',async()=>{
 let request;
 const x=setup({fetchImpl:async(url,init)=>{request={url,init};return response();}});
 const state=await x.monitor.refresh();
 assert.equal(request.url,'https://api.deepseek.com/user/balance');assert.equal(request.init.method,'GET');assert.equal(request.init.headers.Authorization,'Bearer synthetic-A');assert.equal(request.init.redirect,'error');
 assert.equal(state.status,'ready');assert.equal(state.fetchedAt,100000);assert.equal(state.nextRefreshAt,160000);assert.equal(state.stale,false);
 assert.equal(x.saved[KEY].scope,'account-A');assert.ok(!JSON.stringify(state).includes('account-A'));assert.ok(!JSON.stringify(x.saved).includes('synthetic-A'));
 const copy=await x.monitor.status();copy.data.balances[0].total='mutated';assert.equal((await x.monitor.status()).data.balances[0].total,'1.2300');
});
test('concurrent refreshes share request and throttle for at least sixty seconds',async()=>{
 const gate=deferred();let calls=0;const x=setup({minIntervalMs:1,fetchImpl:async()=>{calls++;await gate.promise;return response();}});
 const a=x.monitor.refresh(),b=x.monitor.refresh();await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal((await x.monitor.status()).status,'loading');gate.resolve();await Promise.all([a,b]);
 x.tick(59999);await x.monitor.refresh();assert.equal(calls,1);x.tick(1);await x.monitor.refresh();assert.equal(calls,2);
});
test('no key does not fetch and returns unconfigured',async()=>{const x=setup();x.account('','account-A');assert.equal((await x.monitor.refresh()).status,'unconfigured');assert.equal(x.calls,0);});
for(const [name,fetcher,code] of [['401',async()=>response({},401),'BALANCE_UNAUTHORIZED'],['429',async()=>response({},429),'BALANCE_RATE_LIMITED'],['network',async()=>{throw Error('SECRET raw network');},'BALANCE_NETWORK_ERROR'],['invalid',async()=>response({secret:'SECRET'}),'BALANCE_INVALID_RESPONSE'],['large',async()=>new Response('x'.repeat(17000)),'BALANCE_INVALID_RESPONSE']]) {
 test(`${name} failure keeps same-account stale data and safe error`,async()=>{let fail=false;const x=setup({fetchImpl:async()=>fail?fetcher():response()});await x.monitor.refresh();x.tick();fail=true;const state=await x.monitor.refresh();assert.equal(state.status,'error');assert.equal(state.error,code);assert.equal(state.data.balances[0].total,'1.2300');assert.equal(state.stale,true);assert.ok(!JSON.stringify(state).includes('SECRET'));});
}
test('timeout resolves even if transport ignores abort',async()=>{const x=setup({timeoutMs:5,fetchImpl:()=>new Promise(()=>{})});assert.equal((await x.monitor.refresh()).error,'BALANCE_TIMEOUT');});
test('restart restores only current scope cache and validates future/corrupt cache',async()=>{
 const x=setup();await x.monitor.refresh();assert.equal((await deepSeekBalance(x.options).status()).status,'ready');
 for(const cached of [{...x.saved[KEY],fetchedAt:100001},{...x.saved[KEY],scope:'other'},{...x.saved[KEY],data:{available:true,balances:[]}}]){x.saved[KEY]=cached;assert.equal((await deepSeekBalance(x.options).status()).status,'empty');}
});
test('direct key change rejects late reply without invalidate and allows current account refresh',async()=>{
 const gate=deferred();let n=0;const x=setup({fetchImpl:async()=>++n===1?(await gate.promise,response(raw('9'))):response(raw('2'))});
 const old=x.monitor.refresh();await new Promise(r=>setImmediate(r));x.account('synthetic-B','account-B');const current=await x.monitor.refresh();assert.equal(current.data.balances[0].total,'2');gate.resolve();await old;assert.equal((await x.monitor.status()).data.balances[0].total,'2');
});
test('invalidate rejects ABA late response and old finally cannot remove new inflight',async()=>{
 const first=deferred(),second=deferred();let n=0;const x=setup({fetchImpl:async()=>{const i=++n;await(i===1?first.promise:second.promise);return response(raw(String(i)));}});
 const old=x.monitor.refresh();await new Promise(r=>setImmediate(r));await x.monitor.invalidate();const fresh=x.monitor.refresh();await new Promise(r=>setImmediate(r));first.resolve();await old;const shared=x.monitor.refresh();await new Promise(r=>setImmediate(r));assert.equal(n,2);second.resolve();await Promise.all([fresh,shared]);assert.equal((await x.monitor.status()).data.balances[0].total,'2');
});
test('storage and profile failures are isolated and safe',async()=>{
 const x=setup({storage:{async get(){throw Error('SECRET');},async set(){throw Error('SECRET');}}});const state=await x.monitor.refresh();assert.equal(state.error,'BALANCE_STORAGE_ERROR');assert.ok(!JSON.stringify(state).includes('SECRET'));
 const y=setup({getProfile:async()=>{throw Error('SECRET');}});assert.equal((await y.monitor.refresh()).error,'BALANCE_CONFIG_ERROR');
});
test('invalidate during cache read cannot resurrect stale data',async()=>{
 const x=setup();await x.monitor.refresh();const cached=structuredClone(x.saved[KEY]),gate=deferred();
 const m=deepSeekBalance({...x.options,storage:{async get(){await gate.promise;return {[KEY]:cached};},async set(v){Object.assign(x.saved,v);}}});
 const read=m.status();await new Promise(r=>setImmediate(r));await m.invalidate();gate.resolve();assert.equal((await read).status,'empty');assert.equal((await m.status()).status,'empty');assert.equal(x.saved[KEY],null);
});
test('invalidate serializes clear behind outstanding cache write',async()=>{
 const gate=deferred();let writes=0,active=0,max=0;const saved={};
 const x=setup({storage:{async get(){return {};},async set(value){active++;max=Math.max(max,active);if(++writes===1)await gate.promise;Object.assign(saved,value);active--;}}});
 const pending=x.monitor.refresh();await new Promise(r=>setImmediate(r));const clear=x.monitor.invalidate();gate.resolve();await Promise.all([pending,clear]);assert.equal(max,1);assert.equal(saved[KEY],null);assert.equal((await x.monitor.status()).status,'empty');
});
test('account change during persistence is rechecked before returning public data',async()=>{
 const gate=deferred();let writes=0;
 const x=setup({storage:{async get(){return {};},async set(){if(++writes===1)await gate.promise;}}});
 const pending=x.monitor.refresh();await new Promise(r=>setImmediate(r));x.account('synthetic-B','account-B');gate.resolve();const state=await pending;assert.equal(state.status,'empty');assert.equal(state.data,undefined);
});
test('direct key changes with unchanged scope still invalidate old values',async()=>{
 const x=setup();await x.monitor.refresh();x.account('synthetic-B','account-A');assert.equal((await x.monitor.status()).status,'empty');assert.equal((await x.monitor.refresh()).status,'ready');assert.equal(x.calls,2);
});
test('stale cache allows refresh and failed first request is throttled',async()=>{
 const x=setup();await x.monitor.refresh();x.tick();const restarted=deepSeekBalance(x.options);assert.equal((await restarted.status()).stale,true);await restarted.refresh();assert.equal(x.calls,2);
 let calls=0;const y=setup({fetchImpl:async()=>{calls++;throw Error('SECRET');}});await y.monitor.refresh();await y.monitor.refresh();assert.equal(calls,1);
});
test('truncated or malicious advertised response bodies never leak source text',async()=>{
 for(const fetchImpl of [async()=>new Response('{SECRET'),async()=>new Response('SECRET',{headers:{'content-length':'100000'}}),async()=>response({},500)]){
  const x=setup({fetchImpl});const state=await x.monitor.refresh();assert.equal(state.status,'error');assert.ok(!JSON.stringify(state).includes('SECRET'));
 }
});
test('delayed initial cache load rechecks current identity before exposing any balance',async()=>{
 const original=setup({fetchImpl:async()=>response(raw('987.65'))});await original.monitor.refresh();
 const gate=deferred();let loads=0;
 const x=setup({storage:{async get(){loads++;await gate.promise;return structuredClone(original.saved);},async set(){}}});
 const pending=x.monitor.status();await new Promise(r=>setImmediate(r));x.account('synthetic-B','account-B');gate.resolve();
 const state=await pending;assert.equal(state.status,'empty');assert.equal(state.data,undefined);assert.equal(state.fetchedAt,undefined);assert.equal(loads,1);
});
test('changed key with unavailable scope cannot preserve previous account data',async()=>{
 const x=setup();await x.monitor.refresh();x.account('synthetic-B','');
 const state=await x.monitor.status();assert.equal(state.error,'BALANCE_CONFIG_ERROR');assert.equal(state.data,undefined);assert.equal(state.fetchedAt,undefined);assert.equal(state.nextRefreshAt,undefined);
});
for(const failingGetter of ['getProfile','getScope'])test(`unverifiable ${failingGetter} hides old balance and invalidates pending work`,async()=>{
 let unavailable=false;const x=setup({[failingGetter]:async()=>{if(unavailable)throw Error('SECRET');return failingGetter==='getProfile'?{apiKey:'synthetic-A'}:'account-A';}});
 await x.monitor.refresh();unavailable=true;const state=await x.monitor.status();assert.equal(state.error,'BALANCE_CONFIG_ERROR');assert.equal(state.data,undefined);assert.equal(state.fetchedAt,undefined);assert.equal(state.stale,false);assert.ok(!JSON.stringify(state).includes('SECRET'));
 unavailable=false;assert.equal((await x.monitor.status()).status,'empty');
});
test('cache read completion with unavailable scope never publishes cached balance',async()=>{
 const original=setup();await original.monitor.refresh();const gate=deferred();const x=setup({storage:{async get(){await gate.promise;return original.saved;},async set(){}}});
 const pending=x.monitor.status();await new Promise(r=>setImmediate(r));x.account('synthetic-B','');gate.resolve();const state=await pending;assert.equal(state.error,'BALANCE_CONFIG_ERROR');assert.equal(state.data,undefined);
});
