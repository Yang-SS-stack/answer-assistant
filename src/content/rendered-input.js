import {sameAnswer} from '../core/answers.js';

// A pending capture is a short-lived capability. Only the background can ask
// for its geometry, and both models consume the same cropped image afterward.
export function createRenderedInput({send,task,course,acceptToken,isCurrent,readAnswer,prepareGeometry}){
 const active=new Map(),cache=new Map();
 function guard(binding){
  binding.signal.throwIfAborted();
  if(!isCurrent(binding.q))throw Error('QUESTION_CHANGED：截图期间原题已变化');
  if(!sameAnswer(readAnswer(binding.q),binding.original,binding.q.type))throw Error('ANSWER_CHANGED：截图期间原答案已变化');
  if(task()?.id!==binding.taskId)throw Error('TASK_CHANGED：截图任务已变化');
 }
 function cached(q,signal){signal.throwIfAborted();const binding=cache.get(q.id);if(!binding||binding.q!==q)throw Error('CAPTURE_REQUIRED：缺少当前题的完整截图');guard(binding);return binding;}
 return{
  async prepare(q,signal){
   if(cache.has(q.id)){cached(q,signal);return;}
   signal.throwIfAborted();const started=task();if(!started?.id)throw Error('TASK_REQUIRED');
   const captureId=crypto.randomUUID(),binding={q,signal,taskId:started.id,original:structuredClone(readAnswer(q))};
   guard(binding);active.set(captureId,binding);
   try{
    const reply=await send({action:'RENDERED_CAPTURE',questionId:q.id,taskId:started.id,requestId:captureId,course:course(),...(started.token?{taskToken:started.token}:{beginTask:true})});
    guard(binding);if(active.get(captureId)!==binding||task()?.token!==started.token)throw Error('CAPTURE_CONTEXT_CHANGED');
    const im=reply?.image;
    if(typeof reply?.taskToken!=='string'||!reply.taskToken||started.token&&reply.taskToken!==started.token||im?.position!=='question-rendered'||typeof im.dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(im.dataUrl)||im.dataUrl.length>5000000||![im.width,im.height].every(n=>Number.isInteger(n)&&n>0)||im.width*im.height>16000000)throw Error('CAPTURE_FAILED：截图返回格式或尺寸无效');
    acceptToken(reply.taskToken);binding.images=[{position:im.position,dataUrl:im.dataUrl}];cache.set(q.id,binding);
   }finally{active.delete(captureId);}
  },
  async geometry(message){
   const binding=active.get(message.captureId);
   if(!binding||message.taskId!==binding.taskId||message.questionId!==binding.q.id)throw Error('CAPTURE_CONTEXT_INVALID：没有对应的截图任务');
   guard(binding);const geometry=await prepareGeometry(binding.q,{signal:binding.signal,isCurrent:()=>isCurrent(binding.q)&&sameAnswer(readAnswer(binding.q),binding.original,binding.q.type)});
   guard(binding);if(active.get(message.captureId)!==binding)throw Error('CAPTURE_CONTEXT_CHANGED');return geometry;
  },
  images(q,signal){return structuredClone(cached(q,signal).images);},
  release(questionId){cache.delete(questionId);for(const [id,b]of active)if(b.q.id===questionId)active.delete(id);},
  clear(){cache.clear();active.clear();}
 };
}
