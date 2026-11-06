import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnswer,sameAnswer} from '../src/core/answers.js';
import {Runner} from '../src/core/runner.js';
import {normalizeSettings,switchProvider} from '../src/storage/settings.js';
import {callModel} from '../src/providers/client.js';
const question={id:'q1',type:'single',stem:'测试题',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],blankCount:0,images:[]};
const valid={questionId:'q1',type:'single',optionIds:['B']};
test('strict structured answers preserve identity and never invent defaults',()=>{
 assert.deepEqual(validateAnswer(JSON.stringify(valid),question),valid);
 for(const bad of ['', '答案是 B', '2. B','{}',JSON.stringify({...valid,questionId:'q2'}),JSON.stringify({...valid,optionIds:['Z']}),JSON.stringify({...valid,optionIds:[]}),JSON.stringify({...valid,optionIds:['A','B']}),JSON.stringify({...valid,status:'uncertain'}),JSON.stringify({...valid,explanation:'maybe'})]) assert.throws(()=>validateAnswer(bad,question));
});
test('multi choice rejects duplicates; blanks must match count; judge requires boolean',()=>{
 assert.throws(()=>validateAnswer({...valid,type:'multiple',optionIds:['A','A']},{...question,type:'multiple'}));
 assert.throws(()=>validateAnswer({questionId:'q1',type:'fill',blanks:['x']},{...question,type:'fill',blankCount:2}));
 assert.throws(()=>validateAnswer({questionId:'q1',type:'judge',booleanValue:'true'},{...question,type:'judge'}));
 assert.deepEqual(validateAnswer({questionId:'q1',type:'fill',blanks:['甲','乙']},{...question,type:'fill',blankCount:2}).blanks,['甲','乙']);
});
function setup(overrides={}) {let writes=0;const stages=[];const adapter={findQuestions:()=>[question],extractQuestion:q=>q,readCurrentAnswer:()=>null,checkWritable:()=>true,writeAnswer:async()=>{writes++;},verifyAnswer:async()=>true,...overrides};return{adapter,stages,get writes(){return writes;}};}
test('stop while request pending rejects late answer and performs no write',async()=>{
 const f=setup();const runner=new Runner();let release,signal;let started;const ready=new Promise(r=>started=r);
 const task=runner.run({adapter:f.adapter,settings:{},request:(_,s)=>{signal=s;started();return new Promise(r=>release=r);}});
 await ready;runner.stop();release(valid);await task;assert.equal(signal.aborted,true);assert.equal(f.writes,0);assert.equal(runner.snapshot().state,'stopped');
});
test('verification failure halts entire page before the next request',async()=>{
 const f=setup({findQuestions:()=>[question,{...question,id:'q2'}],verifyAnswer:async()=>false});let requests=0;
 const runner=new Runner();await runner.run({adapter:f.adapter,settings:{},request:async()=>{requests++;return valid;}});
 assert.equal(requests,1);assert.equal(runner.snapshot().completed,0);assert.equal(runner.snapshot().failed,1);assert.equal(runner.snapshot().state,'failed');
});
test('existing answers are skipped before model call, images without capability are skipped',async()=>{
 for(const adapterOverride of [{readCurrentAnswer:()=>['A']},{findQuestions:()=>[{...question,images:[{url:'data:image/png;base64,AA'}]}]}]) {
 const f=setup(adapterOverride);const runner=new Runner();await runner.run({adapter:f.adapter,settings:{existing:'skip',capabilities:{vision:false}},request:()=>{throw Error('must not request');}});assert.equal(runner.snapshot().skipped,1);assert.equal(f.writes,0);}
});
test('settings isolate provider secrets and preserve model capabilities',()=>{
 let s=normalizeSettings({provider:'deepseek',providers:{deepseek:{apiKey:'secret1',model:'custom',capabilities:{vision:true}},qwen:{apiKey:'secret2',model:'qwen-plus'}}});
 s=switchProvider(s,'qwen');assert.equal(s.providers.deepseek.apiKey,'secret1');assert.equal(s.providers.qwen.apiKey,'secret2');assert.equal(s.providers.deepseek.capabilities.vision,true);assert.equal(normalizeSettings(s).providers.deepseek.model,'custom');
});
test('blank order is significant while multiple-choice order is not',()=>{assert.equal(sameAnswer(['a','b'],['b','a'],'fill'),false);assert.equal(sameAnswer(['A','B'],['B','A'],'multiple'),true);});
test('restart cannot overlap an aborted but unsettled task',async()=>{const f=setup();const r=new Runner();let release,started;const ready=new Promise(resolve=>started=resolve);const pending=r.run({adapter:f.adapter,request:()=>{started();return new Promise(resolve=>release=resolve);}});await ready;r.stop();await assert.rejects(r.run({adapter:f.adapter,request:()=>valid}),/TASK_STOPPING/);release(valid);await pending;assert.equal(f.writes,0);});
const provider={apiKey:'fake',model:'test',endpoint:'https://api.deepseek.com/chat/completions',capabilities:{vision:false},timeoutMs:100,maxRetries:1};
const response=(status,body)=>({ok:status<300,status,json:async()=>body});
test('401 is not retried or echoed; 429 retries finitely',async()=>{
 let calls=0;await assert.rejects(callModel(provider,question,{fetchImpl:async()=>{calls++;return response(401,{secret:'not echoed'});}}),/API_KEY/);assert.equal(calls,1);
 calls=0;await assert.rejects(callModel({...provider,retryDelayMs:1},question,{fetchImpl:async()=>{calls++;return response(429,{});}}),/RATE_LIMIT/);assert.equal(calls,2);
});
test('empty or truncated model response fails explicitly',async()=>{
 for(const message of [{choices:[]},{choices:[{finish_reason:'length',message:{content:JSON.stringify(valid)}}]}]) await assert.rejects(callModel(provider,question,{fetchImpl:async()=>response(200,message)}));
});
test('provider timeout aborts a stalled network request',async()=>{
 await assert.rejects(callModel({...provider,timeoutMs:10,maxRetries:0},question,{fetchImpl:(_,opts)=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason)))}),/TIMEOUT/);
});
test('provider cancellation aborts without retry',async()=>{
 const controller=new AbortController();let calls=0;
 const task=callModel(provider,question,{signal:controller.signal,fetchImpl:(_,opts)=>{calls++;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason)));}});controller.abort();await assert.rejects(task);assert.equal(calls,1);
});

