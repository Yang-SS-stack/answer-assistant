import {usageLedger} from './usage.js';
import {deepSeekBalance} from './balance.js';
import {validateLoginUrl} from './native-bridge.js';

const SALT='aaV4monitorSalt',ASSOCIATION='aaV4monitorAssociation',CACHE='aaV4monitorQuota';
const copy=value=>structuredClone(value),emptyUsage=()=>({rows:[],hasData:false,incomplete:false});
const modelsFor=s=>[...new Set([s.provider==='qwen'?s.providers.qwen.model:null,s.reviewMode==='enhanced'?s.reviewer.model:null].filter(Boolean))];
const same=(a,b)=>a?.key===b?.key&&a?.scope===b?.scope&&a?.modelsKey===b?.modelsKey;
const fixedError=e=>/^(BRIDGE_|QWEN_|QUOTA_|NATIVE_|CREDENTIAL_)[A-Z_]+$/.test(e?.message||'')?e.message:'QUOTA_QUERY_FAILED';
function quotaData(raw,models){
 if(!Array.isArray(raw?.models)||raw.models.length!==models.length)throw Error('QUOTA_FORMAT');
 return {models:models.map(model=>{const rows=raw.models.filter(r=>r?.model===model);if(rows.length!==1)throw Error('QUOTA_FORMAT');const r=rows[0];
  if(!['valid','expired','none','unknown'].includes(r.status)||![r.remaining,r.total].every(n=>n===null||Number.isSafeInteger(n)&&n>=0)||r.remaining!==null&&r.total!==null&&r.remaining>r.total||!(r.expiresAt===null||Number.isSafeInteger(r.expiresAt)&&r.expiresAt>=0))throw Error('QUOTA_FORMAT');
  return {model,remaining:r.remaining,total:r.total,expiresAt:r.expiresAt,status:r.status};})};
}

