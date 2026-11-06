import {createRenderedInput} from './rendered-input.js';
import {snapshotQuestion} from '../review/records.js';
import {sameAnswer} from '../core/answers.js';
import {prepareRenderedGeometry} from '../images/rendered-geometry.js';
import {applicationSnapshot} from './application-state.js';
import {selectPlatform,pinPlatform} from '../platforms/registry.js';
import {Runner} from '../core/runner.js';
import {completionMessage} from '../core/completion.js';
import {showCompletionNotice} from '../ui/completion-notice.js';
import {requireCourse,courseKey,normalizeCourse} from '../storage/context.js';
import {publishStatus} from '../diagnostics/public-status.js';
import {collectQuestionImages} from '../images/reader.js';
import {applyReviewedAnswer} from '../review/apply.js';
import {withLocalDraftPersistence,prepareDraftRestore} from './local-drafts.js';
const runner=new Runner();let taskId=null,taskToken=null;let previous=null;let writeQueue=Promise.resolve();let starting=false,startEpoch=0;let taskCourse={name:'',language:'',requirements:''};
let applying=false,applyController=null,applicationState=null,auditError=null;
const reviewImages=new Map();
const manualResults=new Map();
function snapshot(){
 const state=runner.snapshot();if(auditError)state.auditError=auditError;if(!applicationState)return state;
 return applicationSnapshot(state,applicationState,manualResults);
}
async function send(message){const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'EXTENSION_CONNECTION');return r.data;}
function decorateAdapter(candidate){return withLocalDraftPersistence(candidate,{send,course:()=>taskCourse,task:()=>({id:taskId,token:taskToken}),acceptToken:value=>taskToken=value,resultFor:q=>runner.snapshot().results.findLast(r=>r.id===q.id)});}
const renderedInput=createRenderedInput({send,task:()=>({id:taskId,token:taskToken}),course:()=>taskCourse,acceptToken:value=>taskToken=value,isCurrent:q=>adapter.checkWritable(q),readAnswer:q=>adapter.readCurrentAnswer(q),prepareGeometry:prepareRenderedGeometry});
let {adapter,errors:registrationErrors}=selectPlatform(document,location);adapter=decorateAdapter(adapter);
function refreshPlatform(){if(!runner.busy&&!starting&&!applying){const selected=selectPlatform(document,location);adapter=decorateAdapter(selected.adapter);registrationErrors=selected.errors;}}
function pageInfo(refresh=true){if(refresh)refreshPlatform();return{...adapter.detectPage(),registrationErrors};}
const extensionVersion=chrome.runtime.getManifest().version;publishStatus(document,runner.snapshot(),extensionVersion);
function diagnose(){
 const page=pageInfo();if(!page.supported)return{...page,questions:[],count:0,timer:'未识别'};
 const questions=adapter.findQuestions().map(element=>{try{const q=adapter.extractQuestion(element);return{id:q.id,type:q.type,stemPreview:q.stem.slice(0,100),options:q.options.length,blanks:q.blankCount,images:q.images.map(im=>({loaded:im.loaded,position:im.position})),answered:adapter.readCurrentAnswer(q),result:'identified',stage:'extract'};}catch(e){return{id:'unknown',result:'failed',stage:'extract',reason:e.message};}});
 return{...page,count:questions.length,questions,timer:adapter.timer()};
}
async function request(q,signal,meta){
 signal.throwIfAborted();if(!adapter.checkWritable(q))throw Error('QUESTION_CHANGED：请求前题目或试卷已变化');
 const id=crypto.randomUUID();const cancel=()=>{void send({action:'CANCEL_TASK',taskId}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{const images=q.visualInput?.kind==='rendered-question'?renderedInput.images(q,signal):await collectQuestionImages(q,{signal,isCurrent:()=>adapter.checkWritable(q)});signal.throwIfAborted();reviewImages.set(q.id,images);const result=await send({action:'MODEL_REQUEST',includeSource:true,beginTask:taskToken===null,...(taskToken?{taskToken}:{}),taskId,requestId:id,course:taskCourse,purpose:meta?.purpose||'answer',...(meta?.purpose==='review'?{candidate:meta.candidate}:{}),question:{id:q.id,type:q.type,stem:q.stem,options:q.options,blankCount:q.blankCount,...(q.visualInput?.kind==='rendered-question'?{inputKind:'rendered-question'}:{}),images}});signal.throwIfAborted();if(!adapter.checkWritable(q))throw Error('QUESTION_CHANGED：请求期间题目或试卷已变化');if(typeof result?.taskToken!=='string'||!result.taskToken)throw Error('TASK_NOT_FOUND：任务校验信息缺失，请刷新页面后重新开始');taskToken=result.taskToken;const {taskToken:ignored,...payload}=result;return payload;}finally{signal.removeEventListener('abort',cancel);}
}
function persist(state){
 const last=state.results.at(-1);if(last){reviewImages.delete(last.id);renderedInput.release(last.id);}const entry={...state,...(auditError?{auditError}:{}),page:pageInfo(false),timer:adapter.timer(),taskId};publishStatus(document,entry,extensionVersion);
 writeQueue=writeQueue.catch(()=>{}).then(()=>send({action:'STATUS_UPDATE',state:entry})).catch(error=>{auditError='AUDIT_SAVE_FAILED：本地运行记录保存失败：'+String(error.message||error).slice(0,300);const current=snapshot();publishStatus(document,current,extensionVersion);const notice=completionMessage(current);if(notice)showCompletionNotice(document,notice);});
 const message=completionMessage(entry);if(message)showCompletionNotice(document,message);
}

async function start(){
 if(runner.busy||starting||applying)throw Error('TASK_RUNNING：上一任务仍在运行或结束');const page=pageInfo();if(!page.supported)throw Error(page.reason);
 adapter=pinPlatform(adapter,()=>location.href);starting=true;const epoch=++startEpoch;
 try{const settings=await send({action:'PUBLIC_SETTINGS'});if(epoch!==startEpoch)throw Error('STOPPED');if(!settings.configured)throw Error('API_KEY_REQUIRED：请先在设置中填写密钥');if(settings.reviewMode==='enhanced'&&!settings.reviewer?.configured)throw Error('REVIEW_KEY_REQUIRED：请先配置 Qwen 加强复核密钥');
 if(!adapter.detectPage().supported)throw Error(adapter.detectPage().reason);
 const modelContext=s=>JSON.stringify({provider:s.provider,model:s.model,configured:s.configured,capabilities:s.capabilities,reviewer:s.reviewMode==='enhanced'?s.reviewer:null});
 const checkContext=async(signal,requireTask)=>{signal.throwIfAborted();const current=await send({action:'PUBLIC_SETTINGS'});signal.throwIfAborted();if(JSON.stringify(current.course)!==JSON.stringify(settings.course)||current.reviewMode!==settings.reviewMode)throw Error('COURSE_CHANGED：课程背景或复核模式已变化，请重新开始任务');if(modelContext(current)!==modelContext(settings))throw Error('MODEL_CONFIG_CHANGED：任务期间模型配置已变化，请重新开始');if(requireTask||taskToken!==null){await send({action:'TASK_VALIDATE',taskId,taskToken});signal.throwIfAborted();}};
 taskCourse=requireCourse(settings.course);auditError=null;reviewImages.clear();renderedInput.clear();manualResults.clear();applicationState=null;showCompletionNotice(document,null);taskId=crypto.randomUUID();taskToken=null;void runner.run({adapter,request,settings,prepareInput:(q,signal)=>renderedInput.prepare(q,signal),onUpdate:persist,findReview:async(q,old,signal)=>{signal.throwIfAborted();const saved=await send({action:'REVIEW_MATCH',record:{question:snapshotQuestion(q),oldAnswer:old,course:taskCourse}});signal.throwIfAborted();if(!adapter.checkWritable(q)||!sameAnswer(adapter.readCurrentAnswer(q),old,q.type))throw Error('QUESTION_CHANGED');return saved;},onReview:async(record,signal)=>{signal.throwIfAborted();const receipt=await send({action:'REVIEW_SAVE',strict:true,taskId,taskToken,record,images:reviewImages.get(record.question.id)||[]});signal.throwIfAborted();if(receipt?.verified!==true)throw Error('REVIEW_READBACK');reviewImages.delete(record.question.id);return receipt;},beforePageAction:signal=>checkContext(signal,false),beforeWrite:signal=>checkContext(signal,true)}).finally(()=>{reviewImages.clear();renderedInput.clear();});return{started:true};}finally{starting=false;}
}
async function applyReview(record,answer,localRestore=false){
 if(runner.busy||starting||applying)throw Error('TASK_RUNNING：请先停止当前任务，再确认填写');
 refreshPlatform();adapter=pinPlatform(adapter,()=>location.href);
 applying=true;const controller=new AbortController();applyController=controller;const signal=controller.signal;
 applicationState={state:'running',stage:'validate',questionId:record?.question?.id,startedAt:Date.now(),pageFlow:adapter.detectPage().pageFlow,...(adapter.pagination?.persistenceTarget==='extension-local'?{persistenceTarget:'extension-local'}:{})};
 try{
  const checkPaper=()=>{signal.throwIfAborted();if(courseKey(location.href)!==record?.paperKey)throw Error('REVIEW_PAGE_CHANGED：当前试卷与记录不一致');};checkPaper();
  let course;const checkCourse=async()=>{checkPaper();const current=await send({action:'PUBLIC_SETTINGS'});checkPaper();course=requireCourse(current.course);if(JSON.stringify(course)!==JSON.stringify(normalizeCourse(record.course)))throw Error('COURSE_CHANGED：课程背景已变化，请重新作答');};
  await checkCourse();signal.throwIfAborted();
  const result=await applyReviewedAnswer({record,answer,adapter,course:()=>{checkPaper();return course;},signal,localRestore,beforeWrite:checkCourse,beforeComplete:checkCourse,onPhase:stage=>{checkPaper();applicationState.stage=stage;persist(snapshot());}});
  checkPaper();if(adapter.pagination?.persistenceTarget==='extension-local'){result.persistenceTarget='extension-local';result.localDraftSaved=localRestore;}applicationState={...applicationState,state:'done',elapsedMs:Date.now()-applicationState.startedAt,...result};
  manualResults.set(record.question.id,{id:record.question.id,type:record.question.type,result:result.partialRestore?'restored':'completed',partialRestore:result.partialRestore===true,stage:'verify',reason:result.partialRestore?'原有部分答案已恢复并验证，仍有空位未完成':result.alreadyMatching?'确认值与当前答案一致，页面验证通过，未重复填写':'用户确认后填写，页面状态验证通过',userConfirmed:!result.partialRestore,localDraftSaved:result.localDraftSaved===true,modified:result.modified,oldAnswer:record.oldAnswer,newAnswer:result.newAnswer,first:record.first,second:record.second,review:record.review,images:record.question.images.length?'verified':'none',draftSaved:result.draftSaved});persist(snapshot());
  showCompletionNotice(document,result.partialRestore?'当前题的部分原生答案已恢复并验证；仍有空位未完成。平台保存未确认；未自动切题或提交。':result.persistenceTarget==='extension-local'?(localRestore?'已从本机草稿恢复并验证。平台保存未确认；未自动切题或提交。':'本题已填写并验证，本机草稿保存状态将另行确认。平台保存未确认；未提交。'):(result.draftSaved?'草稿已保存。':'')+'本题已按你确认的答案填写并验证，请继续检查其他题目；试卷未提交。');return result;
 }catch(error){applicationState={...applicationState,state:signal.aborted?'stopped':'failed',elapsedMs:Date.now()-applicationState.startedAt,error:error.message};persist(snapshot());throw error;}
 finally{applying=false;if(applyController===controller)applyController=null;}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(sender.id!==chrome.runtime.id)return;
 const action=async()=>{
  if(m.action==='capture_geometry')return await renderedInput.geometry(m);
  if(m.action==='diagnose')return diagnose();
  if(m.action==='status')return{...snapshot(),page:pageInfo(),timer:adapter.timer(),recoveryAvailable:previous?.state==='running'};
  if(m.action==='start')return await start();
  if(m.action==='apply_review')return await applyReview(m.record,m.answer);
  if(m.action==='restore_local_draft'){if(runner.busy||starting||applying)throw Error('TASK_RUNNING');refreshPlatform();const record=prepareDraftRestore(m.record,adapter);return await applyReview(record,record.answer,true);}
  if(m.action==='local_draft_saved'){if(applicationState?.state==='done'&&!applicationState.cancelled&&applicationState.persistenceTarget==='extension-local'&&applicationState.questionId===m.questionId){applicationState.localDraftSaved=true;const row=manualResults.get(m.questionId);if(row)row.localDraftSaved=true;persist(snapshot());showCompletionNotice(document,completionMessage(snapshot()));}return{acknowledged:true};}
  if(m.action==='stop_review'){if(applicationState)applicationState.cancelled=true;applyController?.abort(Error('STOPPED：已停止复审填写'));return{stopped:true};}
  if(m.action==='stop'){if(applicationState)applicationState.cancelled=true;startEpoch++;runner.stop();renderedInput.clear();applyController?.abort(Error('STOPPED：已停止复审填写'));if(taskId)await send({action:'CANCEL_TASK',taskId});return{stopped:true};}
  throw Error('COMMAND_INVALID');
 };action().then(data=>reply(data)).catch(e=>reply({error:e.message,...(m.action==='apply_review'&&applicationState?.questionId===m.record?.question?.id&&['failed','stopped'].includes(applicationState?.state)?{phase:applicationState.stage}:{})}));return true;
});
send({action:'CHECKPOINT_GET'}).then(value=>previous=value).catch(()=>{});
