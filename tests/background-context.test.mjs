import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings} from '../src/storage/settings.js';
import {bindCourse} from '../src/storage/context.js';

const url='https://examination.xuetangx.com/exam/context-test';
const course={name:'课程',language:'Python',requirements:'原约束'};
const pageSender={id:'synthetic',url,tab:{id:1},frameId:0,documentId:'synthetic-document'};
const uiSender={id:'synthetic',url:'chrome-extension://synthetic/src/ui/popup.html'};
test('background refuses a missing course before starting any fetch',async t=>{const f=await fixture(t);f.replace({...f.stored,courses:{},courseBindings:{}});const result=await f.send({action:'MODEL_REQUEST',taskId:'task',requestId:'request',question:{id:'q',type:'single',stem:'test',images:[]}});assert.equal(result.ok,false);assert.match(result.error,/COURSE_REQUIRED/);assert.equal(f.signal,undefined);});
let instance=0;
async function fixture(t){
 const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch;let listener,release,started,taskToken,bootstrap=false;
 let stored=bindCourse(normalizeSettings({reviewMode:'enhanced',providers:{deepseek:{apiKey:'synthetic-not-a-key'},qwen:{apiKey:'synthetic-review-not-a-key'}}}),url,course);
 const ready=new Promise(resolve=>started=resolve);let requestSignal;
 globalThis.chrome={runtime:{id:'synthetic',getURL:path=>'chrome-extension://synthetic/'+path,onMessage:{addListener(fn){listener=fn;}}},storage:{local:{setAccessLevel(){},get:async()=>({aaV4settings:structuredClone(stored)}),set:async data=>{stored=structuredClone(data.aaV4settings);}}},tabs:{onRemoved:{addListener(){}}}};
 globalThis.fetch=async(endpoint,options)=>{if(!bootstrap){requestSignal=options.signal;started();await new Promise(resolve=>release=resolve);}return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'synthetic-response'}}]})};};
 await import('../src/background.js?context-test='+(++instance));
 t.after(()=>{release?.();globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;});
 const raw=(message,sender=pageSender)=>new Promise(resolve=>listener(message,sender,resolve));
 const send=async(message,sender=pageSender)=>{
  if(message.action!=='MODEL_REQUEST')return raw(message,sender);
  if(!taskToken&&message.purpose&&message.purpose!=='answer'){
   bootstrap=true;try{const first=await raw({...message,purpose:'answer',beginTask:true,includeSource:true},sender);taskToken=first.data?.taskToken;}finally{bootstrap=false;}
  }
  const result=await raw({...message,includeSource:true,...(taskToken?{taskToken}:{beginTask:true})},sender);if(result.ok)taskToken=result.data.taskToken;
  return result.ok?{ok:true,data:result.data.content}:result;
 };
 return{send,ready,release:()=>release(),get signal(){return requestSignal;},get stored(){return structuredClone(stored);},replace(value){stored=structuredClone(value);}};
}
for(const purpose of ['answer','independent','review'])test('saving changed bound context aborts pending '+purpose+' and rejects a late response',async t=>{
 const f=await fixture(t);const pending=f.send({action:'MODEL_REQUEST',taskId:'task',requestId:'request',purpose,course,question:{id:'q',type:'subjective',stem:'测试题',images:[]}});
 await f.ready;
 const changed=bindCourse(f.stored,url,{...course,language:'Java'});
 const saved=await f.send({action:'SETTINGS_SAVE',settings:changed},uiSender);
 f.release();const result=await pending;
 assert.equal(saved.ok,true);assert.equal(f.signal.aborted,true);assert.equal(result.ok,false);assert.match(result.error,/COURSE_CHANGED/);
});
test('response rechecks bound context changed outside the save handler',async t=>{
 const f=await fixture(t);const pending=f.send({action:'MODEL_REQUEST',taskId:'task',requestId:'request',course,question:{id:'q',type:'subjective',stem:'测试题',images:[]}});
 await f.ready;f.replace(bindCourse(f.stored,url,{...course,requirements:'已变更'}));f.release();
 const result=await pending;assert.equal(result.ok,false);assert.match(result.error,/COURSE_CHANGED/);
});
test('saving a different exam course preserves the current pending request',async t=>{
 const f=await fixture(t);const pending=f.send({action:'MODEL_REQUEST',taskId:'task',requestId:'request',course,question:{id:'q',type:'subjective',stem:'测试题',images:[]}});
 await f.ready;const changed=bindCourse(f.stored,'https://examination.xuetangx.com/exam/other',{name:'另一个课程',language:'英语'});
 await f.send({action:'SETTINGS_SAVE',settings:changed},uiSender);assert.equal(f.signal.aborted,false);f.release();
 assert.deepEqual(await pending,{ok:true,data:'synthetic-response'});
});
