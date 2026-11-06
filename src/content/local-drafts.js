import {expectedValue,sameAnswer} from '../core/answers.js';
import {validateDraftAnswer,draftAnswerState} from '../drafts/native-answer.js';
import {snapshotQuestion} from '../review/records.js';

export const emptyNative=value=>value==null||value===''||Array.isArray(value)&&value.every(v=>v==='');
function structured(q,value,origin){const field={single:'optionIds',multiple:'optionIds',judge:'booleanValue',fill:'blanks',subjective:'text'}[q.type];return validateDraftAnswer({origin,answer:{questionId:q.id,type:q.type,[field]:value}},q);}
// Inject storage into the existing pagination protocol; platform code never gets
// credentials or chrome.storage access, and local success is never a server save.
export function withLocalDraftPersistence(adapter,{send,course,task,acceptToken,resultFor}={}){
 const nav=adapter.pagination;if(nav?.kind!=='single-paged'||nav.localDraftSupported!==true)return adapter;
 const acknowledgements=new Map();
 const current=(q,value,signal)=>{signal.throwIfAborted();if(!adapter.checkWritable(q)||!sameAnswer(adapter.readCurrentAnswer(q),value,q.type))throw Error('QUESTION_CHANGED：本机保存前后题目或答案已变化');};
 const target={...nav,persistence:'verified',persistenceTarget:'extension-local',
  async saveCurrent(q,value,signal){
   current(q,value,signal);const started=task();if(!started?.id)throw Error('TASK_NOT_FOUND');
   const result=resultFor(q);if(!result||result.id!==q.id||!['completed','skipped','review_pending'].includes(result.result)||result.result==='review_pending'&&result.reviewSaved!==true)throw Error('LOCAL_DRAFT_RESULT：缺少已验证的本题结果');
   const origin=result.userConfirmed?'manual':result.result==='completed'?'generated':emptyNative(value)?'skipped':'existing';
   const record={question:snapshotQuestion(q),answer:origin==='skipped'?null:structured(q,value,origin),oldAnswer:structuredClone(result.oldAnswer??null),first:result.first??null,second:result.second??null,review:result.review??null,origin};
   const reply=await send({action:'LOCAL_DRAFT_SAVE',taskId:started.id,...(started.token?{taskToken:started.token}:{beginTask:true}),course:course(),record});
   current(q,value,signal);const now=task();if(now?.id!==started.id||now?.token!==started.token)throw Error('TASK_CHANGED：本机保存期间任务已变化');
   if(reply?.saved!==true||reply.id!==q.id||typeof reply.revision!=='string'||!reply.revision||typeof reply.taskToken!=='string'||!reply.taskToken||started.token&&reply.taskToken!==started.token)throw Error('LOCAL_DRAFT_SAVE_FAILED：本机保存未确认');
   acceptToken(reply.taskToken);acknowledgements.set(q.id,{id:started.id,revision:reply.revision,expected:record.answer?expectedValue(record.answer):null});return true;
  },
  async verifyPersisted(q,value,signal){
   current(q,value,signal);const binding=task(),ack=acknowledgements.get(q.id);if(!ack||binding.id!==ack.id||!binding.token)throw Error('LOCAL_DRAFT_RECORD_CHANGED');
   const expected=emptyNative(value)?null:value;if(!sameAnswer(ack.expected,expected,q.type))throw Error('LOCAL_DRAFT_VERIFY：待验证的答案已变化');
   const reply=await send({action:'LOCAL_DRAFT_VERIFY',taskId:binding.id,taskToken:binding.token,course:course(),questionId:q.id,revision:ack.revision,expected});
   current(q,value,signal);if(task()?.id!==binding.id||task()?.token!==binding.token)throw Error('TASK_CHANGED');
   if(reply?.verified!==true||reply.target!=='extension-local')throw Error('LOCAL_DRAFT_READBACK：本机草稿未通过读回验证');return true;
  }
 };
 return{...adapter,pagination:target,detectPage(){const page=adapter.detectPage();return{...page,pageFlow:{...page.pageFlow,persistence:'verified',persistenceTarget:'extension-local',platformPersistence:'unverified',localDraftSupported:true,automaticNext:page.supported===true&&nav.navigation==='verified'&&typeof nav.advance==='function'&&typeof nav.verifyTransition==='function'},limitation:'每题先保存到当前 Edge 扩展，再安全进入下一题；平台保存未确认，始终不提交。'};}};
}

// Restoration is a separate explicit user action, never an automatic replay.
export function prepareDraftRestore(record,adapter){
 if(!record?.question||!record.answer||record.origin==='skipped')throw Error('LOCAL_DRAFT_EMPTY：没有可恢复答案');
 const original=snapshotQuestion(record.question),answer=validateDraftAnswer(record,original);
 const matches=adapter.findQuestions().map(e=>adapter.extractQuestion(e)).filter(q=>q.id===original.id);
 if(matches.length!==1||JSON.stringify(snapshotQuestion(matches[0]))!==JSON.stringify(original)||!adapter.checkWritable(matches[0]))throw Error('QUESTION_CHANGED：请先回到该草稿对应的当前题');
 const old=adapter.readCurrentAnswer(matches[0]);if(!emptyNative(old)&&!sameAnswer(old,expectedValue(answer),original.type))throw Error('ANSWER_CHANGED：当前题已有不同答案，未覆盖');
 return{...record,status:'pending',answer,answerState:draftAnswerState(answer),oldAnswer:structuredClone(old??null)};
}
