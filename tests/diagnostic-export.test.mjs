import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticExport} from '../src/diagnostics/export.js';

test('review diagnostics retain first and latest failure without exporting candidates or unrelated papers',()=>{const paper='https://examination.xuetangx.com/exam/review-export';const queue={paperKey:paper,total:1,counts:{pending:1,applied:0},records:[{id:'r',questionId:'q',number:13,type:'multiple',status:'pending',firstFailure:{stage:'verify',reason:'VERIFY_FAILED:first',at:1},lastFailure:{stage:'validate',reason:'ANSWER_CHANGED:second',at:2},question:{stem:'not diagnostic'},first:{private:'candidate'}}]};const report=diagnosticExport({version:'test',paperKey:paper,reviewQueue:queue});assert.equal(report.reviewAttempts.records[0].firstFailure.stage,'verify');assert.equal(report.reviewAttempts.records[0].lastFailure.stage,'validate');assert.equal(report.reviewAttempts.records[0].question,undefined);assert.equal(report.reviewAttempts.records[0].first,undefined);assert.equal(diagnosticExport({paperKey:paper,reviewQueue:{...queue,paperKey:paper+'other'}}).reviewAttempts,undefined);});
const paperKey='https://examination.xuetangx.com/exam/a';
test('idle page export retains matching historical results and model sources without private checkpoint fields',()=>{
 const results=[{id:'q1',first:{source:{provider:'deepseek',model:'test'}},second:{source:{provider:'qwen',model:'qwen3.7-flash'}}}];
 const out=diagnosticExport({version:'test',diagnosis:{count:1},state:{state:'idle',results:[]},paperKey,checkpoint:{url:paperKey,state:'done',completed:1,results,apiKey:'must-not-export',taskId:'internal-task',taskToken:'internal-token'}});
 assert.equal(out.state.state,'idle');assert.equal(out.previousRun.state,'done');assert.deepEqual(out.previousRun.results,results);assert(!JSON.stringify(out).includes('must-not-export'));assert(!JSON.stringify(out).includes('internal-'));
});
test('missing or different paper checkpoints are never mixed into the current export',()=>{
 for(const checkpoint of [null,{}, {url:paperKey+'/other',results:[{id:'wrong-paper'}]}])assert.equal(diagnosticExport({version:'test',paperKey,state:{state:'idle'},checkpoint}).previousRun,null);
});

test('historical pagination metadata survives export alongside execution scope',()=>{const pageFlow={kind:'single-paged',current:3,total:29,automaticNext:false,persistence:'unverified'};const out=diagnosticExport({paperKey,checkpoint:{url:paperKey,state:'done',executionScope:'current-question',pageFlow,results:[]}});assert.deepEqual(out.previousRun.pageFlow,pageFlow);});