test('timeout retries within configured limit and a successful retry returns the answer',async()=>{
 let calls=0;const signals=[];
 const result=await callModel({...provider,timeoutMs:10,maxRetries:1,retryDelayMs:0},question,{fetchImpl:(_,opts)=>{
  calls++;signals.push(opts.signal);
  if(calls===1)return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));
  return Promise.resolve(response(200,{choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}]}));
 }});
 assert.equal(calls,2);assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);assert.deepEqual(JSON.parse(result),valid);
});

test('repeated timeouts stop at the retry limit',async()=>{
 let calls=0;
 await assert.rejects(callModel({...provider,timeoutMs:5,maxRetries:1,retryDelayMs:0},question,{fetchImpl:(_,opts)=>{
  calls++;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));
 }}),/TIMEOUT/);
 assert.equal(calls,2);
});

test('user cancellation during timeout retry backoff starts no further request',async()=>{
 const controller=new AbortController();let calls=0,notifyTimeout;
 const timedOut=new Promise(resolve=>notifyTimeout=resolve);
 const task=callModel({...provider,timeoutMs:5,maxRetries:1,retryDelayMs:1000},question,{signal:controller.signal,fetchImpl:(_,opts)=>{
  calls++;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>{notifyTimeout();reject(opts.signal.reason);},{once:true}));
 }});
 // Attach the rejection observer before cancellation so no rejection is unhandled.
 const settled=task.then(()=>({ok:true}),error=>({ok:false,error}));
 await timedOut;await new Promise(resolve=>setImmediate(resolve));controller.abort(Error('STOPPED'));
 const result=await settled;assert.equal(result.ok,false);assert.match(result.error.message,/STOPPED/);assert.equal(calls,1);
});
