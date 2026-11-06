import {sameAnswer} from './answers.js';

// A platform owns persistence/navigation. This cursor only accepts explicit,
// verified capabilities; it never finds a DOM button or submits an answer.
export function createQuestionFlow({adapter,settings,signal,phase,progress,beforePageAction,beforeNext,saved}){
 const nav=adapter.pagination,paged=nav?.kind==='single-paged';
 const persistenceTarget=nav?.persistenceTarget==='extension-local'?'extension-local':'platform';
 const canPersist=paged&&nav.persistence==='verified'&&['saveCurrent','verifyPersisted'].every(k=>typeof nav[k]==='function');
 const continuous=canPersist&&settings.mode!=='single'&&nav.navigation==='verified'&&['advance','verifyTransition'].every(k=>typeof nav[k]==='function');
 const guard=()=>signal.throwIfAborted();let outcome,original,view={kind:paged?'single-paged':'page-batch',automaticNext:!!continuous,persistence:canPersist?'verified':'unverified',persistenceTarget,platformPersistence:persistenceTarget==='extension-local'?'unverified':canPersist?'verified':'unverified',current:null,total:null,visible:1,reachedEnd:false};
 async function invoke(method,args=[]){
  guard();const deadline=new AbortController(),stageSignal=AbortSignal.any([signal,deadline.signal]);const ms=Number.isFinite(nav.timeoutMs)?Math.max(50,Math.min(30000,nav.timeoutMs)):10000;let abort;
  const cancelled=new Promise((_,reject)=>{abort=()=>reject(stageSignal.reason);stageSignal.addEventListener('abort',abort,{once:true});});
  const timer=setTimeout(()=>deadline.abort(Error('PAGINATION_TIMEOUT：保存或切题等待超时，未重试')),ms);
  try{const result=await Promise.race([Promise.resolve().then(()=>{stageSignal.throwIfAborted();return nav[method](...args,stageSignal);}),cancelled]);stageSignal.throwIfAborted();return result;}finally{clearTimeout(timer);stageSignal.removeEventListener('abort',abort);}
 }
 const update=(p={},planned)=>{view={...view,...p};progress?.({...view},planned);};
 function validate(p,required=continuous){
  if(!p||!Number.isInteger(p.current)||!Number.isInteger(p.total)||p.current<1||p.total<p.current||p.total>1000||typeof p.paperKey!=='string'||!p.paperKey||p.paperKey.length>2048){if(required||p?.total!=null)throw Error('PAGINATION_PROGRESS：题号、总数或作业身份无法确认');return{current:p?.current??null,total:null,paperKey:p?.paperKey??null};}
  return{current:p.current,total:p.total,paperKey:p.paperKey};
 }
 const read=async()=>{guard();const p=typeof nav.readProgress==='function'?await invoke('readProgress'):null;guard();return validate(p);};
 const sameProgress=async expected=>{const actual=await read();if(actual.paperKey!==expected.paperKey||actual.current!==expected.current||actual.total!==expected.total)throw Error('PAGINATION_CHANGED：保存或翻页期间进度/作业已变化');return actual;};
 function roots(){const found=adapter.findQuestions();if(found.length!==1)throw Error('PAGINATION_CONTAINER：需要唯一当前题目');return found[0];}
 function assertQuestion(q,p){if(p.current!==null&&q.number!=null&&Number(q.number)!==p.current)throw Error('PAGINATION_IDENTITY：正文题号与进度不一致');}
 function current(q){guard();if(!adapter.checkWritable(q)||!sameAnswer(adapter.readCurrentAnswer(q),outcome?.expected,q.type))throw Error('QUESTION_CHANGED：保存或翻页前当前题目/答案已变化');}
 async function authorize(){guard();if(beforePageAction)await beforePageAction(signal);guard();}
 const flow={paged,canPersist,continuous,persistenceTarget,begin(q,old){original=structuredClone(old??null);outcome=null;},record(q,result,extra={}){outcome={q,result,reviewSaved:extra.reviewSaved===true,skipReason:extra.skipReason,expected:result==='completed'?extra.newAnswer:original};},async *questions(){
  guard();if(!paged){const elements=adapter.findQuestions();if(!elements.length)throw Error('NO_QUESTIONS：未识别到完整题目');progress?.(null,elements.length);yield* elements;return;}
  let p=await read(),element=roots();const seen=new Set();update(p,continuous?p.total-p.current+1:1);
  while(true){
   guard();const q=adapter.extractQuestion(element);assertQuestion(q,p);if(seen.has(q.id))throw Error('PAGINATION_REPEAT：重复题目，未继续');seen.add(q.id);outcome=null;yield element;guard();
   const pendingReview=outcome?.result==='review_pending';
   if(pendingReview&&(!continuous||!outcome.reviewSaved)){update({stopReason:'review-pending'});return;}
   if(persistenceTarget==='extension-local'&&['vision','editor'].includes(outcome?.skipReason)){update({stopReason:'unsupported-input'});return;}
   if(!['completed','skipped','review_pending'].includes(outcome?.result))throw Error('PAGINATION_RESULT：当前题未确认处理结果');
   if(outcome.q.id!==q.id)throw Error('PAGINATION_IDENTITY：当前题目已变化');
   if(!canPersist){update({stopReason:'persistence-unverified'});return;}
   const empty=value=>value==null||value===''||Array.isArray(value)&&value.every(v=>v==='');
   // A queue candidate is not an accepted native answer. Only back up existing answers.
   await authorize();await sameProgress(p);current(q);
   if(!pendingReview||!empty(outcome.expected)){
   phase(persistenceTarget==='extension-local'?'save-local':'save');
   if(outcome.result==='completed'||persistenceTarget==='extension-local'){if(await invoke('saveCurrent',[q,structuredClone(outcome.expected)])!==true)throw Error('PAGINATION_SAVE_FAILED：未确认本题独立保存成功');guard();current(q);}
   if(await invoke('verifyPersisted',[q,structuredClone(outcome.expected)])!==true)throw Error('PAGINATION_PERSIST_FAILED：本题持久化结果未确认，未翻页');guard();await sameProgress(p);current(q);if(outcome.result==='completed'||persistenceTarget==='extension-local')saved?.(persistenceTarget,q);
   }
   if(p.total!==null&&p.current===p.total){update({reachedEnd:true,stopReason:'last-question'});return;}
   if(!continuous){update({stopReason:settings.mode==='single'?'single-question':'navigation-unverified'});return;}
   if(beforeNext)await beforeNext(signal);guard();await authorize();current(q);
   const before=await sameProgress(p);
   phase('next');if(await invoke('advance',[q,before])===false)throw Error('PAGINATION_NEXT_FAILED：下一题操作未完成');guard();
   if(await invoke('verifyTransition',[before])!==true)throw Error('PAGINATION_NEXT_FAILED：页面未确认进入下一题');guard();
   const after=await read();if(after.paperKey!==p.paperKey||after.total!==p.total||after.current!==p.current+1)throw Error('PAGINATION_TRANSITION：作业、总数或下一题号不符合预期');
   element=roots();const next=adapter.extractQuestion(element);assertQuestion(next,after);if(seen.has(next.id))throw Error('PAGINATION_REPEAT：下一题仍为旧题或重复题');p=after;update(p);
  }
 }};
 return flow;
}
