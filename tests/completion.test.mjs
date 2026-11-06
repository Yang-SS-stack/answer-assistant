import test from 'node:test';import assert from 'node:assert/strict';
import {completionMessage} from '../src/core/completion.js';

test('end with pending reviews reports visited end and separate completed/review/skipped counts',()=>{const text=completionMessage({state:'done',executionScope:'paginated',completed:2,skipped:1,reviewPending:3,pageFlow:{current:29,total:29,reachedEnd:true}});assert.match(text,/第 29 \/ 29/);assert.match(text,/填写 2/);assert.match(text,/待复审 3/);assert.match(text,/跳过 1/);assert.match(text,/返回对应题/);assert.doesNotMatch(text,/作答完成/);});
test('completion requires a finished run; failures and stop never report success',()=>{for(const state of ['idle','running','failed','stopped'])assert.equal(completionMessage({state}),null);});
test('full completion asks for review and manual submission',()=>{assert.equal(completionMessage({state:'done',mode:'batch',completed:3,total:3,skipped:0,failed:0}),'作答完成，请检查后手动提交试卷。');});
test('current-question-only adapter never claims entire paper complete or saved',()=>{const message=completionMessage({state:'done',mode:'batch',executionScope:'current-question',canSave:false,completed:1,total:1,skipped:0});assert.match(message,/当前题/);assert.match(message,/暂存.*未验证/);assert.doesNotMatch(message,/作答完成|手动提交试卷/);});
test('audit failure does not present an unqualified completed-paper message',()=>{const message=completionMessage({state:'done',total:1,completed:1,auditError:'AUDIT_SAVE_FAILED'});assert.match(message,/记录.*失败/);assert.doesNotMatch(message,/作答完成/);});

test('verified paginated end reports the last question without treating a partial start as a whole-paper completion',()=>{const message=completionMessage({state:'done',mode:'auto',executionScope:'paginated',completed:2,total:2,draftSaved:true,pageFlow:{current:29,total:29,reachedEnd:true}});assert.match(message,/最后一题|第 29/);assert.doesNotMatch(message,/作答完成/);assert.match(message,/手动提交/);});
test('saved single paged question never also warns that saving was unverified',()=>{const message=completionMessage({state:'done',executionScope:'current-question',completed:1,total:1,draftSaved:true,canSave:true});assert.match(message,/草稿已保存/);assert.doesNotMatch(message,/暂存.*未验证/);});
test('partial, skipped and single runs do not claim full completion',()=>{assert.match(completionMessage({state:'done',mode:'single',completed:1,total:3,skipped:0}),/单题/);assert.match(completionMessage({state:'done',completed:1,total:3,skipped:2}),/跳过 2/);assert.match(completionMessage({state:'done',completed:1,total:3,skipped:0}),/未确认全部题目/);});
test('confirmed native draft save is visible while completion still requires manual submission',()=>{
 const message=completionMessage({state:'done',mode:'batch',completed:19,total:20,skipped:1,draftSaved:true});assert.match(message,/草稿已保存/);assert.match(message,/跳过 1/);assert.match(message,/手动提交/);
 assert.equal(completionMessage({state:'failed',stage:'save',draftSaved:false}),null);
});
