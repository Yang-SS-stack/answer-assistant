import test from 'node:test';import assert from 'node:assert/strict';
import {bindCourse,courseForUrl} from '../src/storage/context.js';
import {normalizeSettings} from '../src/storage/settings.js';
import {validateReview,languageIssue} from '../src/core/review.js';
import {Runner} from '../src/core/runner.js';import {callModel} from '../src/providers/client.js';
const url='https://examination.xuetangx.com/exam/123?isFrom=2';const course={name:'Python程序设计',language:'Python',requirements:'按本课程教材回答，不混入其他语言规则'};
const q={id:'q1',type:'single',stem:'测试题',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],blankCount:0,images:[]};const answer={questionId:'q1',type:'single',optionIds:['A']};
test('model prompt separates page label and answer content from the returned stable ID',async()=>{let body;const shuffled={...q,options:[{id:'C',displayLabel:'A',text:'C'},{id:'B',displayLabel:'D',text:'B'}]};await callModel({apiKey:'synthetic',endpoint:'https://api.deepseek.com/chat/completions',model:'test'},shuffled,{fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{}'}}]})};}});assert.deepEqual(JSON.parse(body.messages[1].content).options,shuffled.options);assert.match(body.messages[0].content,/displayLabel/);assert.match(body.messages[0].content,/答案内容/);assert.match(body.messages[0].content,/optionIds/);});
test('objective disagreement and uncertain re-answer have distinct review reasons',async()=>{for(const uncertain of [false,true]){const f=fixture(),r=new Runner();let record;await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async(q,s,meta)=>!meta?answer:uncertain?{status:'uncertain'}:{...answer,optionIds:['B']},onReview:async value=>record=value});assert.match(record.review.reason,uncertain?/复答未提供确定答案/:/答案不同/);assert.equal(f.writes,0);}});
test('old settings retain keys; courses bind only to their exam and preserve other courses',()=>{let s=normalizeSettings({providers:{deepseek:{apiKey:'keep-me'}}});assert.equal(s.reviewMode,'standard');s=bindCourse(s,url,course);s=bindCourse(s,'https://examination.xuetangx.com/exam/456',{name:'大学英语',language:'英语',requirements:'根据原文'});s=normalizeSettings(s);assert.equal(s.providers.deepseek.apiKey,'keep-me');assert.match(courseForUrl(s,url).requirements,/Python/);assert.equal(courseForUrl(s,'https://examination.xuetangx.com/exam/789').name,'');assert.equal(courseForUrl(s,'https://examination.xuetangx.com/exam/456').name,'大学英语');});
test('review requires matching identity, valid decision, and no issues for pass',()=>{const pass={questionId:q.id,type:q.type,status:'pass',issues:[],reason:'一致'};assert.equal(validateReview(pass,q).status,'pass');for(const bad of [{...pass,questionId:'wrong'},{...pass,status:'yes'},{...pass,issues:['有错误']},{...pass,reason:''},{...pass,extra:true}])assert.throws(()=>validateReview(bad,q));});
test('language guard targets explicit programming requests, not prose mentioning Java',()=>{const code={...q,type:'subjective',stem:'编程实现继承，写出代码'};assert.match(languageIssue(code,{text:'class Child extends Master {}'},course),/Python/);assert.equal(languageIssue({...code,stem:'请用 Java 编程实现继承'},{text:'class Child extends Master {}'},course),null);assert.equal(languageIssue({...code,stem:'解释 Python 与 Java 的区别'},{text:'Java 使用 extends'},course),null);assert.equal(languageIssue(code,{text:'class A:\n    pass'},course),null);});
function fixture(question=q){let writes=0;return{adapter:{supportsSubjective:true,findQuestions:()=>[question],extractQuestion:x=>x,readCurrentAnswer:()=>null,checkWritable:()=>true,writeAnswer:async()=>writes++,verifyAnswer:async()=>true},get writes(){return writes;}};}
const evidence=(question,answer,extra={})=>({protocol:1,questionId:question.id,type:question.type,answer,summary:'可核对的依据摘要',observations:['题干已观察'],limitations:[],...extra});
test('automatic completion retains a serializable original question for later audit',async()=>{const question={...q,number:'1',element:{nodeType:1}},f=fixture(question),r=new Runner();await r.run({adapter:f.adapter,settings:{mode:'single',course},request:async()=>answer});const row=r.snapshot().results[0];assert.equal(row.question.stem,q.stem);assert.deepEqual(row.question.options,q.options);assert.equal(row.question.element,undefined);assert.equal(row.course.name,course.name);question.options[0].text='changed after completion';assert.equal(row.question.options[0].text,'甲');question.options[0].text='甲';});
test('fill and subjective both solve independently without a candidate and preserve two outputs',async()=>{
 for(const type of ['fill','subjective'])for(const agrees of [true,false]){
  const question={...q,type,blankCount:type==='fill'?1:0},first={questionId:q.id,type,...(type==='fill'?{blanks:['甲']}:{text:'甲'})},peer={...first,...(type==='fill'?{blanks:[agrees?'甲':'乙']}:{text:agrees?'甲':'乙'})},f=fixture(question),r=new Runner();let calls=0,record;
  await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async(question,signal,meta)=>{calls++;if(calls===2){assert.deepEqual(meta,{purpose:'independent'});}return evidence(question,calls===1?first:peer);},onReview:async value=>record=value});
  assert.equal(calls,2);assert.equal(f.writes,agrees?1:0);assert.equal(r.snapshot().state,'done');if(!agrees){assert.deepEqual(record.first.answer,first);assert.deepEqual(record.second.answer,peer);assert.equal(r.snapshot().reviewPending,1);}
 }
});
test('equal valid answers write without requiring summaries or detailed explanations',async()=>{
 for(const weak of [0,1])for(const metadata of [{summary:''},{limitations:['依据尚不充分']}]){
  const f=fixture(),r=new Runner();let calls=0,record;
  await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async()=>evidence(q,answer,calls++===weak?metadata:{}),onReview:async value=>record=value});
  assert.equal(calls,2);assert.equal(f.writes,1);assert.equal(r.snapshot().reviewPending,0);assert.equal(record,undefined);assert.equal(r.snapshot().completed,1);assert.deepEqual(r.snapshot().results[0].second.answer,answer);
 }
});
test('minimal valid equal replies fill only after both return, with exactly two requests',async()=>{const f=fixture(),r=new Runner();let calls=0;await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async()=>{assert.equal(f.writes,0);calls++;return answer;}});assert.equal(calls,2);assert.equal(f.writes,1);assert.equal(r.snapshot().completed,1);});
test('answer prompt requests at most one short sentence rather than detailed explanation',async()=>{let body;await callModel({apiKey:'synthetic',endpoint:'https://api.deepseek.com/chat/completions',model:'test'},q,{fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})};}});assert.match(body.messages[0].content,/一句/);assert.match(body.messages[0].content,/不.*详细解答/);});
test('unconfirmed reviewer vision retains first in failed audit without creating manual review',async()=>{
 const question={...q,images:[{position:'stem'}]},f=fixture(question),r=new Runner();let calls=0,record;
 await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced',capabilities:{vision:true},reviewer:{capabilities:{vision:false}}},request:async()=>{calls++;return evidence(q,answer);},onReview:async value=>record=value});
 assert.equal(calls,1);assert.equal(f.writes,0);assert.equal(record,undefined);assert.deepEqual(r.snapshot().results[0].first.answer,answer);assert.match(r.snapshot().error,/VISION_REQUIRED/);assert.equal(r.snapshot().state,'failed');assert.equal(r.snapshot().reviewPending,0);
});
test('objective review makes independent request without candidate; disagreement never writes',async()=>{const f=fixture(),calls=[];const r=new Runner();await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async(q,s,meta)=>{calls.push(meta);return calls.length===1?answer:{...answer,optionIds:['B']};}});assert.equal(calls.length,2);assert.equal(calls[1].purpose,'independent');assert.equal(calls[1].candidate,undefined);assert.equal(f.writes,0);assert.equal(r.snapshot().reviewPending,1);assert.deepEqual(r.snapshot().results[0].draft,['A']);});
test('legacy critique is not accepted as a fabricated second answer',async()=>{
 const sq={...q,type:'subjective'},draft={questionId:q.id,type:'subjective',text:'候选答案'},f=fixture(sq),r=new Runner();let record;
 await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async(question,signal,meta)=>meta?{questionId:q.id,type:sq.type,status:'pass',issues:[],reason:'旧式复审'}:draft,onReview:async value=>record=value});
 assert.equal(r.snapshot().state,'failed');assert.equal(record,undefined);assert.equal(r.snapshot().results[0].second,null);assert.deepEqual(r.snapshot().results[0].first.answer,draft);assert.equal(f.writes,0);
});
test('stop during review discards late pass and prevents all writes',async()=>{const f=fixture(),r=new Runner();let release,ready;const waiting=new Promise(resolve=>ready=resolve);const task=r.run({adapter:f.adapter,settings:{reviewMode:'enhanced'},request:async(q,s,meta)=>{if(!meta)return answer;ready();return new Promise(resolve=>release=resolve);}});await waiting;r.stop();release(answer);await task;assert.equal(f.writes,0);assert.equal(r.snapshot().state,'stopped');});
test('model prompt carries confirmed course; independent call excludes candidate',async()=>{let body;await callModel({apiKey:'synthetic',endpoint:'https://api.deepseek.com/chat/completions',model:'test'},q,{context:course,purpose:'independent',candidate:answer,fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})};}});const payload=JSON.parse(body.messages[1].content);assert.equal(payload.course.language,'Python');assert.equal(payload.candidate,undefined);assert.match(body.messages[0].content,/独立/);});
test('unknown programming language is held; obvious Java in Python never reaches writer',async()=>{const sq={...q,type:'subjective',stem:'编程实现继承，写出代码'},draft={questionId:q.id,type:'subjective',text:'class Child extends Master {}'};assert.match(languageIssue(sq,draft,{}),/未确认/);const f=fixture(sq),r=new Runner();let calls=0;await r.run({adapter:f.adapter,settings:{mode:'single',course,reviewMode:'enhanced'},request:async()=>{calls++;return draft;}});assert.equal(calls,1);assert.equal(f.writes,0);assert.equal(r.snapshot().reviewPending,1);});
test('review transport failure retains draft and refuses all writes',async()=>{const f=fixture(),r=new Runner();await r.run({adapter:f.adapter,settings:{reviewMode:'enhanced'},request:async(q,s,meta)=>{if(!meta)return answer;throw Error('TIMEOUT');}});assert.equal(f.writes,0);assert.equal(r.snapshot().state,'failed');assert.equal(r.snapshot().stage,'review');assert.deepEqual(r.snapshot().results.at(-1).draft,['A']);});
test('uncertain initial response is pending, not a default answer',async()=>{const f=fixture(),r=new Runner();await r.run({adapter:f.adapter,settings:{mode:'single'},request:async()=>({status:'uncertain'})});assert.equal(f.writes,0);assert.equal(r.snapshot().reviewPending,1);});
test('disagreement awaits serializable review snapshot retaining two real results',async()=>{
 const question={...q,number:'7',element:{nodeType:1},images:[{position:'stem',dataUrl:'secret',element:{nodeType:1}}]},f=fixture(question),r=new Runner();let calls=0,record;
 await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced',capabilities:{vision:true},reviewer:{capabilities:{vision:true}},course},request:async()=>{calls++;return{protocol:1,questionId:q.id,type:q.type,answer:{...answer,optionIds:[calls===1?'A':'B']},summary:calls===1?'第一份摘要':'第二份摘要',observations:[],limitations:[]};},onReview:async(value,signal)=>{await Promise.resolve();record=value;assert.equal(signal.aborted,false);}});
 assert.equal(r.snapshot().state,'done');assert.equal(record.first.summary,'第一份摘要');assert.equal(record.second.summary,'第二份摘要');assert.deepEqual(record.first.answer.optionIds,['A']);assert.deepEqual(record.second.answer.optionIds,['B']);assert.equal(record.question.number,'7');assert.deepEqual(record.question.images,[{position:'stem'}]);assert.equal(record.question.element,undefined);assert.deepEqual(record.course,course);assert.equal(record.oldAnswer,null);assert.equal(f.writes,0);
});
test('standard answers make one call and only strict answer reaches writer',async()=>{
 const f=fixture(),r=new Runner();let calls=0,received;f.adapter.writeAnswer=async(q,a)=>received=a;
 await r.run({adapter:f.adapter,settings:{mode:'single'},request:async()=>{calls++;return{protocol:1,questionId:q.id,type:q.type,answer,summary:'摘要',observations:[],limitations:[]};}});assert.equal(calls,1);assert.deepEqual(received,answer);assert.equal(r.snapshot().completed,1);
});
test('runner preserves actual sources from two transport responses in pending review',async()=>{
 const f=fixture(),r=new Runner();let calls=0,record;
 const sources=[{provider:'deepseek',model:'deepseek-chat',role:'answer',thinking:false},{provider:'qwen',model:'custom-qwen-model',role:'independent',thinking:true}];
 await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async()=>{const index=calls++;return{transport:1,content:JSON.stringify(evidence(q,index?{...answer,optionIds:['B']}:answer)),source:sources[index]};},onReview:async value=>record=value});
 assert.equal(calls,2);assert.deepEqual(record.first.source,sources[0]);assert.deepEqual(record.second.source,sources[1]);assert.equal(f.writes,0);
});
test('matching existing answer still logs both actual outputs and sources without rewriting',async()=>{
 const f=fixture(),r=new Runner();f.adapter.readCurrentAnswer=()=>['A'];let calls=0;
 const sources=[{provider:'deepseek',model:'deepseek-chat',role:'answer',thinking:false},{provider:'qwen',model:'qwen3.7-flash',role:'independent',thinking:true}];
 await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced',existing:'replace'},request:async()=>({transport:1,content:JSON.stringify(evidence(q,answer)),source:sources[calls++]})});
 const result=r.snapshot().results[0];assert.equal(calls,2);assert.equal(result.result,'skipped');assert.equal(f.writes,0);assert.deepEqual(result.first.source,sources[0]);assert.deepEqual(result.second.source,sources[1]);
});
test('initial uncertainty snapshot has no fabricated second result or unobserved question number',async()=>{
 const f=fixture({...q,id:'12:abc'}),r=new Runner();let record,calls=0;await r.run({adapter:f.adapter,settings:{reviewMode:'enhanced'},request:async()=>{calls++;return{status:'uncertain'};},onReview:async x=>record=x});assert.equal(calls,1);assert.equal(record.question.number,null);assert.equal(record.first.status,'uncertain');assert.equal(record.second,null);assert.equal(record.first.answer,null);
});
test('review transport failure retains first only in failed audit, outside manual queue',async()=>{
 const f=fixture(),r=new Runner();let record;await r.run({adapter:f.adapter,settings:{reviewMode:'enhanced'},request:async(q,s,meta)=>{if(!meta)return answer;throw Error('TIMEOUT');},onReview:async x=>record=x});assert.equal(record,undefined);assert.deepEqual(r.snapshot().results[0].first.answer,answer);assert.equal(r.snapshot().results[0].second,null);assert.match(r.snapshot().error,/TIMEOUT/);assert.equal(r.snapshot().state,'failed');assert.equal(r.snapshot().reviewPending,0);assert.equal(f.writes,0);
});
test('initial uncertainty with wrong identity is failed rather than pending',async()=>{const f=fixture(),r=new Runner();let reviews=0;await r.run({adapter:f.adapter,request:async()=>({status:'uncertain',questionId:'wrong',type:q.type}),onReview:async()=>reviews++});assert.equal(r.snapshot().state,'failed');assert.equal(reviews,0);assert.equal(f.writes,0);});
test('prompt requests protocol summary and public evidence without hidden chain of thought',async()=>{let body;await callModel({apiKey:'synthetic',endpoint:'https://api.deepseek.com/chat/completions',model:'test'},q,{fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})};}});const prompt=body.messages[0].content;for(const field of ['protocol','summary','observations','limitations'])assert.ok(prompt.includes(field));assert.match(prompt,/公开可核对/);assert.match(prompt,/不.*隐藏.*思维链/);assert.match(prompt,/answer.*null/);});
test('independent subjective output retains bounded public evidence for human review',async()=>{
 const sq={...q,type:'subjective'},f=fixture(sq),r=new Runner();let record;
 const draft={questionId:q.id,type:sq.type,text:'草稿'},peer={...draft,text:'独立候选'};
 await r.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async(question,signal,meta)=>evidence(question,meta?peer:draft,{summary:'x'.repeat(5000),observations:Array(100).fill('y'.repeat(5000)),limitations:['需要外部核实']}),onReview:async x=>record=x});
 assert.deepEqual(record.first.answer,draft);assert.deepEqual(record.second.answer,peer);
 for(const output of [record.first,record.second]){assert.ok(output.summary.length<=1000);assert.ok(output.observations.length<=12);assert.ok(output.observations.every(x=>x.length<=1000));}
 assert.equal(r.snapshot().reviewPending,1);assert.equal(f.writes,0);
});
test('failed review persistence is fail closed and stop during persistence discards late completion',async()=>{const f=fixture(),r=new Runner();await r.run({adapter:f.adapter,request:async()=>({status:'uncertain'}),onReview:async()=>{throw Error('STORAGE_FAILED');}});assert.equal(r.snapshot().state,'failed');assert.match(r.snapshot().error,/STORAGE_FAILED/);assert.equal(f.writes,0);let release,ready;const waiting=new Promise(resolve=>ready=resolve);const task=r.run({adapter:f.adapter,request:async()=>({status:'uncertain'}),onReview:async()=>{ready();await new Promise(resolve=>release=resolve);}});await waiting;r.stop();release();await task;assert.equal(r.snapshot().state,'stopped');assert.equal(r.snapshot().reviewPending,0);});
test('last course check runs before writing and can reject stale context',async()=>{const f=fixture(),r=new Runner();await r.run({adapter:f.adapter,request:async()=>answer,beforeWrite:async()=>{throw Error('COURSE_CHANGED');}});assert.equal(f.writes,0);assert.equal(r.snapshot().stage,'validate');assert.match(r.snapshot().error,/COURSE_CHANGED/);});

