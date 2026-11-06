import {sanitizeModelSource} from '../core/model-result.js';
import {isFailedReviewRequest} from './records.js';
// The index is the commit point. Versioned detail keys keep failed writes from
// replacing the last readable revision; legacy arrays survive failed migration.
const DAY=86400000,MAX_BYTES=4000000,MAX_RECORDS=1000;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const short=value=>typeof value==='string'?value.slice(0,240):'';
const source=value=>{try{return sanitizeModelSource(value);}catch{return null;}};
const isPending=r=>r.status!=='applied'&&r.status!=='retry_required';
export function reviewSummary(r){
 const old=r.application?.newAnswer,type=r.question?.type??r.type;
 const fallback=old==null?null:['single','multiple'].includes(type)?{optionIds:old}:type==='judge'?{booleanValue:old}:type==='fill'?{blanks:old}:{text:old};
 const answer=r.answer??r.appliedAnswer??fallback,options=r.question?.options||[];
 const adopted=answer?.optionIds?{selected:answer.optionIds.map(id=>{const o=options.find(o=>o.id===id);return{id,displayLabel:short(o?.displayLabel),text:short(o?.text)};})}:answer?{value:answer.booleanValue??answer.blanks?.map(short)??short(answer.text)}:undefined;
 return {id:r.id,...(r.firstFailure?{firstFailure:{stage:short(r.firstFailure.stage).slice(0,40),reason:short(r.firstFailure.reason),at:Number.isFinite(r.firstFailure.at)?r.firstFailure.at:null}}:{}),...(r.lastFailure?{lastFailure:{stage:short(r.lastFailure.stage).slice(0,40),reason:short(r.lastFailure.reason),at:Number.isFinite(r.lastFailure.at)?r.lastFailure.at:null}}:{}),...(r.questionId?{questionId:r.questionId}:{}),...(r.taskId?{taskId:r.taskId}:{}),revision:r.revision,status:r.status,number:r.question?.number??r.number??null,type:r.question?.type??r.type,createdAt:r.createdAt,updatedAt:r.updatedAt,lastError:short(r.lastError)||null,course:{name:short(r.course?.name)},review:{reason:short(r.review?.reason),...(typeof r.review?.status==='string'?{status:r.review.status}:{})},legacy:!!r.legacy,detailsExpired:!!r.detailsExpired,...(r.application?{application:{verified:r.application.verified,draftSaved:r.application.draftSaved,canSave:r.application.canSave,modified:r.application.modified}}:{}),...(adopted?{adopted}:{}),sources:{first:source(r.first?.source??r.sources?.first),second:source(r.second?.source??r.sources?.second)},automatic:!!r.automatic,decision:r.decision,...(r.localDraftSaved===true?{localDraftSaved:true,platformSaved:r.platformSaved===true,draftSaved:r.draftSaved===true,origin:r.origin,answerAvailable:r.answer!=null}:{}),...(r.application?.localDraftSaved===true?{localDraftSaved:true}:{})};
}
export function reviewRepository(storage,{now=Date.now,protectedPaper=()=>false,namespace='aaV4review',autoExpiry=true,maxPending=100}={}){
 if(!/^[a-zA-Z0-9]+$/.test(namespace))throw Error('REPOSITORY_NAMESPACE');
 const queues=new Map(),indexKey=p=>namespace+'Index:'+p,legacyKey=p=>namespace+'s:'+p;
 const get=async k=>(await storage.get(k))[k];
 function exclusive(p,fn){const task=(queues.get(p)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(p,task);return task.finally(()=>{if(queues.get(p)===task)queues.delete(p);});}
 const detailKey=(p,id)=>namespace+'Detail:'+p+':'+encodeURIComponent(id)+':'+crypto.randomUUID();
 async function index(p){
  let value=await get(indexKey(p));if(value){if(value.version!==1||!Array.isArray(value.records))throw Error('REVIEW_INDEX_INVALID');return value;}
  const old=await get(legacyKey(p));if(old!==undefined&&!Array.isArray(old))throw Error('REVIEW_QUEUE_INVALID');
  const records=[],details={};for(const r of old||[]){if(!r||typeof r.id!=='string'||r.paperKey!==p)throw Error('REVIEW_MIGRATION_INVALID');if(r.status==='applied'&&!r.question){records.push({...reviewSummary(r),detailsExpired:true,bytes:0});continue;}const key=detailKey(p,r.id);details[key]=r;records.push({...reviewSummary(r),detailKey:key,bytes:bytes(r)});}
  value={version:1,revision:crypto.randomUUID(),records};if(records.length)await storage.set(details);
  try{await storage.set({[indexKey(p)]:value});}catch(error){try{if(Object.keys(details).length)await storage.remove(Object.keys(details));}catch{}throw error;}
  if(old!==undefined)await storage.remove(legacyKey(p));return value;
 }
 async function expire(p,idx,manual=false){
  if(protectedPaper(p)||!autoExpiry)return{index:idx,cleared:0};
  const removed=[];const records=idx.records.map(r=>{if(!['applied','retry_required'].includes(r.status)||!r.detailKey||(!manual&&now()-(r.updatedAt||0)<7*DAY))return r;removed.push(r.detailKey);const{detailKey,bytes,...summary}=r;return{...summary,bytes:0,detailsExpired:true};});
  if(removed.length){idx={version:1,revision:crypto.randomUUID(),records};await storage.set({[indexKey(p)]:idx});await storage.remove(removed);}return{index:idx,cleared:removed.length};
 }
 const counts=idx=>({pending:idx.records.filter(isPending).length,applied:idx.records.filter(r=>r.status==='applied').length});
 const cleanable=idx=>idx.records.filter(r=>['applied','retry_required'].includes(r.status)&&r.detailKey).length;
 const publicRow=({detailKey,bytes,...r})=>r;
 async function readDetail(idx,id){const r=idx.records.find(r=>r.id===id);if(!r)return null;if(!r.detailKey)return{...publicRow(r),detailsExpired:true};const full=await get(r.detailKey);if(!full)throw Error('REVIEW_DETAIL_MISSING：详情读取失败，记录已保留');return full;}
 async function putIn(p,idx,record,guard=()=>{}){
  const prior=idx.records.find(r=>r.id===record.id),key=detailKey(p,record.id),summary={...reviewSummary(record),detailKey:key,bytes:bytes(record)};
  const rows=idx.records.filter(r=>r.id!==record.id);rows.push(summary);
  if(rows.length>MAX_RECORDS||rows.filter(isPending).length>maxPending||rows.reduce((n,r)=>n+(r.bytes||0),0)>MAX_BYTES)throw Error('REVIEW_QUEUE_FULL：复审容量已满，请处理待复审记录或清理历史详情');
  await storage.set({[key]:record});
  try{guard();await storage.set({[indexKey(p)]:{version:1,revision:crypto.randomUUID(),records:rows}});}catch(error){try{await storage.remove(key);}catch{}throw error;}
  if(prior?.detailKey)try{await storage.remove(prior.detailKey);}catch{}return record;
 }
 return{
  list:(p,{status='pending',page=1}={})=>exclusive(p,async()=>{const idx=(await expire(p,await index(p))).index;const rows=idx.records.filter(r=>status==='applied'?r.status==='applied':isPending(r)).reverse().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));page=Number.isInteger(page)&&page>0?page:1;return{records:rows.slice((page-1)*20,page*20).map(publicRow),total:rows.length,page,pageSize:20,cleanable:cleanable(idx),counts:counts(idx)};}),
  stats:p=>exclusive(p,async()=>{const idx=(await expire(p,await index(p))).index;return{cleanable:cleanable(idx),counts:counts(idx),total:idx.records.length,revision:idx.revision||null};}),
  knownIds:p=>exclusive(p,async()=>new Set((await index(p)).records.flatMap(r=>[r.id,...(r.questionId?[r.questionId]:[])]))),
  pendingFor:(p,questionId)=>exclusive(p,async()=>{const idx=await index(p),rows=idx.records.filter(r=>r.status==='pending'&&(r.questionId||r.id)===questionId);if(rows.length>1)throw Error('REVIEW_PENDING_AMBIGUOUS');return rows.length?readDetail(idx,rows[0].id):null;}),
  exportSummaries:p=>exclusive(p,async()=>{const idx=(await expire(p,await index(p))).index;return{records:idx.records.filter(r=>r.status==='applied').map(publicRow),counts:counts(idx)};}),
  detail:(p,id)=>exclusive(p,async()=>readDetail((await expire(p,await index(p))).index,id)),
  putPending:(p,r,{guard=()=>{}}={})=>exclusive(p,async()=>{const idx=(await expire(p,await index(p))).index;guard();const questionId=r.question.id,pending=idx.records.find(row=>isPending(row)&&(row.questionId||row.id)===questionId);const id=pending?.id||(idx.records.some(row=>row.id===questionId)?'review:'+JSON.stringify([questionId,crypto.randomUUID()]):questionId);return putIn(p,idx,{...r,id,questionId},guard);}),
  put:(p,r,{guard=()=>{}}={})=>exclusive(p,async()=>{const idx=(await expire(p,await index(p))).index;guard();return putIn(p,idx,r,guard);}),
  change:(p,id,fn)=>exclusive(p,async()=>{const idx=await index(p),record=await readDetail(idx,id);const next=await fn(record);return next?putIn(p,idx,next):null;}),
  recover:p=>exclusive(p,async()=>{if(protectedPaper(p))return;const idx=await index(p);for(const row of idx.records.filter(r=>r.status==='applying')){const record=await readDetail(idx,row.id);await putIn(p,idx,{...record,status:'pending',lastError:'上次确认填写已中断，请检查当前答案；再次确认会重新校验',updatedAt:now()});idx.records=(await get(indexKey(p))).records;}}),
  retireRequestFailures:p=>exclusive(p,async()=>{if(protectedPaper(p))return{retired:0};let idx=await index(p),retired=0;for(const row of idx.records.filter(r=>isPending(r)&&isFailedReviewRequest(r))){const record=await readDetail(idx,row.id);if(!record||!isPending(record)||!isFailedReviewRequest(record))continue;await putIn(p,idx,{...record,status:'retry_required',retryRequired:true,lastError:record.lastError||record.review.reason,updatedAt:now()});idx=await index(p);retired++;}return{retired};}),
  cleanup:(p,{manual=false}={})=>exclusive(p,async()=>{const result=await expire(p,await index(p),manual);return{cleared:result.cleared,counts:counts(result.index),protected:protectedPaper(p)};})
 };
}
