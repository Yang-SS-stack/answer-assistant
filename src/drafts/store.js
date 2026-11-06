import {courseKey,courseForUrl,normalizeCourse} from '../storage/context.js';
import {createReviewRecord} from '../review/records.js';
import {reviewRepository} from '../review/repository.js';
import {validateDraftAnswer,draftAnswerState} from './native-answer.js';
import {expectedValue,sameAnswer} from '../core/answers.js';

// chrome.storage may reorder object properties; record identity, key sets, values
// and array positions still have to match exactly after the write/read boundary.
function sameStoredValue(a,b){
 if(a===b)return true;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>sameStoredValue(value,b[i]));
 const keys=Object.keys(a);
 return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameStoredValue(a[key],b[key]));
}

// This namespace contains only sanitized snapshots, never model credentials or image bytes.
export function draftStore(getSettings,{active=new Map(),papers=new Map()}={}){
 const repo=reviewRepository(chrome.storage.local,{namespace:'aaV4localDraft',autoExpiry:false,maxPending:1000,protectedPaper:p=>papers.has(p)});
 async function tabPaper(tabId){if(!Number.isInteger(tabId))throw Error('TAB_REQUIRED');const tab=await chrome.tabs.get(tabId),paperKey=courseKey(tab.url);if(!paperKey)throw Error('LOCAL_DRAFT_PAGE');return{tab,paperKey};}
 const assertCourse=(course,current)=>{if(JSON.stringify(normalizeCourse(course))!==JSON.stringify(current))throw Error('COURSE_CHANGED：课程背景已变化');};
 async function context(m){let current;try{current=await tabPaper(m.tabId);}catch{}const paperKey=m.paperKey||current?.paperKey;if(!paperKey||courseKey(paperKey)!==paperKey)throw Error('LOCAL_DRAFT_PAGE');return{paperKey,stale:current?.paperKey!==paperKey,applying:papers.has(paperKey),applyingTabId:papers.get(paperKey)?.tabId??null};}
 async function save(m,sender,{guard=()=>{},operation}={}){
  const paperKey=courseKey(sender.url);if(!paperKey)throw Error('LOCAL_DRAFT_PAGE');
  const check=()=>{guard();if(operation){if(operation.stopped||papers.get(paperKey)!==operation||active.get(sender.tab.id)!==operation||operation.tabId!==sender.tab.id)throw Error('LOCAL_DRAFT_OWNER_INVALID');}else if(papers.has(paperKey)||active.has(sender.tab.id))throw Error('LOCAL_DRAFT_BUSY：正在确认填写');};
  check();const current=courseForUrl(await getSettings(),sender.url);check();assertCourse(m.course,current);
  const raw=m.record;if(!raw||!['generated','existing','skipped','manual'].includes(raw.origin))throw Error('LOCAL_DRAFT_ORIGIN');
  const entry=createReviewRecord({...raw,course:current},{paperKey,tabId:sender.tab.id});
  const answer=raw.answer==null?null:validateDraftAnswer(raw,entry.question);
  if(answer===null&&raw.origin!=='skipped'||raw.origin==='skipped'&&answer!==null)throw Error('LOCAL_DRAFT_ANSWER');
  Object.assign(entry,{questionId:entry.question.id,taskId:m.taskId,answer,answerState:draftAnswerState(answer),origin:raw.origin,revision:crypto.randomUUID(),localDraftSaved:true,platformSaved:false,draftSaved:false});
  await repo.put(paperKey,entry,{guard:check});check();
  const persisted=await repo.detail(paperKey,entry.id);check();
  if(persisted?.revision!==entry.revision||!sameStoredValue(persisted,entry))throw Error('LOCAL_DRAFT_READBACK：本机草稿读回失败');
  return{saved:true,id:entry.id,revision:entry.revision};
 }
 // Internal review hook: the operation object is a capability held only by this background.
 async function saveReviewed({record,answer,tabId,paperKey,guard,operation}){
  const check=()=>{guard();if(!operation||operation.stopped||operation.tabId!==tabId||active.get(tabId)!==operation||papers.get(paperKey)!==operation)throw Error('LOCAL_DRAFT_OWNER_INVALID');};
  check();const current=await tabPaper(tabId);check();if(current.paperKey!==paperKey)throw Error('LOCAL_DRAFT_PAGE_CHANGED');
  const result=await save({taskId:record.taskId||'manual-review:'+record.revision,course:record.course,record:{...record,answer,origin:'manual'}},{url:current.tab.url,tab:{id:tabId}},{guard:check,operation});check();
  const latest=await tabPaper(tabId);check();if(latest.paperKey!==paperKey)throw Error('LOCAL_DRAFT_PAGE_CHANGED');
  const course=courseForUrl(await getSettings(),latest.tab.url);check();assertCourse(record.course,course);
  return result;
 }
 async function verify(m,sender,{guard=()=>{}}={}){
  guard();const paperKey=courseKey(sender.url);if(!paperKey)throw Error('LOCAL_DRAFT_PAGE');
  const current=courseForUrl(await getSettings(),sender.url);guard();assertCourse(m.course,current);
  const r=await repo.detail(paperKey,m.questionId);guard();
  if(!r||r.paperKey!==paperKey||r.taskId!==m.taskId||r.tabId!==sender.tab.id||r.question.id!==m.questionId||!m.revision||r.revision!==m.revision)throw Error('LOCAL_DRAFT_RECORD_CHANGED');
  assertCourse(r.course,current);
  const value=r.answer===null?null:expectedValue(validateDraftAnswer(r,r.question));
  if(!Object.hasOwn(m,'expected')||!sameAnswer(value,m.expected,r.question.type))throw Error('LOCAL_DRAFT_VERIFY：本机草稿与当前答案不同');
  return{verified:true,target:'extension-local'};
 }
 function cancel(tabId){const op=active.get(tabId);if(op)op.stopped=true;}
 async function restore(m){
  if(active.has(m.tabId))throw Error('LOCAL_DRAFT_BUSY');
  const op={tabId:m.tabId,stopped:false};active.set(m.tabId,op);let paper;
  const guard=()=>{if(op.stopped)throw Error('STOPPED：已停止草稿恢复');};
  try{
   const current=await tabPaper(m.tabId);guard();paper=current.paperKey;
   if(paper!==m.paperKey)throw Error('LOCAL_DRAFT_PAGE_CHANGED');
   if(papers.has(paper))throw Error('LOCAL_DRAFT_BUSY');papers.set(paper,op);
   const r=await repo.detail(paper,m.recordId);guard();
   if(!r||!m.revision||r.revision!==m.revision||r.paperKey!==paper)throw Error('LOCAL_DRAFT_RECORD_CHANGED');
   if(!r.answer||r.origin==='skipped'||r.detailsExpired)throw Error('LOCAL_DRAFT_EMPTY：没有可恢复答案');
   validateDraftAnswer(r,r.question);
   const latest=await tabPaper(m.tabId);guard();if(latest.paperKey!==paper)throw Error('LOCAL_DRAFT_PAGE_CHANGED');
   assertCourse(r.course,courseForUrl(await getSettings(),latest.tab.url));guard();
   const result=await chrome.tabs.sendMessage(m.tabId,{action:'restore_local_draft',record:r},{frameId:0});guard();
   if(result?.error)throw Error(result.error);if(result?.verified!==true)throw Error('LOCAL_DRAFT_RESTORE_VERIFY：未收到页面验证结果');
   const after=await tabPaper(m.tabId);guard();if(after.paperKey!==paper)throw Error('LOCAL_DRAFT_PAGE_CHANGED');
   assertCourse(r.course,courseForUrl(await getSettings(),after.tab.url));guard();
   return{...result,localDraftSaved:true};
  }finally{if(active.get(m.tabId)===op)active.delete(m.tabId);if(papers.get(paper)===op)papers.delete(paper);}
 }
 async function handle(m){
  if(m.action==='LOCAL_DRAFT_OPEN'){const {paperKey}=await tabPaper(m.tabId);await chrome.tabs.create({url:chrome.runtime.getURL('src/ui/review.html')+'?'+new URLSearchParams({view:'local-drafts',tabId:String(m.tabId),paperKey})});return{opened:true};}
  if(m.action==='LOCAL_DRAFT_RESTORE')return restore(m);
  if(m.action==='LOCAL_DRAFT_STOP'){const tabId=papers.get(m.paperKey)?.tabId??m.tabId;cancel(tabId);await chrome.tabs.sendMessage(tabId,{action:'stop_review'},{frameId:0});return{stopped:true};}
  const ctx=await context(m);
  if(m.action==='LOCAL_DRAFT_LIST')return{...ctx,...await repo.list(ctx.paperKey,{page:m.page})};
  if(m.action==='LOCAL_DRAFT_STATS')return{...ctx,...await repo.stats(ctx.paperKey)};
  if(m.action==='LOCAL_DRAFT_DETAIL')return{...ctx,record:await repo.detail(ctx.paperKey,m.recordId)};
  throw Error('LOCAL_DRAFT_ACTION_INVALID');
 }
 return{save,saveReviewed,verify,handle,cancel};
}
