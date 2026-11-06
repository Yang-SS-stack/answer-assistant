import {validateDraftAnswer,draftAnswerState} from '../drafts/native-answer.js';
import {validateAnswer,expectedValue,sameAnswer} from '../core/answers.js';
import {snapshotQuestion} from './records.js';

// This path can fill and save a draft only. It deliberately has no submit operation.
export async function applyReviewedAnswer({record,answer,adapter,course,signal=new AbortController().signal,onPhase,beforeWrite,beforeComplete,localRestore=false}) {
 const guard=()=>{if(signal.aborted)throw signal.reason??Error('STOPPED');};
 const phase=name=>{guard();onPhase?.(name);guard();};
 const courseSnapshot=value=>JSON.stringify({name:value?.name??'',language:value?.language??'',requirements:value?.requirements??''});
 const checkCourse=()=>{const value=typeof course==='function'?course():course;if(courseSnapshot(value)!==courseSnapshot(record.course))throw Error('COURSE_CHANGED：课程背景已变化');};
 phase('validate');
 if(!record?.question||record.status!=='pending')throw Error('REVIEW_RECORD：缺少待复审快照');
 const snapshot=snapshotQuestion(record.question),identity=JSON.stringify(snapshot),valid=localRestore===true?validateDraftAnswer({...record,answer},snapshot):validateAnswer(answer,snapshot),wanted=expectedValue(valid);
 function current(expected,verify=false,readAnswer=true,allowMatching=false){
  guard();checkCourse();
  const matches=adapter.findQuestions().map(element=>adapter.extractQuestion(element)).filter(q=>q.id===snapshot.id);
  if(matches.length!==1||JSON.stringify(snapshotQuestion(matches[0]))!==identity||!adapter.checkWritable(matches[0]))throw Error('QUESTION_CHANGED：题目已变化或不可填写');
  const q=matches[0];
  if(readAnswer){const value=adapter.readCurrentAnswer(q);if(!sameAnswer(value,expected,q.type)&&!(allowMatching&&sameAnswer(value,wanted,q.type)))throw Error(verify?'VERIFY_FAILED：页面答案与目标不一致':'ANSWER_CHANGED：原答案被修改');}
  guard();return q;
 }
 // A previous confirmation may have written the complete target before its
 // bookkeeping failed, or the user may have filled that same answer manually.
 // Reconfirm it read-only; never use this path to overwrite a third value.
 let q=current(record.oldAnswer,false,true,true);
 const unchanged=sameAnswer(adapter.readCurrentAnswer(q),wanted,q.type),alreadyMatching=unchanged&&!sameAnswer(record.oldAnswer,wanted,q.type),canSave=typeof adapter.saveDraft==='function';
 if(!unchanged){
 phase('fill');
 if(beforeWrite){await beforeWrite(signal);guard();}
 q=current(record.oldAnswer);
 await adapter.writeAnswer(q,valid,signal);guard();
 current(undefined,false,false);
 }
 phase('verify');
 if(!await adapter.verifyAnswer(q,valid,signal)){guard();throw Error('VERIFY_FAILED：页面未确认接受目标答案');}
 guard();q=current(wanted,true);
 let draftSaved=false;
 if(canSave){
  phase('save');
  if(beforeWrite){await beforeWrite(signal);guard();}
  current(wanted,true);
  await adapter.saveDraft(signal);guard();current(wanted,true);draftSaved=true;
 }
 if(beforeComplete){await beforeComplete(signal);guard();if(!adapter.checkWritable(q))throw Error('QUESTION_CHANGED：最终核对期间题目已变化');current(wanted,true);}
 const old=record.oldAnswer,modified=!unchanged&&old!==null&&old!==undefined&&old!==''&&(!Array.isArray(old)||old.some(v=>v!==''));
 return{verified:true,draftSaved,canSave,newAnswer:wanted,modified,...(alreadyMatching?{alreadyMatching:true}:{}),...(localRestore?{partialRestore:draftAnswerState(valid)==='partial'}:{})};
}
