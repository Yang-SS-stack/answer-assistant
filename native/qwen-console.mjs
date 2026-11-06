// Adapted from modelstudioai/cli at cadc301d078f0fd1f2c56f7bf94f32c55bbb055d.
// Copyright 2026 Aliyun Model Studio (DashScope) AI Platform.
// Licensed under Apache-2.0; see LICENSE-bailian.txt.
// Modified for a fixed, read-only Beijing quota bridge: bounded schemas,
// no API-key creation, no arbitrary console calls, no credential forwarding.
import http from 'node:http';import {randomBytes,randomUUID} from 'node:crypto';
import {validateModels} from './framing.mjs';
const ORIGIN='https://bailian.console.aliyun.com',API='zeldaEasy.bailian-commerce.freeTrial.queryFreeTierQuota';
const ENDPOINT='https://bailian-cs.console.aliyun.com/cli/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api='+encodeURIComponent(API);
const safeInt=x=>Number.isSafeInteger(x)&&x>=0;
const failure=code=>Error(code);
function gatewayError(raw){const data=raw?.data;if(data?.success===false||raw?.success===false){const code=data?.errorCode??raw?.errorCode;throw failure(typeof code==='string'&&/NotLogined|Expired|Unauthorized/i.test(code)?'QWEN_AUTH_EXPIRED':'QUOTA_QUERY_FAILED');}}
export function parseQuotaResponse(raw,models,now=Date.now()){
 validateModels(models);gatewayError(raw);const rows=raw?.data?.DataV2?.data?.data?.freeTierQuotas??raw?.data?.data?.freeTierQuotas;
 if(!Array.isArray(rows)||rows.length>1000)throw failure('QUOTA_FORMAT');
 return models.map(model=>{
  const matched=rows.filter(r=>r&&r.model===model);const empty={model,remaining:null,total:null,expiresAt:null,status:'none'};
  if(!matched.length)return empty;if(matched.length!==1)throw failure('QUOTA_FORMAT');const r=matched[0];
  if(!safeInt(r.quotaInitTotal)||!safeInt(r.quotaTotal)||r.quotaTotal>r.quotaInitTotal||!safeInt(r.quotaValidityPeriod)||r.quotaValidityPeriod>8640000000000000)return{...empty,status:'unknown'};
  const status=r.quotaStatus==='VALID'?(r.quotaValidityPeriod>0&&r.quotaValidityPeriod<=now?'expired':r.quotaInitTotal===0?'none':'valid'):r.quotaStatus==='EXPIRED'?'expired':'unknown';
  return{model,remaining:r.quotaTotal,total:r.quotaInitTotal,expiresAt:r.quotaValidityPeriod||null,status};
 });
}
export function validateCredential(c){
 if(!c||c.region!=='cn-beijing'||c.site!=='domestic'||typeof c.accessToken!=='string'||!/^[A-Za-z0-9._~+/=-]{8,16384}$/.test(c.accessToken)||typeof c.sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(c.sessionId))throw failure('QWEN_AUTH_INVALID');
 if(c.switchAgent!==undefined&&(!safeInt(c.switchAgent)||c.switchAgent===0))throw failure('QWEN_SCOPE_UNSUPPORTED');
 if(c.workspaceId!==undefined&&(typeof c.workspaceId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.workspaceId)))throw failure('QWEN_SCOPE_UNSUPPORTED');
 return{accessToken:c.accessToken,sessionId:c.sessionId,region:'cn-beijing',site:'domestic',...(c.switchAgent!==undefined?{switchAgent:c.switchAgent}:{}),...(c.workspaceId?{workspaceId:c.workspaceId}:{})};
}
export const publicScope=c=>({region:'cn-beijing',site:'domestic',...(c.workspaceId?{workspaceHint:'…'+c.workspaceId.slice(-6)}:{})});
async function jsonResponse(response){
 const limit=1048576;let text='';const declared=Number(response.headers?.get('content-length'));if(Number.isFinite(declared)&&declared>limit)throw failure('QUOTA_FORMAT');
 if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw failure('QUOTA_FORMAT');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}text=Buffer.concat(chunks).toString('utf8');}
 else{text=await response.text();if(Buffer.byteLength(text)>limit)throw failure('QUOTA_FORMAT');}
 try{return JSON.parse(text);}catch{throw failure('QUOTA_FORMAT');}
}
export async function queryQuota(rawCredential,models,{fetchImpl=fetch,now=Date.now,signal,timeoutMs=10000}={}){
 const c=validateCredential(rawCredential);validateModels(models);const timer=AbortSignal.timeout(timeoutMs),requestSignal=signal?AbortSignal.any([signal,timer]):timer;
 const params={Api:API,V:'1.0',Data:{queryFreeTierQuotaRequest:{models},cornerstoneParam:{protocol:'V2',console:'ONE_CONSOLE',productCode:'p_efm',switchUserType:3,consoleSite:'BAILIAN_ALIYUN',...(c.switchAgent!==undefined?{switchAgent:c.switchAgent}:{})}}};
 try{
  const response=await fetchImpl(ENDPOINT,{method:'POST',headers:{Accept:'*/*','Content-Type':'application/x-www-form-urlencoded',Authorization:'Bearer '+c.accessToken},body:new URLSearchParams({params:JSON.stringify(params),region:'cn-beijing'}).toString(),signal:requestSignal,redirect:'error'});
  if(response.status===401)throw failure('QWEN_AUTH_EXPIRED');if(response.status===403)throw failure('QUOTA_FORBIDDEN');if(response.status===429)throw failure('QUOTA_RATE_LIMIT');if(!response.ok)throw failure('QUOTA_QUERY_FAILED');
  const modelsData=parseQuotaResponse(await jsonResponse(response),models,now());requestSignal.throwIfAborted();return{sessionId:c.sessionId,scope:publicScope(c),models:modelsData};
 }catch(error){if(/^(QWEN_|QUOTA_)/.test(error?.message||''))throw error;if(requestSignal.aborted)throw failure(signal?.aborted?'QUOTA_CANCELLED':'QUOTA_TIMEOUT');throw failure('QUOTA_NETWORK');}
}
function callbackCredential(value){
 const raw=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const first=(...keys)=>keys.map(k=>raw[k]).find(v=>v!==undefined&&v!==null);
 const region=first('console_region','consoleRegion')??'cn-beijing',site=first('console_site','consoleSite')??'domestic';
 if(region!=='cn-beijing'||site!=='domestic')throw failure('QWEN_SCOPE_UNSUPPORTED');
 const agent=first('console_switch_agent','consoleSwitchAgent');
 return validateCredential({accessToken:first('access_token','accessToken'),sessionId:randomUUID(),region,site,...(agent!==undefined?{switchAgent:Number(agent)}:{}),...(first('workspace_id','workspaceId')!==undefined?{workspaceId:first('workspace_id','workspaceId')}:{})});
}
function readBody(req){return new Promise((resolve,reject)=>{const chunks=[];let size=0,failed=false;req.on('data',b=>{if(failed)return;size+=b.length;if(size>65536){failed=true;reject(failure('QWEN_BODY_TOO_LARGE'));return;}chunks.push(b);});req.once('end',()=>{if(!failed)resolve(Buffer.concat(chunks).toString('utf8'));});req.once('error',()=>reject(failure('QWEN_LOGIN_FAILED')));});}
export async function startConsoleLogin({verify,save,timeoutMs=900000}={}){
 if(typeof verify!=='function'||typeof save!=='function')throw failure('QWEN_LOGIN_FAILED');
 const state=randomBytes(24).toString('hex'),controller=new AbortController();let finished=false,saving=false,port,timer,resolveDone,rejectDone,workerDone=Promise.resolve();
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
 // Cancel networking immediately, but let an in-flight atomic credential commit settle
 // before logout clears it. A resolved cancellation must never precede a late save.
 const end=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);server.close();server.closeAllConnections();workerDone.then(()=>error?rejectDone(error):resolveDone(result));};
 const server=http.createServer(async(req,res)=>{
  let ownsCallback=false,finishWorker;
  const reply=(status,text)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(text);}};
  try{
   if(req.headers.host!=='127.0.0.1:'+port)return reply(403,'Host not allowed');
   const origin=req.headers.origin;if(origin!==undefined&&origin!==ORIGIN)return reply(403,'Origin not allowed');
   if(origin===ORIGIN){res.setHeader('Access-Control-Allow-Origin',ORIGIN);res.setHeader('Vary','Origin, Access-Control-Request-Private-Network');}
   if(req.method==='OPTIONS'){if(origin!==ORIGIN)return reply(403,'Origin not allowed');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');return reply(204,'');}
   if(!['GET','POST'].includes(req.method))return reply(405,'Method not allowed');
   const url=new URL(req.url,'http://127.0.0.1');if(url.pathname!=='/'||url.searchParams.get('state')!==state)return reply(400,'Invalid state');
   if(finished||saving)return reply(409,'Login no longer waiting');let value=Object.fromEntries(url.searchParams);
   if(req.method==='POST'){
    const type=(req.headers['content-type']||'').split(';')[0].trim();if(!['application/json','application/x-www-form-urlencoded','text/plain'].includes(type))return reply(415,'Unsupported content type');
    const body=await readBody(req);try{value={...value,...(type==='application/x-www-form-urlencoded'?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body))};}catch{return reply(400,'Invalid callback');}
   }
   // Bodies can complete concurrently: claim the callback only after the last await.
   if(finished||saving)return reply(409,'Login no longer waiting');
   const credential=callbackCredential(value);saving=true;ownsCallback=true;workerDone=new Promise(resolve=>{finishWorker=resolve;});const guard=()=>{if(controller.signal.aborted||finished)throw failure('QWEN_LOGIN_CANCELLED');};
   await verify(credential,controller.signal);guard();await save(credential,guard);guard();reply(200,'授权已完成，可以回到自动答题插件。');res.once('finish',()=>end(null,{sessionId:credential.sessionId,scope:publicScope(credential)}));
  }catch(error){if(error?.message==='QWEN_BODY_TOO_LARGE')return reply(413,'Callback too large');reply(400,'授权未完成，请回到插件重试。');if(ownsCallback)end(failure(error?.message==='QWEN_SCOPE_UNSUPPORTED'?'QWEN_SCOPE_UNSUPPORTED':'QWEN_LOGIN_FAILED'));}
  finally{finishWorker?.();}
 });
 server.headersTimeout=5000;server.requestTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});port=server.address().port;
 const url=ORIGIN+'/console-login?notice='+`127.0.0.1:${port}?state=${state}`;
 timer=setTimeout(()=>{controller.abort();end(failure('QWEN_LOGIN_TIMEOUT'));},timeoutMs);
 return{url,done,cancel(){controller.abort();end(failure('QWEN_LOGIN_CANCELLED'));}};
}
