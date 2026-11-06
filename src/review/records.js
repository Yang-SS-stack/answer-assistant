import {validateAnswer,expectedValue,sameAnswer} from '../core/answers.js';
import {sanitizeModelSource} from '../core/model-result.js';

const QUESTION_BYTES=100000,RECORD_BYTES=1250000,IMAGE_BYTES=1048576;
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
// Compatibility with the operational failures written as pending by older
// versions. Do not classify a model's valid "uncertain" response as a request error.
export function isFailedReviewRequest(r){return !r?.second&&r?.review?.status==='uncertain'&&typeof r.review.reason==='string'&&(r.review.reason.startsWith('复审请求或结果失败：')||r.review.reason==='加强复核模型图片能力尚未确认，复核未完成');}
export function hasReviewDecision(r){try{
 if(!r?.question||!['uncertain','revise'].includes(r.review?.status)||isFailedReviewRequest(r))return false;
 if(r.first?.status==='uncertain')return r.first.answer==null&&r.second==null;
 if(r.first?.status!=='answered')return false;validateAnswer(r.first.answer,r.question);
 if(r.review.status==='revise')return true;
 if(r.second?.status==='uncertain')return r.second.answer==null;
 if(r.second?.status!=='answered')return false;validateAnswer(r.second.answer,r.question);
 return !sameAnswer(expectedValue(r.first.answer),expectedValue(r.second.answer),r.question.type);
 }catch{return false;}}
function bounded(value,max,label='REVIEW_SIZE') {
 if(typeof value!=='string'||value.length>max)throw Error(label);
 return value;
}
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const list=(value,max=500)=>Array.isArray(value)?value.slice(0,12).filter(v=>typeof v==='string').map(v=>v.slice(0,max)):[];
function size(value,max){if(bytes(value)>max)throw Error('REVIEW_SIZE：复审记录过大');return value;}
export function snapshotQuestion(q) {
 if(!q||!['single','multiple','judge','fill','subjective'].includes(q.type))throw Error('REVIEW_QUESTION：缺少可用题目快照');
 if(!Array.isArray(q.options)||q.options.length>100||!Array.isArray(q.images??[])||(q.images??[]).length>100)throw Error('REVIEW_SIZE：题目结构过大');
 const number=q.number??null;
 if(number!==null&&typeof number!=='string'&&!(typeof number==='number'&&Number.isFinite(number)))throw Error('REVIEW_QUESTION');
 if(typeof number==='string')bounded(number,100);
 const blankCount=q.blankCount??0;
 if(!Number.isInteger(blankCount)||blankCount<0||blankCount>100)throw Error('REVIEW_QUESTION');
 return size({id:bounded(q.id,256),number,type:q.type,stem:bounded(q.stem,100000),options:q.options.map(o=>({id:bounded(o.id,256),text:bounded(o.text,30000),...(o.displayLabel!==undefined?{displayLabel:bounded(o.displayLabel,120)}:{})})),blankCount,images:(q.images??[]).map(im=>({position:bounded(im.position,256)}))},QUESTION_BYTES);
}
function output(raw,q){
 if(raw==null)return null;
 if(!['answered','uncertain'].includes(raw.status))throw Error('REVIEW_RESULT：模型结果状态无效');
 const answer=raw.status==='answered'?validateAnswer(raw.answer,q):null;
 if(raw.status==='uncertain'&&raw.answer!=null)throw Error('REVIEW_RESULT：不确定结果不能含确定答案');
 return {status:raw.status,answer,summary:text(raw.summary,1000),observations:list(raw.observations),limitations:list(raw.limitations),...(raw.source!==undefined?{source:sanitizeModelSource(raw.source)}:{})};
}
function oldValue(value){
 if(value==null)return null;
 if(typeof value==='boolean')return value;
 if(typeof value==='string')return bounded(value,30000);
 if(Array.isArray(value)&&value.length<=100&&value.every(v=>typeof v==='string'))return value.map(v=>bounded(v,30000));
 throw Error('REVIEW_ANSWER：原答案结构无效');
}
export function createReviewRecord(raw,{paperKey,tabId,images=[],now=Date.now()}={}) {
 bounded(paperKey,2048,'REVIEW_PAPER');
 if(!paperKey||!Number.isInteger(tabId)||tabId<0||!Number.isFinite(now))throw Error('REVIEW_BINDING');
 const question=snapshotQuestion(raw?.question),course=raw.course??{};
 const r={id:question.id,paperKey,tabId,question,oldAnswer:oldValue(raw.oldAnswer),first:output(raw.first,question),second:output(raw.second,question),review:raw.review?{status:text(raw.review.status,40),reason:text(raw.review.reason,2000),issues:list(raw.review.issues)}:null,course:{name:bounded(course.name??'',120),language:bounded(course.language??'',80),requirements:bounded(course.requirements??'',8192)},status:'pending',createdAt:now,updatedAt:now,images:[],imagesUnavailable:false};
 const positions=new Set(question.images.map(im=>im.position));
 let budget=0;
 if(!Array.isArray(images)||images.length>100)r.imagesUnavailable=true;
 else for(const image of images){
  if(typeof image?.dataUrl!=='string'||!positions.has(image.position)||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)){r.imagesUnavailable=true;continue;}
  budget+=bytes(image.dataUrl);
  if(budget>IMAGE_BYTES){r.images=[];r.imagesUnavailable=true;break;}
  r.images.push({position:image.position,dataUrl:image.dataUrl});
 }
 if(r.images.length<question.images.length)r.imagesUnavailable=true;
 return size(r,RECORD_BYTES);
}
export function mergeReviewRecords(existing,record) {
 if(!Array.isArray(existing))throw Error('REVIEW_QUEUE：队列结构无效');
 const result=existing.map(item=>structuredClone(item));
 const index=result.findIndex(item=>item.paperKey===record.paperKey&&item.question?.id===record.question?.id);
 if(index>=0)result[index]=structuredClone(record);
 else {if(result.length>=100)throw Error('REVIEW_QUEUE_FULL：复审队列已满，请先处理已有记录');result.push(structuredClone(record));}
 return result;
}
