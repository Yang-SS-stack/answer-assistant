import test from 'node:test';
import assert from 'node:assert/strict';
import {publishStatus} from '../src/diagnostics/public-status.js';
function fixture(){const attrs=new Map();return{documentElement:{setAttribute:(name,value)=>attrs.set(name,value)},read:()=>JSON.parse(attrs.get('data-aa-v4-status'))};}
test('page diagnostics publish only task metadata, excluding configuration, answers and drafts',()=>{
 const doc=fixture();const state={state:'running',stage:'review',questionId:'2-hash',total:19,completed:1,skipped:0,failed:0,reviewPending:0,elapsedMs:123,
  apiKey:'synthetic-private-key',providers:{deepseek:{apiKey:'other-secret'}},course:{name:'private-course'},results:[{draft:'private-draft',oldAnswer:'private-answer'}],taskId:'private-task-id'};
 assert.equal(publishStatus(doc,state,'4.2.2'),true);const actual=doc.read();
 assert.equal(actual.version,'4.2.2');assert.equal(actual.stage,'review');assert.equal(actual.questionId,'2-hash');assert.equal(actual.completed,1);assert(!Number.isNaN(Date.parse(actual.updatedAt)));
 for(const value of ['synthetic-private-key','other-secret','private-course','private-draft','private-answer','private-task-id'])assert(!JSON.stringify(actual).includes(value));
 assert.deepEqual(Object.keys(actual).sort(),['version','updatedAt','state','stage','questionId','total','completed','skipped','failed','reviewPending','elapsedMs','error','auditError'].sort());
});
test('recording failure is visible without exposing records or changing completed counts',()=>{const doc=fixture();publishStatus(doc,{state:'done',stage:'done',completed:10,auditError:'AUDIT_SAVE_FAILED：本地记录保存失败',results:[{draft:'hidden'}]},'test');assert.match(doc.read().auditError,/AUDIT_SAVE_FAILED/);assert.equal(doc.read().completed,10);assert(!JSON.stringify(doc.read()).includes('hidden'));});

test('public pagination status retains only safe progress and capability metadata',()=>{const doc=fixture();publishStatus(doc,{pageFlow:{kind:'single-paged',current:2,total:29,automaticNext:false,persistence:'unverified',stopReason:'persistence-unverified',reachedEnd:false,paperKey:'secret-paper',draft:'hidden-answer',apiKey:'hidden-key'}},'test');const p=doc.read().pageFlow;assert.equal(p.current,2);assert.equal(p.total,29);assert.equal(p.automaticNext,false);assert.equal(p.stopReason,'persistence-unverified');for(const s of ['secret-paper','hidden-answer','hidden-key'])assert(!JSON.stringify(p).includes(s));});
test('failure, stop and subsequent startup replace the previous public snapshot',()=>{
 const doc=fixture();publishStatus(doc,{state:'failed',stage:'review',failed:1,error:'TIMEOUT'},'4.2.2');assert.equal(doc.read().error,'TIMEOUT');
 publishStatus(doc,{state:'stopped',stage:'wait',completed:1},'4.2.2');assert.equal(doc.read().state,'stopped');assert.equal(doc.read().error,null);
 publishStatus(doc,{state:'idle',stage:'wait'},'4.2.2');assert.equal(doc.read().completed,0);assert.equal(doc.read().state,'idle');
});
test('unavailable diagnostic DOM does not interrupt answer execution',()=>{
 assert.equal(publishStatus({}, {state:'idle'},'4.2.2'),false);
 assert.equal(publishStatus({documentElement:{setAttribute(){throw Error('detached');}}},{state:'idle'},'4.2.2'),false);
});

test('local persistence metadata never certifies platform storage or publishes draft contents',()=>{const doc=fixture();publishStatus(doc,{persistenceTarget:'extension-local',localDraftSaved:true,localDraftCount:2001,pageFlow:{kind:'single-paged',persistence:'verified',persistenceTarget:'extension-local',platformPersistence:'unverified',stopReason:'unsupported-input'},localDrafts:[{answer:'private-local-answer'}]},'test');const s=doc.read();assert.equal(s.persistenceTarget,'extension-local');assert.equal(s.localDraftCount,1000);assert.equal(s.localDraftSaved,true);assert.equal(s.pageFlow.stopReason,'unsupported-input');assert.equal(s.pageFlow.persistenceTarget,'extension-local');assert.equal(s.pageFlow.platformPersistence,'unverified');assert(!JSON.stringify(s).includes('private-local-answer'));});
