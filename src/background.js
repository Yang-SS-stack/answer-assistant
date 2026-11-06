import {courseForUrl,courseKey,normalizeCourse,requireCourse} from './storage/context.js';
import {normalizeSettings,publicSettings} from './storage/settings.js';
import {callModel} from './providers/client.js';
import {selectRole,roleFingerprint} from './providers/roles.js';
import {reviewStore} from './review/store.js';
import {draftStore} from './drafts/store.js';
import {captureRenderedQuestion} from './images/capture-service.js';
const requests=new Map(),cancelled=new Map(),taskBindings=new Map();
chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
async function settings(){return normalizeSettings((await chrome.storage.local.get('aaV4settings')).aaV4settings);}
const operations={active:new Map(),papers:new Map()};
const drafts=draftStore(settings,operations);
const reviews=reviewStore(settings,{...operations,onApplied:async context=>{
 await drafts.saveReviewed(context);context.guard();context.result.localDraftSaved=true;
 await chrome.tabs.sendMessage(context.tabId,{action:'local_draft_saved',questionId:context.record.question.id},{frameId:0});context.guard();
}});
function ui(sender){return sender.id===chrome.runtime.id&&sender.url?.startsWith(chrome.runtime.getURL('src/ui/'));}
function page(sender){try {const u=new URL(sender.url);return sender.tab?.id!==undefined&&sender.frameId===0&&u.protocol==='https:'&&(['www.yuketang.cn','examination.xuetangx.com'].includes(u.hostname)||['mooc1.chaoxing.com','hike-teaching-center.polymas.com'].includes(u.hostname)&&!!courseKey(sender.url));}catch{return false;}}
function scope(sender,taskId){return sender.tab.id+':'+(sender.documentId||'')+':'+taskId;}
function taskFingerprint(s){return JSON.stringify({reviewMode:s.reviewMode,answer:roleFingerprint(s,'answer'),reviewer:s.reviewMode==='enhanced'?roleFingerprint(s,'independent'):null});}
function bindingError(binding,s,url=binding.url){
 if(binding.error)return binding.error;
 if(JSON.stringify(courseForUrl(s,url))!==JSON.stringify(binding.context))return Error('COURSE_CHANGED：任务期间课程背景已变化');
 if(courseKey(url)!==courseKey(binding.url))return Error('TASK_PAGE_CHANGED：任务期间作业已变化');
 if(taskFingerprint(s)!==binding.fingerprint)return Error('MODEL_CONFIG_CHANGED：任务期间模型配置已变化');
}
function invalidateTask(key,binding,error){binding.error=error;for(const r of requests.values())if(r.scope===key)r.controller.abort(error);}
function validateTask(key,s,url,token){
 if(cancelled.has(key))throw Error('STOPPED');
 const binding=taskBindings.get(key);if(!binding)throw Error('TASK_NOT_FOUND：任务配置已失效，请重新开始');
 if(typeof token!=='string'||token!==binding.token)throw Error('TASK_TOKEN_INVALID：任务凭据已失效，请重新开始');
 binding.lastSeen=Date.now();const error=bindingError(binding,s,url);if(error){invalidateTask(key,binding,error);throw error;}
 return binding;
}
async function validateCapturedTab(key,binding){
 const target=binding.captureTab;if(!target)return;
 const reject=code=>{const error=Error(code+'：整题截图任务的答题标签或窗口已变化，请重新开始');invalidateTask(key,binding,error);throw error;};
 let tab,active;try{tab=await chrome.tabs.get(target.id);active=await chrome.tabs.query({active:true,windowId:target.windowId});}catch{reject('CAPTURE_PAGE_CHANGED');}
 if(binding.error)throw binding.error;
 if(tab.id!==target.id||tab.windowId!==target.windowId||tab.url!==target.url)reject('CAPTURE_PAGE_CHANGED');
 if(tab.active!==true||active.length!==1||active[0].id!==target.id)reject('CAPTURE_ACTIVE_TAB_CHANGED');
}
function reclaimTasks(){
 const active=new Set([...requests.values()].map(r=>r.scope));
 for(const [key,time]of cancelled)if(Date.now()-time>300000&&!active.has(key))cancelled.delete(key);
 for(const [key,binding]of taskBindings)if(Date.now()-binding.lastSeen>300000&&!active.has(key))taskBindings.delete(key);
}
async function handle(m,sender){
 if(!m||typeof m.action!=='string')throw Error('MESSAGE_INVALID');
 if(ui(sender)){
  if(['LOCAL_DRAFT_LIST','LOCAL_DRAFT_STATS','LOCAL_DRAFT_DETAIL','LOCAL_DRAFT_OPEN','LOCAL_DRAFT_RESTORE','LOCAL_DRAFT_STOP'].includes(m.action))return drafts.handle(m);
  if(['REVIEW_LIST','REVIEW_OPEN','REVIEW_APPLY','REVIEW_STOP','REVIEW_STATS','REVIEW_DETAIL','REVIEW_CLEANUP','REVIEW_EXPORT'].includes(m.action))return reviews.handle(m);
  if(m.action==='SETTINGS_GET')return await settings();
  if(m.action==='SETTINGS_SAVE'){
   const value=normalizeSettings(m.settings);await chrome.storage.local.set({aaV4settings:value});
   reclaimTasks();for(const [key,binding]of taskBindings){const error=bindingError(binding,value);if(error)invalidateTask(key,binding,error);}
   return{saved:true};
  }
  if(m.action==='CONTROL'){
   if(!Number.isInteger(m.tabId))throw Error('TAB_REQUIRED');
   if(!['status','diagnose','start','stop'].includes(m.command))throw Error('COMMAND_INVALID');
   if(m.command==='stop'){reviews.cancel(m.tabId);drafts.cancel(m.tabId);}
   return await chrome.tabs.sendMessage(m.tabId,{action:m.command},{frameId:0});
  }
  if(m.action==='CHECKPOINT'){return (await chrome.storage.local.get('aaV4checkpoint:'+m.tabId))['aaV4checkpoint:'+m.tabId]||null;}
  throw Error('UI_ACTION_INVALID');
 }
 if(!page(sender))throw Error('SENDER_NOT_ALLOWED');
 if(m.action==='RENDERED_CAPTURE'){
  if([m.taskId,m.requestId,m.questionId].some(v=>typeof v!=='string'||!v||v.length>256))throw Error('CAPTURE_BINDING_INVALID');
  const key=scope(sender,m.taskId);reclaimTasks();if(cancelled.has(key))throw Error('STOPPED');
  const id=key+':'+m.requestId;if(requests.has(id))throw Error('REQUEST_DUPLICATE');
  const controller=new AbortController(),entry={scope:key,controller,url:courseKey(sender.url)};requests.set(id,entry);
  try{
   const s=await settings();controller.signal.throwIfAborted();const context=requireCourse(courseForUrl(s,sender.url));
   if(!m.course||JSON.stringify(normalizeCourse(m.course))!==JSON.stringify(context))throw Error('COURSE_CHANGED');
   const primary=selectRole(s,'answer');if(!primary.profile.apiKey)throw Error('API_KEY_REQUIRED');
   if(primary.profile.capabilities?.vision!==true||s.reviewMode==='enhanced'&&selectRole(s,'independent').profile.capabilities?.vision!==true)throw Error('VISION_REQUIRED：整题截图要求本次使用的模型均支持图片');
   if(taskBindings.has(key)){if(m.beginTask===true)throw Error('TASK_ALREADY_STARTED');validateTask(key,s,sender.url,m.taskToken);}
   else{if(m.beginTask!==true||m.taskToken!==undefined)throw Error('TASK_NOT_FOUND');taskBindings.set(key,{token:crypto.randomUUID(),url:entry.url,context,fingerprint:taskFingerprint(s),lastSeen:Date.now()});}
   const taskToken=taskBindings.get(key).token;
   const binding=taskBindings.get(key),tab=await chrome.tabs.get(sender.tab.id);controller.signal.throwIfAborted();
   if(!binding.captureTab)binding.captureTab={id:sender.tab.id,windowId:tab.windowId,url:tab.url};
   const guard=async()=>{controller.signal.throwIfAborted();const latest=await settings();controller.signal.throwIfAborted();const current=validateTask(key,latest,sender.url,taskToken);await validateCapturedTab(key,current);controller.signal.throwIfAborted();};
   const image=await captureRenderedQuestion({tabId:sender.tab.id,questionId:m.questionId,captureId:m.requestId,taskId:m.taskId,signal:controller.signal,guard});
   await guard();return{image,taskToken};
  }finally{requests.delete(id);}
 }
 if(['LOCAL_DRAFT_SAVE','LOCAL_DRAFT_VERIFY'].includes(m.action)){
  if(typeof m.taskId!=='string'||!m.taskId||m.taskId.length>256)throw Error('TASK_REQUIRED');
  const key=scope(sender,m.taskId);reclaimTasks();if(cancelled.has(key))throw Error('STOPPED');
  const s=await settings(),context=requireCourse(courseForUrl(s,sender.url));
  if(!m.course||JSON.stringify(normalizeCourse(m.course))!==JSON.stringify(context))throw Error('COURSE_CHANGED');
  if(taskBindings.has(key)){
   if(m.beginTask===true)throw Error('TASK_ALREADY_STARTED');validateTask(key,s,sender.url,m.taskToken);
  }else{
   if(m.action!=='LOCAL_DRAFT_SAVE'||m.beginTask!==true||m.taskToken!==undefined)throw Error('TASK_NOT_FOUND');
   taskBindings.set(key,{token:crypto.randomUUID(),url:courseKey(sender.url),context,fingerprint:taskFingerprint(s),lastSeen:Date.now()});
  }
  const token=taskBindings.get(key).token;
  const guard=()=>validateTask(key,s,sender.url,token);
  const result=await (m.action==='LOCAL_DRAFT_SAVE'?drafts.save(m,sender,{guard}):drafts.verify(m,sender,{guard}));
  validateTask(key,await settings(),sender.url,token);
  return m.action==='LOCAL_DRAFT_SAVE'?{...result,taskToken:token}:result;
 }
 if(m.action==='REVIEW_MATCH')return reviews.matchPending(m.record,sender);
 if(m.action==='REVIEW_SAVE'){
  if(m.strict!==true)return reviews.save(m.record,sender,m.images);
  const key=scope(sender,m.taskId),s=await settings();
  const guard=()=>validateTask(key,s,sender.url,m.taskToken);guard();
  const result=await reviews.save(m.record,sender,m.images,{strict:true,guard});
  validateTask(key,await settings(),sender.url,m.taskToken);return result;
 }
 if(m.action==='PUBLIC_SETTINGS')return publicSettings(await settings(),sender.url);
 if(m.action==='TASK_VALIDATE'){
  if(typeof m.taskId!=='string'||!m.taskId)throw Error('TASK_REQUIRED');
  const key=scope(sender,m.taskId);reclaimTasks();const s=await settings(),binding=validateTask(key,s,sender.url,m.taskToken);await validateCapturedTab(key,binding);validateTask(key,s,sender.url,m.taskToken);return{valid:true};
 }
 if(m.action==='CHECKPOINT_GET')return (await chrome.storage.local.get('aaV4checkpoint:'+sender.tab.id))['aaV4checkpoint:'+sender.tab.id]||null;
 if(m.action==='STATUS_UPDATE'){
  const state=m.state;if(!state||!Array.isArray(state.results))throw Error('STATUS_INVALID');
  const key='aaV4checkpoint:'+sender.tab.id,checkpoint={...state,results:state.results.slice(-100),url:courseKey(sender.url)||new URL(sender.url).origin+new URL(sender.url).pathname,updatedAt:Date.now()};
  await chrome.storage.local.set({[key]:checkpoint});try{await reviews.captureRun(state,sender);}catch(error){try{await chrome.storage.local.set({[key]:{...checkpoint,auditError:'AUDIT_SAVE_FAILED：'+String(error.message||error).slice(0,400)}});}catch{}throw error;}return{ok:true};
 }
 if(m.action==='CANCEL_TASK'){
  const key=scope(sender,m.taskId);cancelled.set(key,Date.now());taskBindings.delete(key);for(const r of requests.values())if(r.scope===key)r.controller.abort(Error('STOPPED'));return{cancelled:true};
 }
 if(m.action==='MODEL_REQUEST'){
  const key=scope(sender,m.taskId);reclaimTasks();
  if(cancelled.has(key))throw Error('STOPPED');
  if(typeof m.requestId!=='string'||typeof m.taskId!=='string'||!m.question||typeof m.question.id!=='string'||typeof m.question.stem!=='string')throw Error('QUESTION_INVALID');
  if(JSON.stringify(m.question).length>15000000)throw Error('QUESTION_TOO_LARGE');
  const id=key+':'+m.requestId;if(requests.has(id))throw Error('REQUEST_DUPLICATE');
  const controller=new AbortController(),entry={scope:key,controller,url:courseKey(sender.url)||sender.url,context:m.course?normalizeCourse(m.course):undefined};requests.set(id,entry);
  try {
   const s=await settings();controller.signal.throwIfAborted();const context=requireCourse(courseForUrl(s,sender.url));
   if(m.course&&JSON.stringify(normalizeCourse(m.course))!==JSON.stringify(context))throw Error('COURSE_CHANGED：任务期间课程背景已变化');entry.context=context;
   if(!['answer','independent','review'].includes(m.purpose||'answer'))throw Error('PURPOSE_INVALID');
   entry.purpose=m.purpose||'answer';
   if(taskBindings.has(key)){
    if(m.beginTask===true)throw Error('TASK_ALREADY_STARTED：任务已开始，请重新开始');
    validateTask(key,s,sender.url,m.taskToken);
   }else if(m.beginTask!==true||entry.purpose!=='answer'||m.taskToken!==undefined)throw Error('TASK_NOT_FOUND：任务配置已失效，请重新开始');
   const selected=selectRole(s,entry.purpose);
   if(!taskBindings.has(key))taskBindings.set(key,{token:crypto.randomUUID(),url:entry.url,context,fingerprint:taskFingerprint(s),lastSeen:Date.now()});
   const taskToken=taskBindings.get(key).token;
   await validateCapturedTab(key,taskBindings.get(key));controller.signal.throwIfAborted();
   const result=await callModel(selected.profile,m.question,{signal:controller.signal,context,purpose:entry.purpose,candidate:m.purpose==='review'?m.candidate:undefined});
   controller.signal.throwIfAborted();const latest=await settings();controller.signal.throwIfAborted();
   await validateCapturedTab(key,validateTask(key,latest,sender.url,taskToken));controller.signal.throwIfAborted();
   return m.includeSource===true?{transport:1,content:result,source:selected.source,taskToken}:result;
  }finally{requests.delete(id);}
 }
 throw Error('ACTION_INVALID');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{handle(m,sender).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message||'UNKNOWN_ERROR'}));return true;});
chrome.tabs.onActivated?.addListener(({tabId,windowId})=>{for(const [key,binding]of taskBindings){const target=binding.captureTab;if(target?.windowId===windowId&&target.id!==tabId)invalidateTask(key,binding,Error('CAPTURE_ACTIVE_TAB_CHANGED：整题截图任务期间已切换标签，请重新开始'));}});
chrome.tabs.onRemoved.addListener(tabId=>{reviews.cancel(tabId);drafts.cancel(tabId);for(const [id,r]of requests)if(id.startsWith(tabId+':'))r.controller.abort(Error('TAB_CLOSED'));for(const map of [taskBindings,cancelled])for(const key of map.keys())if(key.startsWith(tabId+':'))map.delete(key);chrome.storage.local.remove('aaV4checkpoint:'+tabId);});
