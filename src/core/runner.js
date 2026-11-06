import {expectedValue,sameAnswer} from './answers.js';
import {parseModelResult,modelFailureDetails} from './model-result.js';
import {snapshotQuestion,hasReviewDecision} from '../review/records.js';
import {languageIssue} from './review.js';
import {createQuestionFlow} from './question-flow.js';
export function wait(ms,signal) {return new Promise((resolve,reject)=>{
 if(signal?.aborted)return reject(signal.reason);const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
 const timer=setTimeout(done,ms);function abort(){clearTimeout(timer);reject(signal.reason);}signal?.addEventListener('abort',abort,{once:true});
});}
export class Runner {
 constructor(){this.state={state:'idle',stage:'wait',completed:0,skipped:0,failed:0,results:[],elapsedMs:0};}
 snapshot(){return structuredClone(this.state);}
 stop(){this.controller?.abort(new Error('STOPPED'));if(this.state.state==='running'){this.state.state='stopped';this.state.stage='wait';this.emit();}}
 emit(){this.state.elapsedMs=this.started?Date.now()-this.started:0;this.onUpdate?.(this.snapshot());}
 async run({adapter,request,settings={},onUpdate,beforeWrite,beforePageAction,onReview,findReview,prepareInput}){
  if(this.busy)throw Error('TASK_STOPPING：上一任务仍在结束，请稍候');this.busy=true;
  const controller=new AbortController();this.controller=controller;const signal=controller.signal;
  const guard=()=>{if(signal.aborted)throw signal.reason;};this.onUpdate=onUpdate;this.started=Date.now();
  this.state={state:'running',stage:'scan',completed:0,skipped:0,failed:0,reviewPending:0,results:[],elapsedMs:0,mode:settings.mode||'auto',executionScope:adapter.executionScope||'page',canSave:typeof adapter.saveDraft==='function'};this.emit();
  let current,candidate=null,stage='scan',first=null,second=null,review=null,flow;
  const phase=s=>{guard();stage=s;this.state.stage=s;this.emit();guard();};
  const log=(q,result,reason,extra={})=>{flow?.record(q,result,extra);this.state.results.push({id:q.id,type:q.type,result,stage,reason,...extra});this.emit();};
  const preserve=async(q,old)=>{
   guard();let receipt;if(onReview)receipt=await onReview({question:snapshotQuestion(q),oldAnswer:structuredClone(old??null),first:structuredClone(first),second:structuredClone(second),review:structuredClone(review),course:{name:settings.course?.name||'',language:settings.course?.language||'',requirements:settings.course?.requirements||''}},signal);guard();return receipt?.saved===true&&receipt?.verified===true&&typeof receipt.id==='string'&&!!receipt.id&&typeof receipt.revision==='string'&&!!receipt.revision;
  };
  try {
   const pace=async()=>{phase('wait');const remaining=this.state.total-this.state.completed-this.state.skipped;const delay=settings.speed==='timed'?Math.max(0,Math.min(15000,((settings.targetMinutes||5)*60000-(Date.now()-this.started))/Math.max(1,remaining))):settings.speed==='fast'?250:900;await wait(delay,signal);};
   flow=createQuestionFlow({adapter,settings,signal,phase,beforePageAction:beforePageAction||beforeWrite,beforeNext:pace,saved:(target,q)=>{if(target==='extension-local'){const row=this.state.results.findLast(r=>r.id===q.id);if(row)row.localDraftSaved=true;this.state.localDraftSaved=true;this.state.localDraftCount=this.state.results.filter(r=>r.localDraftSaved===true).length;}else this.state.draftSaved=true;this.emit();},progress:(pageFlow,total)=>{if(pageFlow)this.state.pageFlow=pageFlow;if(total!==undefined)this.state.total=total;this.emit();}});
   if(flow.paged){this.state.executionScope=flow.continuous?'paginated':'current-question';this.state.persistenceTarget=flow.persistenceTarget;this.state.canSave=flow.canPersist&&flow.persistenceTarget!=='extension-local';if(flow.persistenceTarget==='extension-local'){this.state.localDraftSaved=false;this.state.localDraftCount=0;this.state.draftSaved=false;}}
   for await(const element of flow.questions()){
    guard();phase('extract');candidate=null;first=null;second=null;review=null;current={id:'unknown',type:'unknown'};const q=adapter.extractQuestion(element);current=q;this.state.questionId=q.id;
    if(q.type==='unknown')throw Error('UNKNOWN_TYPE：题型无法确认');
    const old=adapter.readCurrentAnswer(q);const hasOld=old!==null&&old!==undefined&&old!==''&&(!Array.isArray(old)||old.some(v=>v!==''));
    flow.begin(q,old);
    if(settings.filter&&settings.filter!=='all'&&settings.filter!==q.type){this.state.skipped++;log(q,'skipped','题型不在处理范围',{skipReason:'filter'});continue;}
    if(findReview&&settings.existing!=='replace'){
     const saved=await findReview(q,old,signal);guard();
     if(saved?.saved===true&&saved.verified===true&&saved.id&&saved.revision&&hasReviewDecision({...saved,question:q})){first=saved.first;second=saved.second;review=saved.review;this.state.reviewPending++;log(q,'review_pending','已有有效待复审记录，未重复请求模型',{first,second,review,reviewSaved:true,reusedReview:true});if(settings.mode==='single'&&!flow.paged)break;continue;}
    }
    if(hasOld&&settings.existing!=='replace'){this.state.skipped++;log(q,'skipped','已有答案，按设置跳过',{skipReason:'existing'});continue;}
    if(q.images?.length&&!settings.capabilities?.vision){this.state.skipped++;log(q,'skipped','模型图片能力尚未确认',{images:'skipped',skipReason:'vision'});continue;}
    if(q.visualInput?.kind==='rendered-question'&&settings.reviewMode==='enhanced'&&settings.reviewer?.capabilities?.vision!==true){this.state.skipped++;log(q,'skipped','整题截图需要答题与复核模型都支持图片，当前复核模型能力未确认',{images:'skipped',skipReason:'vision'});continue;}
    if(q.type==='subjective'&&(!adapter.supportsSubjective||adapter.canWriteSubjective&&!adapter.canWriteSubjective(q))){this.state.skipped++;log(q,'skipped','主观题编辑器未就绪或尚未适配',{skipReason:'editor'});continue;}
    if(q.visualInput?.kind==='rendered-question'){phase('capture');if(typeof prepareInput!=='function')throw Error('CAPTURE_REQUIRED：当前题需要完整截图输入');await prepareInput(q,signal);guard();}
    phase('request');const raw=await request(q,signal);guard();phase('parse');first=parseModelResult(raw,q);const answer=first.answer;
    if(first.status==='uncertain'){review={status:'uncertain',reason:'模型无法确定答案，未填写',issues:['首次作答不确定']};const reviewSaved=await preserve(q,old);this.state.reviewPending++;log(q,'review_pending',review.reason,{draft:null,first,second,review,reviewSaved});if(settings.mode==='single'&&!flow.paged)break;continue;}
    candidate=answer;const issue=languageIssue(q,answer,settings.course);
    if(issue)review={status:'revise',reason:issue,issues:[issue]};
    else if(settings.reviewMode==='enhanced'){
     phase('review');
     try{
     if(q.images?.length&&settings.reviewer?.capabilities?.vision!==true){
      throw Error('REVIEW_VISION_REQUIRED：加强复核模型图片能力尚未确认，当前题未填写，请确认配置后重新开始');
     }else{
      const peer=await request(q,signal,{purpose:'independent'});guard();second=parseModelResult(peer,q);
      const agrees=second.answer&&sameAnswer(expectedValue(answer),expectedValue(second.answer),q.type);
      review={status:agrees?'pass':'uncertain',reason:second.status==='uncertain'?'独立复答未提供确定答案':!agrees?'两次独立作答的答案不同':'两次独立作答一致（不等于标准答案已验证）',issues:second.status==='uncertain'?['复答未给出确定答案，请人工核对']:!agrees?['两份候选结论不同，请分别核对']:[]};
     }
     }catch(error){guard();throw error;}
    }
    if(review&&review.status!=='pass'){const reviewSaved=await preserve(q,old);this.state.reviewPending++;log(q,'review_pending',review.reason,{draft:expectedValue(answer),first,second,review,reviewSaved});if(settings.mode==='single'&&!flow.paged)break;continue;}
    phase('validate');if(beforeWrite)await beforeWrite(signal);guard();if(!adapter.checkWritable(q))throw Error('QUESTION_CHANGED：题目已变化或不可填写');
    const now=adapter.readCurrentAnswer(q);if(!sameAnswer(old,now,q.type))throw Error('ANSWER_CHANGED：请求期间原答案被修改');
    if(sameAnswer(now,expectedValue(answer),q.type)){this.state.skipped++;log(q,'skipped','已有答案与目标一致',{first,second,review:review||{status:'not_requested'}});continue;}
    if(flow.paged)this.state.draftSaved=false;phase('fill');await adapter.writeAnswer(q,answer,signal);guard();phase('verify');
    if(!await adapter.verifyAnswer(q,answer,signal))throw Error('VERIFY_FAILED：页面未确认接受目标答案');guard();
    this.state.completed++;log(q,'completed','页面状态验证通过',{question:snapshotQuestion(q),course:{name:settings.course?.name||'',language:settings.course?.language||'',requirements:settings.course?.requirements||''},modified:hasOld,oldAnswer:hasOld?old:undefined,newAnswer:expectedValue(answer),first,second,review:review||{status:'not_requested'},images:q.images?.length?'verified':'none'});
    if(settings.mode==='single'&&!flow.paged)break;
    if(!flow.paged)await pace();
   }
   guard();if(!flow.paged&&this.state.completed&&typeof adapter.saveDraft==='function'){
    current={id:'page',type:'unknown'};candidate=null;phase('save');await adapter.saveDraft(signal);guard();this.state.draftSaved=true;
   }
   guard();this.state.state='done';this.state.stage='done';
  } catch(error){
   if(signal.aborted){this.state.state='stopped';this.state.stage='wait';}
   else {controller.abort(error);this.state.state='failed';this.state.failed++;this.state.error=error.message;this.state.stage=stage;const modelFailure=modelFailureDetails(error);if(modelFailure)this.state.modelFailure=modelFailure;log(current||{id:'page',type:'unknown'},'failed',error.message,{...(typeof current?.number==='string'||typeof current?.number==='number'?{number:current.number}:{}),...(modelFailure?{modelFailure}:{}),...(candidate?{draft:expectedValue(candidate)}:{}),first,second,review});}
  } finally {this.busy=false;this.emit();}
  return this.snapshot();
 }
}
