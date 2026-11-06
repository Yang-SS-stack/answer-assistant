import test from 'node:test';import assert from 'node:assert/strict';
import {frameDecoder,encodeFrame,validateNativeRequest,validExtensionOrigin} from '../native/framing.mjs';
import {parseQuotaResponse,queryQuota,startConsoleLogin} from '../native/qwen-console.mjs';
import {nativeController,serveNative} from '../native/host.mjs';
import http from 'node:http';import {PassThrough} from 'node:stream';
const model='qwen3.7-flash',origin='chrome-extension://'+'a'.repeat(32)+'/',session={accessToken:'synthetic-console-token',sessionId:'12345678-1234-1234-1234-123456789abc',region:'cn-beijing',site:'domestic'};
const quota=(patch={})=>({data:{DataV2:{data:{data:{freeTierQuotas:[{model,quotaInitTotal:1000,quotaTotal:800,quotaValidityPeriod:2000,quotaStatus:'VALID',...patch}]}}}}});
test('native framing handles fragmented/coalesced frames and rejects oversized or invalid JSON',()=>{const d=frameDecoder(),a={version:1,id:'a',op:'status'},b={version:1,id:'b',op:'status'},bytes=Buffer.concat([encodeFrame(a),encodeFrame(b)]);assert.deepEqual(d.push(bytes.subarray(0,3)),[]);assert.deepEqual(d.push(bytes.subarray(3)),[a,b]);const bad=Buffer.alloc(4);bad.writeUInt32LE(1000000);assert.throws(()=>frameDecoder().push(bad),/NATIVE_PROTOCOL/);const malformed=Buffer.from([1,0,0,0,123]);assert.throws(()=>frameDecoder().push(malformed),/NATIVE_PROTOCOL/);});
test('native requests allow only fixed operations and bounded model names',()=>{assert(validExtensionOrigin(origin));assert(!validExtensionOrigin('https://evil.test'));assert(!validExtensionOrigin('chrome-extension://*'));assert.equal(validateNativeRequest({version:1,id:'x',op:'quota',models:[model]}).op,'quota');for(const bad of [{version:2,id:'x',op:'status'},{version:1,id:'x',op:'exec',command:'bad'},{version:1,id:'x',op:'quota',models:['--bad']},{version:1,id:'x',op:'quota',models:[model],url:'https://evil.test'},{version:1,id:'x',op:'login',apiKey:'secret'}])assert.throws(()=>validateNativeRequest(bad),/NATIVE_PROTOCOL/);});
test('Qwen official quota supports current and legacy response wrappers without guessing missing zero',()=>{assert.deepEqual(parseQuotaResponse(quota(),[model],1000),[{model,remaining:800,total:1000,expiresAt:2000,status:'valid'}]);assert.equal(parseQuotaResponse(quota(),[model],3000)[0].status,'expired');assert.equal(parseQuotaResponse({data:{data:{freeTierQuotas:[]}}},[model],1000)[0].status,'none');assert.equal(parseQuotaResponse(quota({quotaTotal:'800'}),[model],1000)[0].status,'unknown');assert.throws(()=>parseQuotaResponse({},[model],1000),/QUOTA_FORMAT/);assert.throws(()=>parseQuotaResponse({data:{success:false,errorCode:'NotLogined',message:'secret'}},[model],1000),/QWEN_AUTH_EXPIRED/);});
test('quota query has fixed official gateway, no arbitrary API, no model call or secret error output',async()=>{let calls=0;const value=await queryQuota(session,[model],{now:()=>1000,fetchImpl:async(url,o)=>{calls++;assert.equal(new URL(url).origin,'https://bailian-cs.console.aliyun.com');assert.equal(o.headers.Authorization,'Bearer '+session.accessToken);assert.equal(o.redirect,'error');const params=JSON.parse(new URLSearchParams(o.body).get('params'));assert.equal(params.Api,'zeldaEasy.bailian-commerce.freeTrial.queryFreeTierQuota');assert.deepEqual(params.Data.queryFreeTierQuotaRequest.models,[model]);assert.equal(params.Data.cornerstoneParam.switchUserType,3);return new Response(JSON.stringify(quota()));}});assert.equal(calls,1);assert.equal(value.models[0].remaining,800);assert(!JSON.stringify(value).includes(session.accessToken));await assert.rejects(queryQuota(session,[model],{fetchImpl:async()=>new Response('synthetic-token-in-body',{status:401})}),e=>e.message==='QWEN_AUTH_EXPIRED');});
test('official local login omits API key creation and rejects wrong origin/state before saving',async()=>{let saved,verified=0;const login=await startConsoleLogin({timeoutMs:2000,verify:async c=>{verified++;assert.equal(c.region,'cn-beijing');},save:async c=>{saved=c;}});try{const u=new URL(login.url);assert.equal(u.origin,'https://bailian.console.aliyun.com');assert(!u.searchParams.has('needapikey'));const notice=u.searchParams.get('notice'),callback=new URL('http://'+notice);assert.equal(callback.hostname,'127.0.0.1');const wrong=new URL(callback);wrong.searchParams.set('state','wrong');assert.equal((await fetch(wrong)).status,400);assert.equal((await fetch(callback,{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({access_token:session.accessToken})})).status,403);assert.equal(saved,undefined);const good=await fetch(callback,{method:'POST',headers:{Origin:u.origin,'Content-Type':'application/json'},body:JSON.stringify({access_token:session.accessToken,api_key:'must-ignore',console_region:'cn-beijing',console_site:'domestic'})});assert.equal(good.status,200);await login.done;assert.equal(verified,1);assert.equal(saved.accessToken,session.accessToken);assert.equal(saved.api_key,undefined);assert.equal(typeof saved.sessionId,'string');}finally{login.cancel();await login.done.catch(()=>{});}});
test('cancelled or rejected login never saves credentials',async()=>{let saves=0;const login=await startConsoleLogin({timeoutMs:1000,verify:async()=>{},save:async()=>saves++});const settled=login.done.catch(e=>e);login.cancel();assert.match((await settled).message,/QWEN_LOGIN_CANCELLED/);assert.equal(saves,0);});
test('native host never returns credentials and logout rejects late quota responses',async()=>{
 let c={...session},release,started;const ready=new Promise(r=>started=r),controller=nativeController({credentials:{load:async()=>c,clear:async()=>{c=null;}},query:async(value,models)=>{started();await new Promise(r=>release=r);return{sessionId:value.sessionId,models:[{model,remaining:1,total:2,expiresAt:null,status:'valid'}],accessToken:'never-return'};}});
 const status=await controller.handle({version:1,id:'status',op:'status'});assert.equal(status.data.authenticated,true);assert(!JSON.stringify(status).includes('synthetic-console-token'));
 const result=controller.handle({version:1,id:'query',op:'quota',models:[model]});await ready;assert.equal((await controller.handle({version:1,id:'logout',op:'logout'})).data.authenticated,false);release();assert.equal((await result).error.code,'QUOTA_STALE');await controller.close();
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(r=>setTimeout(r,60));
for(const action of ['logout','EOF'])test(`native transport ${action} immediately cancels an in-flight quota`,async()=>{
 const started=deferred(),release=deferred();let signal,c={...session};
 const controller=nativeController({credentials:{load:async()=>c,clear:async()=>{c=null;}},query:async(value,_models,o)=>{signal=o.signal;started.resolve();await release.promise;return{sessionId:value.sessionId,models:[{model,remaining:1,total:2,expiresAt:null,status:'valid'}]};}});
 const input=new PassThrough(),output=new PassThrough(),decoder=frameDecoder(),responses=[];output.on('data',b=>responses.push(...decoder.push(b)));
 const running=serveNative({input,output,origin,expectedOrigin:origin,controller});
 try{
  input.write(encodeFrame({version:1,id:'quota',op:'quota',models:[model]}));await started.promise;
  if(action==='EOF')input.end();else input.write(encodeFrame({version:1,id:'logout',op:'logout'}));
  await tick();assert.equal(signal.aborted,true);
  release.resolve();if(action!=='EOF'){await tick();input.end();}await running;
  assert.equal(responses.find(r=>r.id==='quota').ok,false);
  if(action==='logout')assert.equal(responses.find(r=>r.id==='logout').data.authenticated,false);
  decoder.finish();
 }finally{release.resolve();input.end();await running;}
});
test('native host rejects quota from a different session',async()=>{
 const controller=nativeController({credentials:{load:async()=>session},query:async()=>({sessionId:'11111111-1111-4111-8111-111111111111',models:[{model,remaining:1,total:2,expiresAt:null,status:'valid'}]})});
 const result=await controller.handle({version:1,id:'q',op:'quota',models:[model]});assert.equal(result.ok,false);assert.equal(result.error.code,'QUOTA_STALE');await controller.close();
});
test('simultaneous callback bodies claim only one verification and save',async()=>{
 const hold=deferred();let verified=0,saved=0;
 const login=await startConsoleLogin({timeoutMs:3000,verify:async()=>{verified++;await hold.promise;},save:async()=>{saved++;}});
 const callback='http://'+new URL(login.url).searchParams.get('notice'),body=JSON.stringify({access_token:session.accessToken});
 const requests=[];const send=()=>{const done=deferred(),req=http.request(callback,{method:'POST',headers:{Origin:'https://bailian.console.aliyun.com','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>done.resolve(res.statusCode));});req.on('error',()=>done.resolve(0));req.flushHeaders();requests.push(req);return done.promise;};
 try{const a=send(),b=send();await tick();for(const req of requests)req.end(body);await tick();assert.equal(verified,1);hold.resolve();assert.deepEqual((await Promise.all([a,b])).sort(),[200,409]);await login.done;assert.equal(saved,1);}
 finally{hold.resolve();login.cancel();await login.done.catch(()=>{});for(const req of requests)req.destroy();}
});
test('login cancellation does not settle until an already-started save finishes',async()=>{
 const started=deferred(),release=deferred();let settled=false;
 const login=await startConsoleLogin({timeoutMs:3000,verify:async()=>{},save:async()=>{started.resolve();await release.promise;}});
 const done=login.done.catch(()=>{}).then(()=>{settled=true;});
 const callback='http://'+new URL(login.url).searchParams.get('notice');
 const request=fetch(callback,{method:'POST',headers:{Origin:'https://bailian.console.aliyun.com','Content-Type':'application/json'},body:JSON.stringify({access_token:session.accessToken})}).catch(()=>{});
 try{await started.promise;login.cancel();await tick();assert.equal(settled,false);release.resolve();await done;assert.equal(settled,true);}
 finally{release.resolve();login.cancel();await done;await request;}
});
test('login verification rejects a quota response belonging to another session',async()=>{
 let saved=false;
 const controller=nativeController({credentials:{load:async()=>null,save:async()=>{saved=true;}},query:async()=>({sessionId:'11111111-1111-4111-8111-111111111111',models:[{model,remaining:1,total:2,expiresAt:null,status:'valid'}]}),login:async({verify,save})=>{await verify(session);await save(session,()=>{});return{url:'https://bailian.console.aliyun.com/console-login',done:Promise.resolve(),cancel(){}};}});
 const result=await controller.handle({version:1,id:'login',op:'login',models:[model]});assert.equal(result.ok,false);assert.equal(saved,false);await controller.close();
});
test('EOF during login startup cancels the eventual operation without returning its URL',async()=>{
 const started=deferred(),release=deferred(),cancelled=deferred();let cancellations=0;
 const controller=nativeController({credentials:{load:async()=>null},login:async()=>{started.resolve();await release.promise;return{url:'https://bailian.console.aliyun.com/console-login',done:cancelled.promise,cancel(){cancellations++;cancelled.resolve();}};}});
 const input=new PassThrough(),output=new PassThrough(),decoder=frameDecoder(),responses=[];output.on('data',b=>responses.push(...decoder.push(b)));
 const running=serveNative({input,output,origin,expectedOrigin:origin,controller});
 input.write(encodeFrame({version:1,id:'login',op:'login',models:[model]}));await started.promise;input.end();await tick();release.resolve();await running;
 assert.equal(cancellations,1);assert.equal(responses[0].ok,false);assert(!JSON.stringify(responses).includes('loginUrl'));
});
test('logout waits for a callback save before clearing the session',async()=>{
 const started=deferred(),release=deferred();let c=null;
 const controller=nativeController({credentials:{load:async()=>c,save:async(value)=>{started.resolve();await release.promise;c=value;},clear:async()=>{c=null;}},query:async(value)=>({sessionId:value.sessionId,models:[{model,remaining:1,total:2,expiresAt:null,status:'valid'}]})});
 const connected=await controller.handle({version:1,id:'login',op:'login',models:[model]});
 const callback='http://'+new URL(connected.data.loginUrl).searchParams.get('notice');
 const request=fetch(callback,{method:'POST',headers:{Origin:'https://bailian.console.aliyun.com','Content-Type':'application/json'},body:JSON.stringify({access_token:session.accessToken})}).catch(()=>{});
 await started.promise;let settled=false;const logout=controller.handle({version:1,id:'logout',op:'logout'}).then(r=>{settled=true;return r;});
 try{await tick();assert.equal(settled,false);}finally{release.resolve();await request;}
 assert.equal((await logout).ok,true);assert.equal(c,null);await controller.close();
});
test('status and quota during logout wait for credential removal',async()=>{
 const clearing=deferred(),release=deferred();let c={...session},queries=0;
 const controller=nativeController({credentials:{load:async()=>c,clear:async()=>{clearing.resolve();await release.promise;c=null;}},query:async(value)=>{queries++;return{sessionId:value.sessionId,models:[{model,remaining:1,total:2,expiresAt:null,status:'valid'}]};}});
 const logout=controller.handle({version:1,id:'logout',op:'logout'});await clearing.promise;
 const status=controller.handle({version:1,id:'status',op:'status'}),quota=controller.handle({version:1,id:'quota',op:'quota',models:[model]});
 try{await tick();assert.equal(queries,0);}finally{release.resolve();await logout;}
 assert.equal((await status).data.authenticated,false);assert.equal((await quota).ok,false);await controller.close();
});
