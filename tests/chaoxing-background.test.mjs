import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings} from '../src/storage/settings.js';
import {bindCourse,courseKey} from '../src/storage/context.js';
const url='https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=1&classId=2&workId=3&enc=synthetic-signature';
test('Chaoxing background accepts only the exact top-frame route; checkpoint strips signatures',async t=>{
 const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch;let listener,calls=0;
 const values={aaV4settings:bindCourse(normalizeSettings({providers:{deepseek:{apiKey:'synthetic-key'}}}),url,{name:'移动通信'})};
 globalThis.chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel(){},get:async k=>({[k]:structuredClone(values[k])}),set:async data=>Object.assign(values,structuredClone(data))}},tabs:{onRemoved:{addListener(){}}}};
 globalThis.fetch=async()=>{calls++;return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"status":"uncertain"}'}}]})};};
 t.after(()=>{globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;});await import('../src/background.js?chaoxing-background');
 const sender={id:'test',url,tab:{id:7},frameId:0,documentId:'test-document'},send=(m,s=sender)=>new Promise(resolve=>listener(m,s,resolve));
 const settings=await send({action:'PUBLIC_SETTINGS'});assert.equal(settings.ok,true);assert.equal(settings.data.course.name,'移动通信');assert(!JSON.stringify(settings).includes('synthetic-key'));
 await send({action:'STATUS_UPDATE',state:{state:'idle',stage:'wait',results:[]}});assert.equal(values['aaV4checkpoint:7'].url,courseKey(url));assert(!JSON.stringify(values['aaV4checkpoint:7']).includes('synthetic-signature'));
 for(const invalid of [{...sender,frameId:1},{...sender,url:url.replace('mooc1.chaoxing.com','mooc1.chaoxing.com.evil.test')},{...sender,url:url.replace('/dowork','/view')},{...sender,url:url.replace('workId=3','workId=')},{...sender,url:url.replace('https:','http:')}]){
  assert.equal((await send({action:'MODEL_REQUEST',taskId:'task',requestId:'request',question:{id:'q',type:'single',stem:'题干',images:[]}},invalid)).error,'SENDER_NOT_ALLOWED');
 }assert.equal(calls,0);
 const request=await send({action:'MODEL_REQUEST',beginTask:true,includeSource:true,taskId:'task',requestId:'request',question:{id:'q',type:'single',stem:'题干',images:[]}});assert.equal(request.ok,true);assert.equal(calls,1);assert.equal(values.aaV4settings.providers.deepseek.apiKey,'synthetic-key');assert.equal(request.data.source.provider,'deepseek');assert.equal(typeof request.data.taskToken,'string');
});