// This service is observational. Only explicit UI actions can authorize or log in.
// Credential scopes and raw attempt identities remain in trusted extension storage.
export function monitorService({storage,getSettings,getTaskId,bridge,nativePermitted,isBusy,openLogin,now=Date.now,fetchImpl=fetch}){
 const ledger=usageLedger(storage,{now});let saltPromise,generation=0,identity,association,cache,loaded=false,nativeState,nativeAt=-Infinity,nativePending,inflight,control=Promise.resolve(),writes=Promise.resolve(),observationIncomplete=false;
 const serial=fn=>{const p=control.then(fn,fn);control=p.catch(()=>{});return p;};
 const persist=values=>{const p=writes.then(()=>storage.set(values));writes=p.catch(()=>{});return p;};
 async function scope(provider,key){
  if(!key)return '';
  if(!saltPromise)saltPromise=(async()=>{let value=(await storage.get(SALT))[SALT];if(typeof value!=='string'||!/^[a-f0-9-]{36}$/i.test(value)){value=crypto.randomUUID();await storage.set({[SALT]:value});}return value;})().catch(e=>{saltPromise=undefined;throw e;});
  const salt=await saltPromise;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+'\0'+provider+'\0'+key));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
 }
 const ds=deepSeekBalance({storage,getProfile:async()=>(await getSettings()).providers.deepseek,getScope:async()=>scope('deepseek',(await getSettings()).providers.deepseek.apiKey),fetchImpl,now});
 async function current(){const s=await getSettings(),key=s.providers.qwen.apiKey,models=modelsFor(s);return {key,scope:await scope('qwen',key),models,modelsKey:JSON.stringify(models)};}
 function invalidate(){generation++;identity=undefined;cache=undefined;association=undefined;loaded=true;inflight=undefined;}
 async function ensure(){
  const id=await current();
  if(identity&&!same(identity,id)){const keyChanged=identity.key!==id.key;generation++;cache=undefined;inflight=undefined;if(keyChanged)association=undefined;await persist({[CACHE]:null,...(keyChanged?{[ASSOCIATION]:null}:{})});}
  identity=id;
  if(!loaded){const epoch=generation;const saved=await storage.get([ASSOCIATION,CACHE]);if(epoch!==generation||!same(id,await current()))return ensure();
   const a=saved[ASSOCIATION];association=a?.confirmed===true&&a.scope===id.scope&&typeof a.sessionId==='string'?{scope:a.scope,sessionId:a.sessionId,confirmed:true}:undefined;
   const c=saved[CACHE];if(c?.scope===id.scope&&c.modelsKey===id.modelsKey&&Number.isFinite(c.fetchedAt)&&c.fetchedAt<=now()&&c.fetchedAt>=0&&Number.isFinite(c.nextRefreshAt)&&c.nextRefreshAt<=now()+60000&&c.nextRefreshAt>=c.fetchedAt){try{cache={...c,data:quotaData(c.data,id.models)};}catch{}}
   loaded=true;
  }return id;
 }
 async function native(force=false){
  if(!await nativePermitted()){nativeState=undefined;nativeAt=-Infinity;return {permission:false};}
  if(nativePending)return nativePending;
  if(!force&&nativeState&&now()-nativeAt<(nativeState.connecting?500:30000))return nativeState;
  const epoch=generation;
  nativePending=(async()=>{try{const r=await bridge.request('status');const state={permission:true,authenticated:r.authenticated===true,connecting:r.connecting===true,...(typeof r.sessionId==='string'?{sessionId:r.sessionId}:{}),...(r.error?{error:fixedError({message:r.error})}:{})};if(epoch===generation){nativeState=state;nativeAt=now();}return state;}catch(e){const state={permission:true,error:fixedError(e)};if(epoch===generation){nativeState=state;nativeAt=now();}return state;}})().finally(()=>{nativePending=undefined;});return nativePending;
 }
 function publicQwen(id,n){
  if(!id.key)return {status:'unconfigured'};
  if(!id.models.length)return {status:'inactive'};
  if(!n.permission)return {status:'permission_required'};
  if(n.error)return {status:n.error==='BRIDGE_NOT_INSTALLED'?'not_installed':'error',error:n.error};
  if(n.connecting)return {status:'connecting'};
  if(!n.authenticated)return {status:'disconnected'};
  const source={region:'cn-beijing',site:'中国内地'};
  if(!association||association.scope!==id.scope||association.sessionId!==n.sessionId)return {status:'needs_association',sessionId:n.sessionId,source};
  const valid=cache?.scope===id.scope&&cache?.modelsKey===id.modelsKey&&cache?.sessionId===n.sessionId;
  return {status:valid?(cache.error?'error':cache.data?'ready':'empty'):'empty',source,...(valid?{...(cache.data?{data:copy(cache.data),fetchedAt:cache.fetchedAt}:{}),nextRefreshAt:cache.nextRefreshAt,stale:!!cache.data&&(!!cache.error||now()>=cache.nextRefreshAt),...(cache.error?{error:cache.error}:{})}:{})};
 }
 async function qwenStatus(force=false){return serial(async()=>{const id=await ensure(),n=await native(force);if(!same(id,await current()))return {status:'changed'};return publicQwen(id,n);});}
 async function qwenRefresh(){
  const result=await serial(async()=>{const id=await ensure(),n=await native();const state=publicQwen(id,n);if(!['ready','empty','error'].includes(state.status)||!association||association.sessionId!==n.sessionId)return {result:state};
   if(inflight)return {task:inflight};if(cache?.sessionId===n.sessionId&&now()<cache.nextRefreshAt)return {result:state};
   const epoch=generation,sessionId=n.sessionId;cache={...(cache?.sessionId===sessionId?cache:{}),scope:id.scope,modelsKey:id.modelsKey,sessionId,nextRefreshAt:now()+60000};
   const task=(async()=>{let data,error;try{const r=await bridge.request('quota',{models:id.models});if(r.sessionId!==sessionId)throw Error('QWEN_AUTH_EXPIRED');data=quotaData(r,id.models);}catch(e){error=fixedError(e);}
    return serial(async()=>{if(epoch!==generation||!same(id,await current()))return {status:'changed'};const fresh=await native(true);if(!fresh.authenticated||fresh.sessionId!==sessionId)return publicQwen(id,fresh);
     cache={...cache,...(data?{data,fetchedAt:now()}:{}),...(error?{error}:{})};if(!error)delete cache.error;
     try{await persist({[CACHE]:cache});}catch{cache.error='QUOTA_STORAGE_ERROR';}
     if(epoch!==generation||!same(id,await current()))return {status:'changed'};return publicQwen(id,fresh);
    });})();inflight=task;task.finally(()=>{if(inflight===task)inflight=undefined;}).catch(()=>{});return {task};
  });return result.task??result.result;
 }
 async function usage({tabId,period='task'}={}){try{const old=(await storage.get('aaV4monitorIncomplete')).aaV4monitorIncomplete;if(old===true)observationIncomplete=true;if(observationIncomplete)await persist({aaV4monitorIncomplete:true});const s=await getSettings(),taskId=await getTaskId(tabId);if(period==='task'&&!taskId)return {...emptyUsage(),incomplete:observationIncomplete};const scopes=(await Promise.all(['deepseek','qwen'].map(p=>scope(p,s.providers[p].apiKey)))).filter(Boolean);const report=await ledger.report({scopes,taskId,period:period==='today'?'today':'task'});return {...report,incomplete:report.incomplete||observationIncomplete};}catch{return {...emptyUsage(),incomplete:true};}}
 async function status(options={}){const results=await Promise.allSettled([ds.status(),qwenStatus(options.refreshNative),usage(options)]);return {deepseek:results[0].status==='fulfilled'?results[0].value:{status:'error',error:'BALANCE_CONFIG_ERROR'},qwen:results[1].status==='fulfilled'?results[1].value:{status:'error',error:'QUOTA_STORAGE_ERROR'},usage:results[2].status==='fulfilled'?results[2].value:{...emptyUsage(),incomplete:true}};}
 async function refresh(options={}){await Promise.allSettled([ds.refresh(),qwenRefresh()]);return status(options);}
 async function observeAttempt(meta,event){const at=now();try{if(!['deepseek','qwen'].includes(meta.provider)||typeof meta.requestId!=='string')return;await ledger.record({id:meta.taskId+':'+meta.provider+':'+meta.requestId+':'+event.attempt,kind:event.kind,scope:await scope(meta.provider,meta.apiKey),provider:meta.provider,model:meta.model,role:meta.role,taskId:meta.taskId,usage:event.usage,at});}catch{observationIncomplete=true;/* Observation must never enter the answer error path. */}}
 async function associate({confirmed,sessionId}={}){if(confirmed!==true)throw Error('ASSOCIATION_REQUIRED');return serial(async()=>{const id=await ensure(),n=await native(true);if(!id.key||!n.authenticated||n.sessionId!==sessionId)throw Error('ASSOCIATION_CHANGED');association={scope:id.scope,sessionId,confirmed:true};await persist({[ASSOCIATION]:association});return {associated:true};});}
 async function connect({reconnect=false}={}){const epoch=generation,guard=(expected=epoch)=>{if(expected!==generation)throw Error('QWEN_LOGIN_CANCELLED');};const busy=await isBusy();guard();if(busy)throw Error('MONITOR_BUSY');const permitted=await nativePermitted();guard();if(!permitted)throw Error('BRIDGE_NOT_ALLOWED');return serial(async()=>{guard();const id=await ensure();guard();if(!id.key||!id.models.length)throw Error('QWEN_MODEL_REQUIRED');const n=await native(true);guard();if(n.authenticated&&!reconnect)return {status:'needs_association'};const busy=await isBusy();guard();if(busy)throw Error('MONITOR_BUSY');
  const result=await bridge.request('login',{models:id.models});guard();validateLoginUrl(result.loginUrl);const fresh=await current();guard();const running=await isBusy();guard();if(!same(id,fresh)||running){await bridge.request('logout');throw Error('MONITOR_BUSY');}
  guard();generation++;const next=generation;cache=undefined;association=undefined;await persist({[CACHE]:null,[ASSOCIATION]:null});guard(next);nativeState={permission:true,connecting:true};nativeAt=now();await openLogin(result.loginUrl,()=>guard(next));guard(next);return {status:'connecting'};
 });}
 async function disconnect(){invalidate();nativeState=undefined;nativeAt=-Infinity;let failure;try{if(await nativePermitted())await bridge.request('logout');}catch(e){failure=e;}await serial(async()=>{await persist({[CACHE]:null,[ASSOCIATION]:null});});if(failure)throw Error(fixedError(failure));return {disconnected:true};}
 async function settingsChanged(previous,next){const keyChanged=previous.providers.qwen.apiKey!==next.providers.qwen.apiKey,modelsChanged=JSON.stringify(modelsFor(previous))!==JSON.stringify(modelsFor(next));const work=[];if(keyChanged||modelsChanged){generation++;cache=undefined;identity=undefined;inflight=undefined;if(keyChanged)association=undefined;work.push(persist({[CACHE]:null,...(keyChanged?{[ASSOCIATION]:null}:{})}));}if(previous.providers.deepseek.apiKey!==next.providers.deepseek.apiKey)work.push(ds.invalidate());await Promise.all(work);}
 return {status,refresh,observeAttempt,associate,connect,disconnect,settingsChanged};
}