test('independent timeout retries without writing; only matching evidence-backed retry allows the answer',async()=>{
 const sq={...q,type:'subjective'},draft={questionId:q.id,type:'subjective',text:'候选答案'};
 const f=fixture(sq),runner=new Runner();let reviewCalls=0;
 const profile={apiKey:'synthetic',model:'test',endpoint:'https://api.deepseek.com/chat/completions',timeoutMs:10,maxRetries:1,retryDelayMs:0};
 await runner.run({adapter:f.adapter,settings:{mode:'single',reviewMode:'enhanced'},request:async(question,signal,meta)=>{
  if(!meta)return evidence(question,draft);
  assert.deepEqual(meta,{purpose:'independent'});
  return callModel(profile,question,{signal,purpose:'independent',fetchImpl:(_,opts)=>{
   reviewCalls++;assert.equal(f.writes,0);
   if(reviewCalls===1)return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));
   return Promise.resolve({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(evidence(question,draft))}}]})});
  }});
 }});
 assert.equal(reviewCalls,2);assert.equal(f.writes,1);assert.equal(runner.snapshot().state,'done');assert.equal(runner.snapshot().completed,1);
});

test('exhausted review timeout preserves draft and stops before the next question',async()=>{
 const sq={...q,type:'subjective'},draft={questionId:q.id,type:'subjective',text:'待复核草稿'};
 const f=fixture(sq);f.adapter.findQuestions=()=>[sq,{...sq,id:'q2'}];const runner=new Runner();let answerCalls=0,reviewCalls=0;
 await runner.run({adapter:f.adapter,settings:{reviewMode:'enhanced'},request:async(question,signal,meta)=>{
  if(!meta){answerCalls++;return draft;}
  return callModel({apiKey:'synthetic',model:'test',endpoint:'https://api.deepseek.com/chat/completions',timeoutMs:5,maxRetries:1,retryDelayMs:0},question,{signal,purpose:'independent',fetchImpl:(_,opts)=>{
   reviewCalls++;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));
  }});
 }});
 const state=runner.snapshot();assert.equal(answerCalls,1);assert.equal(reviewCalls,2);assert.equal(f.writes,0);assert.equal(state.state,'failed');assert.equal(state.stage,'review');assert.match(state.error,/TIMEOUT/);assert.equal(state.results.at(-1).draft,draft.text);
});
