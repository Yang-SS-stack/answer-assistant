import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings,publicSettings} from '../src/storage/settings.js';
import {callModel} from '../src/providers/client.js';
import {bindCourse} from '../src/storage/context.js';

const url='https://examination.xuetangx.com/exam/dual';
const course={name:'课程',language:'Python',requirements:'测试'};
const question={id:'q',type:'single',stem:'题目',options:[],images:[]};
const base=()=>bindCourse(normalizeSettings({reviewMode:'enhanced',providers:{deepseek:{apiKey:'fake-answer'},qwen:{apiKey:'fake-review'}}}),url,course);
test('schema 4 migration preserves keys, primary model and course while exposing safe reviewer metadata',()=>{
 const s=base();assert.equal(s.schemaVersion,4);assert.equal(s.providers.deepseek.apiKey,'fake-answer');assert.equal(s.providers.qwen.apiKey,'fake-review');assert.equal(s.providers.qwen.model,'qwen-plus');assert.deepEqual(s.reviewer,{provider:'qwen',model:'qwen3.7-flash',thinking:true});
 const p=publicSettings(s,url);assert.equal(p.course.name,course.name);assert.equal(p.reviewer.model,'qwen3.7-flash');assert.equal(p.reviewer.configured,true);assert.equal(p.reviewer.capabilities.vision,true);assert.equal(JSON.stringify(p).includes('fake-'),false);
 const overridden=normalizeSettings({...s,providers:{...s.providers,qwen:{...s.providers.qwen,modelCapabilities:{'qwen3.7-flash':{vision:false}}}}});assert.equal(publicSettings(overridden,url).reviewer.capabilities.vision,false);
});
test('roles preserve primary config and forbid standard review or missing reviewer key',async()=>{
 const {selectRole}=await import('../src/providers/roles.js');const s=base();
 assert.equal(selectRole(s,'answer').profile.model,'deepseek-flash');assert.equal(selectRole(s,'independent').profile.model,'qwen3.7-flash');assert.equal(selectRole(s,'review').profile.apiKey,'fake-review');
 const standard=normalizeSettings({...s,reviewMode:'standard',providers:{...s.providers,qwen:{apiKey:''}}});assert.equal(selectRole(standard,'answer').profile.apiKey,'fake-answer');assert.throws(()=>selectRole(standard,'review'),/REVIEW_MODE_REQUIRED/);
 assert.throws(()=>selectRole(normalizeSettings({...s,providers:{...s.providers,qwen:{apiKey:''}}}),'independent'),/REVIEW_KEY_REQUIRED/);
});
test('custom reviewer model and thinking preserve primary Qwen profile and exact model capability overrides',async()=>{
 const {selectRole}=await import('../src/providers/roles.js');
 const s=normalizeSettings({...base(),reviewer:{provider:'qwen',model:'  qwen-other  '}});
 assert.equal(s.reviewer.model,'qwen-other');assert.equal(s.reviewer.thinking,false);assert.equal(s.providers.qwen.model,'qwen-plus');assert.equal(s.providers.qwen.apiKey,'fake-review');
 assert.deepEqual(selectRole(s,'independent').profile.capabilities,{vision:false});assert.equal(selectRole(s,'independent').profile.model,'qwen-other');
 const known=normalizeSettings({...base(),reviewer:{model:'qwen3.7-flash',thinking:false}});assert.equal(known.reviewer.thinking,false);
 const explicit=normalizeSettings({...s,reviewer:{...s.reviewer,thinking:true},providers:{...s.providers,qwen:{...s.providers.qwen,modelCapabilities:{'qwen-other':{vision:true}}}}});assert.equal(selectRole(explicit,'independent').profile.capabilities.vision,true);assert.equal(explicit.reviewer.thinking,true);
 assert.equal(normalizeSettings({...s,reviewer:{model:'x'.repeat(121)}}).reviewer.model.length,120);
});
test('Qwen emits explicit thinking with JSON while DeepSeek has no Qwen-only field',async()=>{
 for(const provider of ['qwen','deepseek']){let body;await callModel({...base().providers[provider],provider,thinking:true},question,{fetchImpl:async(_u,o)=>{body=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{}'}}]})};}});assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.enable_thinking,provider==='qwen'?true:undefined);}
});

let instance=0;
async function fixture(t,{pause=false}={}){
 const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch;let listener,stored=base(),started,release,taskToken,bootstrap=false;let ready=new Promise(r=>started=r);const calls=[];
 globalThis.chrome={runtime:{id:'synthetic',getURL:p=>'chrome-extension://synthetic/'+p,onMessage:{addListener(fn){listener=fn;}}},storage:{local:{setAccessLevel(){},get:async()=>({aaV4settings:structuredClone(stored)}),set:async data=>{stored=structuredClone(data.aaV4settings);}}},tabs:{onRemoved:{addListener(){}}}};
 globalThis.fetch=async(endpoint,options)=>{if(!bootstrap){calls.push({endpoint,options,body:JSON.parse(options.body)});started();if(pause)await new Promise(r=>release=r);}return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'synthetic-content',reasoning_content:'must-never-leak'}}]})};};
 await import('../src/background.js?dual-test='+(++instance));t.after(()=>{release?.();globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;});
 const page={id:'synthetic',url,tab:{id:1},frameId:0,documentId:'doc'},ui={id:'synthetic',url:'chrome-extension://synthetic/src/ui/popup.html'};
 const raw=(m,sender=page)=>new Promise(r=>listener(m,sender,r));
 // Independent-role fixtures bootstrap a real first-answer handshake separately from the requests under test.
 const send=async(m,sender=page)=>{
  if(m.action==='MODEL_REQUEST'){
   if(!taskToken&&m.purpose&&m.purpose!=='answer'){bootstrap=true;try{const first=await raw({...request(),beginTask:true,includeSource:true},sender);taskToken=first.data?.taskToken;}finally{bootstrap=false;}}
   const result=await raw({...m,includeSource:true,...(taskToken?{taskToken}:{beginTask:true})},sender);if(result.ok)taskToken=result.data.taskToken;
   return result.ok&&m.includeSource!==true?{ok:true,data:result.data.content}:result;
  }
  return raw(m.action==='TASK_VALIDATE'?{...m,taskToken}:m,sender);
 };
 return{calls,raw,get ready(){return ready;},pause(){pause=true;ready=new Promise(r=>started=r);},release:()=>release?.(),send,restart:()=>import('../src/background.js?dual-test='+(++instance)),save:s=>raw({action:'SETTINGS_SAVE',settings:s},ui),get stored(){return structuredClone(stored);},replace:s=>stored=structuredClone(s)};
}
const request=(purpose='answer',extra={})=>({action:'MODEL_REQUEST',taskId:'task',requestId:'request',purpose,question,...extra});
test('background routes independent review to exact Qwen model and wraps only explicit source requests',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.send(request()),{ok:true,data:'synthetic-content'});
 const r=await f.send(request('independent',{includeSource:true}));assert.equal(f.calls[0].body.model,'deepseek-flash');assert.equal(f.calls[1].body.model,'qwen3.7-flash');assert.equal(f.calls[1].body.enable_thinking,true);assert.equal(typeof r.data.taskToken,'string');assert.deepEqual(r,{ok:true,data:{transport:1,content:'synthetic-content',source:{provider:'qwen',model:'qwen3.7-flash',role:'independent',thinking:true},taskToken:r.data.taskToken}});
});
test('missing reviewer key and explicitly disabled image capability fail without primary fallback',async t=>{
 const f=await fixture(t);f.replace(normalizeSettings({...f.stored,providers:{...f.stored.providers,qwen:{apiKey:''}}}));assert.match((await f.send(request('independent'))).error,/REVIEW_KEY_REQUIRED/);assert.equal(f.calls.length,0);
 const imageFixture=await fixture(t);imageFixture.replace(normalizeSettings({...base(),providers:{...base().providers,qwen:{apiKey:'fake-review',modelCapabilities:{'qwen3.7-flash':{vision:false}}}}}));assert.match((await imageFixture.send(request('independent',{question:{...question,images:[{dataUrl:'data:image/png;base64,AA'}]}}))).error,/VISION_UNVERIFIED/);assert.equal(imageFixture.calls.length,0);
});
for(const purpose of ['answer','independent'])test('cancel task aborts '+purpose+' and refuses late response',async t=>{
 const f=await fixture(t,{pause:true});const pending=f.send(request(purpose));await f.ready;await f.send({action:'CANCEL_TASK',taskId:'task'});assert.equal(f.calls[0].options.signal.aborted,true);f.release();assert.match((await pending).error,/STOPPED/);
});
for(const purpose of ['answer','independent'])test('relevant role config mutation aborts '+purpose+' and refuses late response',async t=>{
 const f=await fixture(t,{pause:true});const pending=f.send(request(purpose));await f.ready;const s=f.stored,id=purpose==='answer'?'deepseek':'qwen';s.providers[id].apiKey='changed-fake';await f.save(s);assert.equal(f.calls[0].options.signal.aborted,true);f.release();assert.match((await pending).error,/MODEL_CONFIG_CHANGED/);
});
test('external config change rejects stale reviewer response even without save handler',async t=>{
 const f=await fixture(t,{pause:true});const pending=f.send(request('independent'));await f.ready;f.replace({...f.stored,reviewMode:'standard'});f.release();assert.match((await pending).error,/MODEL_CONFIG_CHANGED/);
});
test('unbound Qwen primary model and ordinary UI settings preserve pending reviewer response',async t=>{
 const f=await fixture(t,{pause:true});const pending=f.send(request('independent'));await f.ready;const s=f.stored;s.speed='fast';s.providers.qwen.model='other-primary';await f.save(s);assert.equal(f.calls[0].options.signal.aborted,false);f.release();assert.equal((await pending).ok,true);
});
test('standard background answer needs no reviewer key and refuses second role without a network request',async t=>{
 const f=await fixture(t);f.replace(normalizeSettings({...f.stored,reviewMode:'standard',providers:{...f.stored.providers,qwen:{apiKey:''}}}));assert.equal((await f.send(request())).ok,true);assert.match((await f.send(request('independent'))).error,/REVIEW_MODE_REQUIRED/);assert.equal(f.calls.length,1);
});
for(const mutation of ['model','thinking','vision','mode'])test('reviewer '+mutation+' change aborts only affected role',async t=>{
 const f=await fixture(t,{pause:true});const pending=f.send(request('independent'));await f.ready;const s=f.stored;
 if(mutation==='model')s.reviewer.model='qwen-other';if(mutation==='thinking')s.reviewer.thinking=false;if(mutation==='vision')s.providers.qwen.modelCapabilities['qwen3.7-flash']={vision:false};if(mutation==='mode')s.reviewMode='standard';
 await f.save(s);assert.equal(f.calls[0].options.signal.aborted,true);f.release();assert.match((await pending).error,/MODEL_CONFIG_CHANGED/);
});
test('reviewer changes preserve standard pending primary request',async t=>{
 const f=await fixture(t,{pause:true});f.replace({...f.stored,reviewMode:'standard'});const pending=f.send(request('answer'));await f.ready;const s=f.stored;s.reviewer.model='qwen-other';s.providers.qwen.apiKey='changed-reviewer';s.speed='fast';await f.save(s);assert.equal(f.calls[0].options.signal.aborted,false);f.release();assert.equal((await pending).ok,true);
});
test('primary mutation while second response pending invalidates the whole enhanced task',async t=>{
 const f=await fixture(t);assert.equal((await f.send(request())).ok,true);f.pause();const pending=f.send(request('independent',{requestId:'second'}));await f.ready;const s=f.stored;s.providers.deepseek.model='changed-primary';await f.save(s);assert.equal(f.calls[1].options.signal.aborted,true);f.release();assert.match((await pending).error,/MODEL_CONFIG_CHANGED/);
});
test('reviewer mutation after first answer rejects second request before fetch',async t=>{
 const f=await fixture(t);await f.send(request());const s=f.stored;s.reviewer.model='qwen-other';await f.save(s);assert.match((await f.send(request('independent',{requestId:'second'}))).error,/MODEL_CONFIG_CHANGED/);assert.equal(f.calls.length,1);
});
test('task validation catches changed config after both responses before write',async t=>{
 const f=await fixture(t);await f.send(request());await f.send(request('independent',{requestId:'second'}));assert.deepEqual(await f.send({action:'TASK_VALIDATE',taskId:'task'}),{ok:true,data:{valid:true}});const s=f.stored;s.providers.deepseek.apiKey='changed-primary';await f.save(s);assert.match((await f.send({action:'TASK_VALIDATE',taskId:'task'})).error,/MODEL_CONFIG_CHANGED/);
});
test('validation rechecks external changes, respects course scope and cancellation',async t=>{
 const f=await fixture(t);await f.send(request());f.replace(bindCourse(f.stored,url,{...course,language:'Java'}));assert.match((await f.send({action:'TASK_VALIDATE',taskId:'task'})).error,/COURSE_CHANGED/);await f.send({action:'CANCEL_TASK',taskId:'task'});assert.match((await f.send({action:'TASK_VALIDATE',taskId:'task'})).error,/STOPPED/);
});
test('public settings does not pin a task binding and unknown task validation fails',async t=>{
 const f=await fixture(t);await f.send({action:'PUBLIC_SETTINGS'});assert.match((await f.send({action:'TASK_VALIDATE',taskId:'task'})).error,/TASK_NOT_FOUND/);const s=f.stored;s.reviewer.model='qwen-other';await f.save(s);assert.equal((await f.send(request('independent'))).ok,true);
});
test('same document navigating to a differently bound course cannot reuse task results',async t=>{
 const f=await fixture(t);await f.send(request());const other='https://examination.xuetangx.com/exam/other';await f.save(bindCourse(f.stored,other,{...course,name:'其他课'}));const sender={id:'synthetic',url:other,tab:{id:1},frameId:0,documentId:'doc'};assert.match((await f.send({action:'TASK_VALIDATE',taskId:'task'},sender)).error,/COURSE_CHANGED/);
});
test('reviewer thinking false reaches Qwen request and safe source',async t=>{
 const f=await fixture(t);f.replace(normalizeSettings({...f.stored,reviewer:{model:'qwen-other',thinking:false}}));const r=await f.send(request('independent',{includeSource:true}));assert.equal(f.calls[0].body.model,'qwen-other');assert.equal(f.calls[0].body.enable_thinking,false);assert.equal(r.data.source.thinking,false);
});
test('restart rejects reviewer and next-question answer continuations, plus write validation',async t=>{
 const f=await fixture(t);const first=await f.raw(request('answer',{beginTask:true,includeSource:true}));assert.equal(typeof first.data.taskToken,'string');const taskToken=first.data.taskToken;await f.restart();for(const purpose of ['answer','independent'])assert.match((await f.raw(request(purpose,{requestId:'continuation',taskToken}))).error,/TASK_NOT_FOUND/);assert.match((await f.raw({action:'TASK_VALIDATE',taskId:'task',taskToken})).error,/TASK_NOT_FOUND/);assert.equal(f.calls.length,1);
});
test('binding requires explicit first answer and opaque token on every continuation',async t=>{
 const f=await fixture(t);assert.match((await f.raw(request('independent',{beginTask:true}))).error,/TASK_NOT_FOUND/);const first=await f.raw(request('answer',{beginTask:true,includeSource:true}));assert.equal(typeof first.data.taskToken,'string');assert.match((await f.raw(request('answer',{beginTask:true}))).error,/TASK_ALREADY_STARTED/);assert.match((await f.raw(request('independent',{taskToken:'wrong'}))).error,/TASK_TOKEN_INVALID/);assert.match((await f.raw({action:'TASK_VALIDATE',taskId:'task',taskToken:'wrong'})).error,/TASK_TOKEN_INVALID/);assert.equal(f.calls.length,1);
});
test('raw response compatibility requires a first-answer handshake and never exposes token or fingerprint',async t=>{
 const f=await fixture(t);const result=await f.raw(request('answer',{beginTask:true}));assert.deepEqual(result,{ok:true,data:'synthetic-content'});assert.match((await f.raw(request('answer',{requestId:'next'}))).error,/TASK_TOKEN_INVALID/);assert.equal(f.calls.length,1);
});
