import {courseKey} from '../storage/context.js';

export function diagnosticExport({version,diagnosis,state,checkpoint,paperKey,reviewQueue}){
 let previousRun=null;
 if(typeof paperKey==='string'&&courseKey(paperKey)===paperKey&&checkpoint?.url===paperKey&&Array.isArray(checkpoint.results)){
  previousRun={};
  for(const field of ['state','stage','mode','total','completed','skipped','failed','reviewPending','elapsedMs','draftSaved','canSave','executionScope','persistenceTarget','localDraftSaved','localDraftCount','pageFlow','auditError','error','modelFailure','updatedAt','results'])if(Object.hasOwn(checkpoint,field))previousRun[field]=structuredClone(checkpoint[field]);
 }
 let reviewAttempts;
 if(typeof paperKey==='string'&&courseKey(paperKey)===paperKey&&reviewQueue?.paperKey===paperKey&&Array.isArray(reviewQueue.records)){
  const failure=v=>v&&typeof v==='object'?{stage:typeof v.stage==='string'?v.stage.slice(0,40):'',reason:typeof v.reason==='string'?v.reason.slice(0,1000):'',at:Number.isFinite(v.at)?v.at:null}:null;
  const short=v=>typeof v==='string'?v.slice(0,512):null;
  reviewAttempts={total:reviewQueue.total??reviewQueue.records.length,truncated:(reviewQueue.total??reviewQueue.records.length)>20,records:reviewQueue.records.slice(0,20).map(r=>({id:short(r.id),questionId:short(r.questionId||r.id),number:r.number??null,type:short(r.type),status:short(r.status),firstFailure:failure(r.firstFailure),lastFailure:failure(r.lastFailure)}))};
 }
 return{version,diagnosis,state,previousRun,...(reviewAttempts?{reviewAttempts}:{})};
}
