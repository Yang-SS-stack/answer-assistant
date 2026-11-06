import test from 'node:test';
import {pinPlatform} from '../src/platforms/registry.js';
import assert from 'node:assert/strict';
import {selectPlatform} from '../src/platforms/registry.js';
function fixture(){return{detectPage:()=>({supported:true,platform:'样本平台'}),findQuestions:()=>[],extractQuestion:()=>({}),readCurrentAnswer:()=>null,checkWritable:()=>true,writeAnswer:async()=>{},verifyAnswer:async()=>true,timer:()=>'未识别'};}
test('registry keeps the existing Yuketang route and refuses lookalike hosts',()=>{
 const valid=selectPlatform({}, {hostname:'examination.xuetangx.com',pathname:'/exam/sample'});assert.equal(valid.id,'yuketang');assert.equal(valid.adapter.detectPage().supported,true);
 for(const host of ['examination.xuetangx.com.evil.test','example.com']){const r=selectPlatform({}, {hostname:host,pathname:'/exam/sample'});assert.equal(r.adapter.detectPage().supported,false);assert.deepEqual(r.adapter.findQuestions(),[]);}
});
test('one registration predicate failure does not block another platform',()=>{
 const good=fixture(),r=selectPlatform({}, {},[{id:'broken',matches(){throw Error('broken detection');},create:()=>fixture()},{id:'good',matches:()=>true,create:()=>good}]);
 assert.equal(r.adapter,good);assert.equal(r.id,'good');assert.deepEqual(r.errors,[{id:'broken',stage:'match',reason:'broken detection'}]);
});
test('one adapter initialization failure does not block another platform',()=>{
 const good=fixture(),r=selectPlatform({}, {},[{id:'broken',matches:()=>true,create(){throw Error('broken initialization');}},{id:'good',matches:()=>true,create:()=>good}]);
 assert.equal(r.adapter,good);assert.equal(r.errors[0].stage,'initialize');assert.equal(r.errors[0].reason,'broken initialization');
});
test('nonmatching factories are not initialized and incomplete adapters fail closed',()=>{
 let calls=0;const r=selectPlatform({}, {},[{id:'other',matches:()=>false,create:()=>{calls++;return fixture();}},{id:'incomplete',matches:()=>true,create:()=>({detectPage:()=>({supported:true})})}]);
 assert.equal(calls,0);assert.equal(r.adapter.detectPage().supported,false);assert.match(r.errors[0].reason,/ADAPTER_CONTRACT/);assert.equal(r.adapter.timer(),'未识别');
});
test('adapter page detection failure is isolated and unsupported reasons remain available',()=>{
 const broken=fixture();broken.detectPage=()=>{throw Error('changed page');};const r=selectPlatform({}, {},[{id:'broken',matches:()=>true,create:()=>broken}]);
 assert.equal(r.adapter.detectPage().supported,false);assert.equal(r.errors[0].stage,'detect');assert.equal(r.errors[0].reason,'changed page');
 const unsupported=fixture();unsupported.detectPage=()=>({supported:false,reason:'该作业结构未验证'});const absent=selectPlatform({}, {},[{id:'unsupported',matches:()=>true,create:()=>unsupported}]);assert.match(absent.adapter.detectPage().reason,/该作业结构未验证/);
});
test('two supported candidates are refused rather than selecting an uncertain platform',()=>{
 const r=selectPlatform({}, {},[{id:'first',matches:()=>true,create:fixture},{id:'second',matches:()=>true,create:fixture}]);
 assert.equal(r.adapter.detectPage().supported,false);assert.match(r.adapter.detectPage().reason,/ADAPTER_AMBIGUOUS/);assert.equal(r.id,null);
});
test('recognized read-only page retains platform and scene without granting answering capability',()=>{
 const adapter=fixture();adapter.detectPage=()=>({supported:false,platform:'学习通',scene:'已提交或已批改',reason:'PAGE_READ_ONLY：当前页面不可填写'});
 const found=selectPlatform({}, {},[{id:'chaoxing',matches:()=>true,create:()=>adapter}]);
 assert.equal(found.id,null);assert.equal(found.adapter.detectPage().supported,false);assert.equal(found.adapter.detectPage().platform,'学习通');assert.equal(found.adapter.detectPage().scene,'已提交或已批改');assert.match(found.adapter.detectPage().reason,/PAGE_READ_ONLY/);assert.deepEqual(found.adapter.findQuestions(),[]);assert.equal(found.adapter.writeAnswer,undefined);
});
test('multiple rejected adapters do not claim a uniquely identified platform',()=>{
 const create=platform=>()=>({...fixture(),detectPage:()=>({supported:false,platform,scene:'只读',reason:'未允许'})});
 const found=selectPlatform({}, {},[{id:'a',matches:()=>true,create:create('平台甲')},{id:'b',matches:()=>true,create:create('平台乙')}]);assert.equal(found.adapter.detectPage().supported,false);assert.equal(found.adapter.detectPage().platform,undefined);
});

test('pinned pagination callbacks reject another paper before invoking platform code',()=>{let url='https://www.yuketang.cn/ai-workspace/lms-graph/1/exercise/2',calls=0;const adapter=pinPlatform({pagination:{kind:'single-paged',readProgress(){calls++;return this.kind;},advance(){calls++;}}},()=>url);assert.equal(adapter.pagination.readProgress(),'single-paged');url='https://www.yuketang.cn/ai-workspace/lms-graph/1/exercise/3';assert.throws(()=>adapter.pagination.advance(),/PAGE_CHANGED/);assert.throws(()=>adapter.pagination.readProgress(),/PAGE_CHANGED/);assert.equal(calls,1);});
