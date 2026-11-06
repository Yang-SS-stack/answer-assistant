import {courseKey,courseForUrl,normalizeCourse} from '../storage/context.js';
import {createReviewRecord,snapshotQuestion,hasReviewDecision,isFailedReviewRequest} from './records.js';
import {reviewRepository} from './repository.js';
import {expectedValue,sameAnswer,validateAnswer} from '../core/answers.js';

function sameStored(a,b){if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameStored(v,b[i]));const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&sameStored(a[k],b[k]));}

// Records are separate from settings: neither credentials nor signed source URLs belong here.
export function reviewStore(getSettings,{active=new Map(),papers=new Map(),onApplied}={}){
 const repo=reviewRepository(chrome.storage.local,{protectedPaper:paper=>papers.has(paper)});
 async function tabPaper(tabId){if(!Number.isInteger(tabId))throw Error('TAB_REQUIRED');const tab=await chrome.tabs.get(tabId),paperKey=courseKey(tab.url);if(!paperKey)throw Error('REVIEW_PAGE：请返回原作业页面');return{tab,paperKey};}
 function cancel(tabId){const entry=active.get(tabId);if(entry)entry.stopped=true;}
 async function save(record,sender,images,{strict=false,guard=()=>{}}={}){
  guard();
  const paperKey=courseKey(sender.url);if(!paperKey)throw Error('REVIEW_PAGE');
  if(papers.has(paperKey))throw Error('REVIEW_BUSY：正在确认填写，请稍后重新运行生成候选');
  const course=courseForUrl(await getSettings(),sender.url);
  if(JSON.stringify(course)!==JSON.stringify(normalizeCourse(record.course)))throw Error('COURSE_CHANGED：课程背景已变化，未保存旧候选');
  const entry=createReviewRecord(record,{paperKey,tabId:sender.tab.id,images});
  const retryRequired=isFailedReviewRequest(entry);
  if(retryRequired)Object.assign(entry,{id:'retry:'+JSON.stringify([entry.question.id,crypto.randomUUID()]),questionId:entry.question.id,status:'retry_required',retryRequired:true});
  if(strict&&entry.imagesUnavailable)throw Error('REVIEW_IMAGES：复审图片未完整保留，未翻页');
  entry.revision=crypto.randomUUID();
  const check=()=>{guard();if(papers.has(paperKey))throw Error('REVIEW_BUSY');};
  async function persist(){check();const saved=await (retryRequired?repo.put(paperKey,entry,{guard:check}):repo.putPending(paperKey,entry,{guard:check}));entry.id=saved.id;return saved;}
  let saved;try{saved=await persist();}catch(error){if(strict||!/quota|QUOTA|exceed|REVIEW_QUEUE_FULL/i.test(error.message)||!entry.images.length)throw error;entry.images=[];entry.imagesUnavailable=true;saved=await persist();}
  if(strict){check();const readback=await repo.detail(paperKey,entry.id);check();if(!sameStored(saved,readback))throw Error('REVIEW_READBACK：复审记录未通过完整读回，未翻页');return{saved:true,verified:true,id:entry.id,revision:entry.revision};}
  return{saved:true,id:entry.id};
 }
 async function matchPending(raw,sender){
  const paperKey=courseKey(sender.url);if(!paperKey)throw Error('REVIEW_PAGE');if(papers.has(paperKey))throw Error('REVIEW_BUSY');
  const course=courseForUrl(await getSettings(),sender.url);if(!sameStored(normalizeCourse(raw.course),course))return null;
  await repo.retireRequestFailures(paperKey);
  const q=snapshotQuestion(raw.question),r=await repo.pendingFor(paperKey,q.id);
  if(papers.has(paperKey))throw Error('REVIEW_BUSY');
  if(!r||r.status!=='pending'||r.legacy||r.detailsExpired||!r.revision||!r.first||!['uncertain','revise'].includes(r.review?.status)||r.imagesUnavailable||!sameStored(r.question,q)||!sameStored(normalizeCourse(r.course),course)||!sameAnswer(r.oldAnswer,raw.oldAnswer,q.type))return null;
  let checked;try{checked=createReviewRecord(r,{paperKey,tabId:sender.tab.id,images:r.images});}catch{return null;}
  if(!hasReviewDecision(checked)||checked.imagesUnavailable||checked.images.length!==q.images.length)return null;
  const remaining=[...checked.images];for(const image of q.images){const i=remaining.findIndex(saved=>saved.position===image.position);if(i<0)return null;remaining.splice(i,1);}
  return{saved:true,verified:true,id:r.id,revision:r.revision,first:r.first,second:r.second,review:r.review};
 }
 async function context(m){let current;try{current=await tabPaper(m.tabId);}catch{}const paper=m.paperKey||current?.paperKey;if(!paper||courseKey(paper)!==paper)throw Error('REVIEW_PAGE');return{paperKey:paper,stale:current?.paperKey!==paper,applying:papers.has(paper),applyingTabId:papers.get(paper)?.tabId??null};}
 async function importCheckpoint(m,paper){
  const checkpoint=(await chrome.storage.local.get('aaV4checkpoint:'+m.tabId))['aaV4checkpoint:'+m.tabId];if(checkpoint?.url!==paper)return;
  const known=await repo.knownIds(paper);
  for(const old of checkpoint.results||[]){if(known.has(old.id)||isFailedReviewRequest(old)||!(old.result==='review_pending'||old.result==null&&old.stage==='review'&&old.draft!=null))continue;
   const field={single:'optionIds',multiple:'optionIds',judge:'booleanValue',fill:'blanks',subjective:'text'}[old.type];
   const first=old.draft!=null&&field?{status:'answered',answer:{questionId:old.id,type:old.type,[field]:old.draft},summary:'',observations:[],limitations:['旧版仅保留草稿，完整模型输出未保留']}:null;
   await repo.put(paper,{id:old.id,paperKey:paper,tabId:m.tabId,question:null,first,second:null,type:old.type,review:old.review||{reason:old.reason||'历史记录未完整保留',issues:[]},status:'pending',legacy:true,images:[],imagesUnavailable:true});
  }
 }
 async function list(m){const ctx=await context(m);await repo.recover(ctx.paperKey);await importCheckpoint(m,ctx.paperKey);await repo.retireRequestFailures(ctx.paperKey);return{...ctx,...await repo.list(ctx.paperKey,m)};}
 async function apply(m){
  if(active.has(m.tabId))throw Error('REVIEW_BUSY：上一题仍在处理');
  const operation={stopped:false,tabId:m.tabId};active.set(m.tabId,operation);
  let paper,marked=false,stage='validate';
  const guard=()=>{if(operation.stopped)throw Error('STOPPED：已停止复审填写');};
  try{
   const current=await tabPaper(m.tabId);guard();paper=current.paperKey;
   if(paper!==m.paperKey)throw Error('REVIEW_PAGE_CHANGED：当前试卷与复审记录不一致');
   if(papers.has(paper))throw Error('REVIEW_BUSY：这份试卷已有确认操作，请等待结束');papers.set(paper,operation);
   let record;await repo.change(paper,m.recordId,r=>{
    guard();record=r;if(!record)throw Error('REVIEW_MISSING：复审记录不存在');
    if(record.status==='applied'||record.detailsExpired)throw Error('REVIEW_APPLIED：此题已经确认填写');
    if(record.status==='retry_required'||isFailedReviewRequest(record))throw Error('REVIEW_RETRY_REQUIRED：模型请求未完成，请重新开始答题；当前记录不作为人工复审');
    if(!record.question||record.legacy)throw Error('REVIEW_LEGACY：旧版记录仅供查看，请重新作答');
    if(!m.revision||record.revision!==m.revision)throw Error('REVIEW_RECORD_CHANGED：候选记录已更新，请刷新工作台并重新选择');
    validateAnswer(m.answer,record.question);return{...record,status:'applying',lastError:null,updatedAt:Date.now()};
   });marked=true;guard();
   const latest=await tabPaper(m.tabId);guard();if(latest.paperKey!==paper)throw Error('REVIEW_PAGE_CHANGED');
   const course=courseForUrl(await getSettings(),latest.tab.url);guard();
   if(JSON.stringify(course)!==JSON.stringify(normalizeCourse(record.course)))throw Error('COURSE_CHANGED：课程背景已变化，请重新作答');
   stage='page';const result=await chrome.tabs.sendMessage(m.tabId,{action:'apply_review',record,answer:m.answer},{frameId:0});guard();
   if(result?.error){if(['validate','fill','verify','save'].includes(result.phase))stage=result.phase;throw Error(result.error);}if(result?.verified!==true)throw Error('REVIEW_VERIFY：未收到页面验证结果');
   if(result.canSave===true&&result.draftSaved!==true)throw Error('REVIEW_SAVE_FAILED：填写验证通过，但暂存失败，请检查页面后重试');
   stage='persistence';if(result.persistenceTarget==='extension-local'){if(typeof onApplied!=='function')throw Error('LOCAL_DRAFT_UNAVAILABLE');await onApplied({record,answer:m.answer,result,tabId:m.tabId,paperKey:paper,guard,operation});guard();if(result.localDraftSaved!==true)throw Error('LOCAL_DRAFT_SAVE_FAILED');}
   stage='context';const finalPage=await tabPaper(m.tabId);guard();if(finalPage.paperKey!==paper)throw Error('REVIEW_PAGE_CHANGED：归档前作业已变化');const finalCourse=courseForUrl(await getSettings(),finalPage.tab.url);guard();if(JSON.stringify(finalCourse)!==JSON.stringify(normalizeCourse(record.course)))throw Error('COURSE_CHANGED：归档前课程背景已变化');
   stage='record';
   await repo.change(paper,record.id,r=>{guard();if(r?.revision!==record.revision)throw Error('REVIEW_RECORD_CHANGED');return{...r,status:'applied',appliedAnswer:m.answer,application:result,lastError:null,updatedAt:Date.now()};});guard();
   return result;
  }catch(error){
   const failure={stage,reason:String(error.message||error).slice(0,1000),at:Date.now()};
   if(marked)await repo.change(paper,m.recordId,r=>r?.revision===m.revision?{...r,status:'pending',lastError:error.message,firstFailure:r.firstFailure||failure,lastFailure:failure,updatedAt:failure.at}:r);
   throw error;
  }finally{if(active.get(m.tabId)===operation)active.delete(m.tabId);if(papers.get(paper)===operation)papers.delete(paper);}
 }
 async function captureRun(state,sender){
  if(state.state!=='done')return{captured:0};
  const paperKey=courseKey(sender.url);if(!paperKey)throw Error('REVIEW_PAGE');
  const currentCourse=courseForUrl(await getSettings(),sender.url);let captured=0;
  const taskId=state.taskId;if(taskId!==undefined&&(typeof taskId!=='string'||!taskId||taskId.length>256))throw Error('REVIEW_TASK_INVALID');
  for(const result of state.results){
   if(result.result!=='completed'||result.userConfirmed||!result.question||!result.first||!Object.hasOwn(result,'second'))continue;
   if(result.id!==result.question.id||result.first.status!=='answered')continue;
   const course=result.course?normalizeCourse(result.course):currentCourse;
   if(JSON.stringify(course)!==JSON.stringify(currentCourse))throw Error('COURSE_CHANGED：运行时课程与当前绑定不同，未关联自动审计');
   const entry=createReviewRecord({...result,course},{paperKey,tabId:sender.tab.id});
   if(taskId){entry.questionId=entry.question.id;entry.taskId=taskId;entry.id='auto:'+JSON.stringify([entry.question.id,taskId]);}
   const answer=validateAnswer(result.first.answer,entry.question);
   if(result.second&&(result.second.status!=='answered'||!sameAnswer(expectedValue(answer),expectedValue(result.second.answer),entry.question.type)))continue;
   if(state.canSave===true&&state.draftSaved!==true&&result.localDraftSaved!==true&&state.localDraftSaved!==true)continue;
   Object.assign(entry,{revision:crypto.randomUUID(),status:'applied',appliedAnswer:answer,automatic:true,decision:result.second?'agreement':'single',application:{verified:true,...(result.localDraftSaved===true||state.localDraftSaved===true?{localDraftSaved:true}:{}),draftSaved:state.draftSaved===true,...(typeof state.canSave==='boolean'?{canSave:state.canSave}:{})}});
   await repo.change(paperKey,entry.id,current=>{if(current||papers.has(paperKey))return null;captured++;return entry;});
  }
  return{captured};
 }
 async function handle(m){
  if(m.action==='REVIEW_LIST')return list(m);
  if(m.action==='REVIEW_EXPORT'){const ctx=await context(m);return{...ctx,...await repo.exportSummaries(ctx.paperKey)};}
  if(m.action==='REVIEW_STATS'){const ctx=await context(m);await repo.recover(ctx.paperKey);await repo.retireRequestFailures(ctx.paperKey);return{...ctx,...await repo.stats(ctx.paperKey)};}
  if(m.action==='REVIEW_DETAIL'){const ctx=await context(m);await repo.recover(ctx.paperKey);await repo.retireRequestFailures(ctx.paperKey);return{...ctx,record:await repo.detail(ctx.paperKey,m.recordId)};}
  if(m.action==='REVIEW_CLEANUP'){const ctx=await context(m);return{...ctx,...await repo.cleanup(ctx.paperKey,{manual:true})};}
  if(m.action==='REVIEW_OPEN'){const {paperKey}=await tabPaper(m.tabId);await chrome.tabs.create({url:chrome.runtime.getURL('src/ui/review.html')+'?'+new URLSearchParams({tabId:String(m.tabId),paperKey,...(m.status==='applied'?{status:'applied'}:{}),...(m.recordId?{recordId:m.recordId}:{})})});return{opened:true};}
  if(m.action==='REVIEW_APPLY')return apply(m);
  if(m.action==='REVIEW_STOP'){const target=papers.get(m.paperKey)?.tabId??m.tabId;cancel(target);await chrome.tabs.sendMessage(target,{action:'stop_review'},{frameId:0});return{stopped:true};}
  throw Error('REVIEW_ACTION_INVALID');
 }
 return{save,matchPending,handle,cancel,captureRun};
}
