import test from 'node:test';import assert from 'node:assert/strict';
import {parseModelResult} from '../src/core/model-result.js';import {Runner} from '../src/core/runner.js';
import {diagnosticExport} from '../src/diagnostics/export.js';import {callModel} from '../src/providers/client.js';
const source={provider:'qwen',model:'qwen3.7-flash',role:'independent',thinking:true};
function fixture(type){const q={id:'zhs-synthetic-abcdefgh',number:'8',type,stem:'合成题',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],blankCount:type==='fill'?1:0,images:[]};const answer={questionId:q.id,type,...(type==='single'||type==='multiple'?{optionIds:['A']}:type==='judge'?{booleanValue:true}:type==='fill'?{blanks:['甲']}:{text:'甲'})};return{q,answer,envelope:{protocol:1,questionId:q.id,type,answer,summary:'',observations:[],limitations:[]}};}
for(const type of ['single','multiple','judge','fill','subjective'])for(const layer of ['result','answer'])for(const field of ['questionId','type'])test(type+'/'+layer+'/'+field+' mismatch is rejected with exact bounded field evidence',()=>{
 const {q,envelope}=fixture(type),bad=structuredClone(envelope),value=field==='questionId'?'zhs-wrong-question':'unknown';(layer==='result'?bad:bad.answer)[field]=value;
 assert.throws(()=>parseModelResult({transport:1,content:JSON.stringify(bad),source},q),e=>{assert.match(e.message,/ANSWER_IDENTITY/);assert.equal(e.modelFailure.layer,layer);assert.deepEqual(e.modelFailure.mismatchedFields,[field]);assert.equal(e.modelFailure.expected[field],q[field==='questionId'?'id':'type']);assert.equal(e.modelFailure.received[field],value);assert.deepEqual(e.modelFailure.source,source);return true;});
});
test('malformed identity values expose shape only; no response text, candidate or credentials',()=>{
 const {q,envelope}=fixture('single');for(const value of [undefined,null,123,{},['x'],'x'.repeat(10000),'secret sentence with spaces','sk-'+'x'.repeat(32),'https://private.test/key']){
  const bad={...envelope,questionId:value,apiKey:'do-not-copy',summary:'do-not-copy'};assert.throws(()=>parseModelResult(bad,q),e=>{const f=e.modelFailure;assert.equal(f.received.questionId,null);assert.equal(typeof f.kinds.questionId,'string');assert(!JSON.stringify(f).includes('do-not-copy'));assert(JSON.stringify(f).length<1600);return true;});
 }
});
test('identity failure survives runner checkpoint export with independent source, no write or review; restart retries',async()=>{
 const {q,answer,envelope}=fixture('multiple');let current=null,writes=0,saves=0,calls=0;
 const adapter={findQuestions:()=>[q],extractQuestion:x=>x,readCurrentAnswer:()=>current,checkWritable:()=>true,writeAnswer:async()=>{writes++;current=['A'];},verifyAnswer:async()=>true};
 const runner=new Runner(),base={adapter,settings:{mode:'single',reviewMode:'enhanced'},onReview:async()=>{saves++;}};
 const failed=await runner.run({...base,request:async(_,signal,meta)=>{calls++;return meta?{transport:1,source,content:JSON.stringify({...envelope,answer:{...answer,type:'single'}})}:answer;}});
 assert.equal(failed.state,'failed');assert.equal(writes,0);assert.equal(saves,0);assert.equal(failed.reviewPending,0);assert.equal(calls,2);assert.equal(failed.modelFailure.layer,'answer');assert.equal(failed.results.at(-1).modelFailure.source.role,'independent');assert.equal(failed.results.at(-1).number,'8');
 const paper='https://examination.xuetangx.com/exam/identity-fixture',out=diagnosticExport({paperKey:paper,state:{state:'idle'},checkpoint:{...failed,url:paper,taskToken:'not-exported'}});assert.deepEqual(out.previousRun.modelFailure,failed.modelFailure);assert(!JSON.stringify(out).includes('not-exported'));
 calls=0;const retry=await runner.run({...base,request:async()=>{calls++;return answer;}});assert.equal(retry.state,'done');assert.equal(calls,2);assert.equal(writes,1);assert.equal(retry.modelFailure,undefined);
});
test('outbound model schema pins both identity copies and explicitly forbids rewriting for every type and role',async()=>{
 for(const type of ['single','multiple','judge','fill','subjective'])for(const purpose of ['answer','independent']){
  const {q}=fixture(type);await callModel({apiKey:'synthetic-only',endpoint:'https://api.deepseek.com/chat/completions',model:'synthetic',timeoutMs:1000},q,{purpose,fetchImpl:async(url,o)=>{const b=JSON.parse(o.body),text=b.messages[0].content;assert.match(text,/questionId.*原样复制/);assert.match(text,/外层.*answer.*一致/);const schema=JSON.parse(text.split('严格使用此结构：')[1]);assert.equal(schema.questionId,q.id);assert.equal(schema.answer.questionId,q.id);assert.equal(schema.type,type);assert.equal(schema.answer.type,type);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'synthetic'}}]})};}});
 }
});
