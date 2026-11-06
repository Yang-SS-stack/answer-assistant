import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateNativeRequest,validExtensionOrigin,frameDecoder,encodeFrame} from './framing.mjs';
import {startConsoleLogin,queryQuota,validateCredential,publicScope} from './qwen-console.mjs';
const CODES=new Set(['NATIVE_PROTOCOL','QWEN_AUTH_INVALID','QWEN_AUTH_EXPIRED','QWEN_SCOPE_UNSUPPORTED','QWEN_LOGIN_FAILED','QWEN_LOGIN_CANCELLED','QWEN_LOGIN_TIMEOUT','QWEN_CREDENTIAL_UNAVAILABLE','QUOTA_FORMAT','QUOTA_FORBIDDEN','QUOTA_RATE_LIMIT','QUOTA_QUERY_FAILED','QUOTA_CANCELLED','QUOTA_TIMEOUT','QUOTA_NETWORK','QUOTA_STALE']);
const codeOf=e=>CODES.has(e?.message)?e.message:'NATIVE_FAILED';
function publicQuota(value,models){
 if(!value||typeof value.sessionId!=='string'||!Array.isArray(value.models)||value.models.length!==models.length)throw Error('QUOTA_FORMAT');
 const rows=value.models.map((r,i)=>{
  if(!r||r.model!==models[i]||!['valid','expired','none','unknown'].includes(r.status))throw Error('QUOTA_FORMAT');
  const number=n=>n===null||Number.isSafeInteger(n)&&n>=0;
  if(!number(r.remaining)||!number(r.total)||!number(r.expiresAt)||(r.remaining!==null&&r.total!==null&&r.remaining>r.total))throw Error('QUOTA_FORMAT');
  return{model:r.model,remaining:r.remaining,total:r.total,expiresAt:r.expiresAt,status:r.status};
 });
 return{sessionId:value.sessionId,models:rows};
}
export function nativeController({credentials,login=startConsoleLogin,query=queryQuota}={}){
 let generation=0,active=null,starting=null,cleanup=Promise.resolve(),closed=false,lastError=null,expiredSession=null;const queries=new Set();
 const load=async()=>{try{const c=await credentials.load();return c?validateCredential(c):null;}catch{throw Error('QWEN_CREDENTIAL_UNAVAILABLE');}};
 async function status(){const gen=generation;await cleanup;const c=await load();const authenticated=!closed&&gen===generation&&!!c&&c.sessionId!==expiredSession;return{bridgeVersion:'4.12.0',authenticated,connecting:!!active||!!starting,...(authenticated?{sessionId:c.sessionId,scope:publicScope(c)}:{}),...(lastError?{error:lastError}:{}),...(c?.sessionId===expiredSession?{error:'QWEN_AUTH_EXPIRED'}:{})};}
 async function stop(){generation++;const old=active,pending=starting;active=null;for(const ctrl of queries)ctrl.abort();if(old){old.cancel();await old.done.catch(()=>{});}if(pending)await pending.catch(()=>{});}
 async function handle(value){
  let r;try{
   r=validateNativeRequest(value);if(closed)throw Error('QWEN_LOGIN_CANCELLED');let data;
   if(r.op==='status')data=await status();
   if(r.op==='logout'){const stopping=stop(),previous=cleanup;cleanup=(async()=>{await previous.catch(()=>{});await stopping;await credentials.clear();})();await cleanup;lastError=null;expiredSession=null;data={bridgeVersion:'4.12.0',authenticated:false,connecting:false};}
   if(r.op==='quota'){
    const gen=generation;await cleanup;const c=await load();if(gen!==generation||closed)throw Error('QUOTA_STALE');if(!c||c.sessionId===expiredSession)throw Error('QWEN_AUTH_EXPIRED');const ctrl=new AbortController();queries.add(ctrl);
    try{const result=await query(c,r.models,{signal:ctrl.signal});const latest=await load();if(gen!==generation||latest?.sessionId!==c.sessionId||result?.sessionId!==c.sessionId)throw Error('QUOTA_STALE');data={...publicQuota(result,r.models),scope:publicScope(c)};lastError=null;}catch(error){if(error.message==='QWEN_AUTH_EXPIRED'&&gen===generation)expiredSession=c.sessionId;throw error;}finally{queries.delete(ctrl);}
   }
   if(r.op==='login'){
    const requested=generation;await cleanup;if(closed||requested!==generation)throw Error('QWEN_LOGIN_CANCELLED');
    if(starting){await starting;if(closed||requested!==generation)throw Error('QWEN_LOGIN_CANCELLED');}
    if(active)data={connecting:true,loginUrl:active.url};
    else{
     const gen=++generation;lastError=null;expiredSession=null;
     for(const ctrl of queries)ctrl.abort();
     const pending=(async()=>{
     const operation=await login({verify:async(c,signal)=>{const result=await query(c,r.models,{signal});if(result?.sessionId!==c.sessionId)throw Error('QUOTA_STALE');return publicQuota(result,r.models);},save:(c,guard)=>credentials.save(c,()=>{guard();if(gen!==generation)throw Error('QWEN_LOGIN_CANCELLED');})});
     if(gen!==generation){operation.cancel();await operation.done.catch(()=>{});throw Error('QWEN_LOGIN_CANCELLED');}
     const url=new URL(operation.url);if(url.origin!=='https://bailian.console.aliyun.com'||url.pathname!=='/console-login'){operation.cancel();throw Error('QWEN_LOGIN_FAILED');}
     active=operation;operation.done.then(()=>{if(generation===gen){active=null;lastError=null;}},error=>{if(generation===gen){active=null;lastError=codeOf(error);}});return operation;
     })();starting=pending;try{const operation=await pending;data={connecting:true,loginUrl:operation.url};}finally{if(starting===pending)starting=null;}
    }
   }
   return{version:1,id:r.id,ok:true,data};
  }catch(error){return{version:1,id:r?.id??null,ok:false,error:{code:codeOf(error)}};}
 }
 return{handle,async close(){closed=true;await stop();await cleanup.catch(()=>{});}};
}
export async function serveNative({input=process.stdin,output=process.stdout,origin,expectedOrigin,controller}){
 if(!validExtensionOrigin(origin)||origin!==expectedOrigin)throw Error('NATIVE_ORIGIN');
 const decoder=frameDecoder(),pending=new Set();let queue=Promise.resolve(),failure;
 const send=value=>new Promise((resolve,reject)=>output.write(encodeFrame(value),error=>error?reject(error):resolve()));
 // Read control frames independently of queries; only frame writes are serialized.
 try{
  for await(const chunk of input){for(const message of decoder.push(chunk)){
   const task=controller.handle(message).then(result=>{queue=queue.then(()=>send(result));return queue;});pending.add(task);
   task.then(()=>pending.delete(task),error=>{pending.delete(task);failure=error;input.destroy(error);});
  }}decoder.finish();
 // EOF invalidates operations before draining their responses, including login startup.
 }finally{await controller.close();await Promise.allSettled([...pending]);await queue;}
 if(failure)throw failure;
}
async function main(){
 const dir=path.dirname(fileURLToPath(import.meta.url));const text=await readFile(path.join(dir,'host-config.json'),'utf8');if(text.length>16384)throw Error('NATIVE_CONFIG');const config=JSON.parse(text);
 const at=process.argv.indexOf('--origin'),origin=at>=0?process.argv[at+1]:null;if(config.version!==1||origin!==config.origin||!validExtensionOrigin(origin))throw Error('NATIVE_ORIGIN');
 if(!process.env.LOCALAPPDATA)throw Error('NATIVE_CONFIG');const {createCredentialStore}=await import('./credential-store.mjs');
 const credentials=createCredentialStore({directory:path.join(process.env.LOCALAPPDATA,'AnswerAssistant','quota-bridge','data')});
 await serveNative({origin,expectedOrigin:config.origin,controller:nativeController({credentials})});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{process.exitCode=1;});
