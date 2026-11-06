import test from 'node:test';
import assert from 'node:assert/strict';
import {courseKey,bindCourse,courseForUrl} from '../src/storage/context.js';
import {Runner} from '../src/core/runner.js';
const url='https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=232888313&classId=152516793&workId=57034725&enc=synthetic';
test('Chaoxing course identity excludes temporary signatures but separates class and work',()=>{
 const key=courseKey(url);assert.equal(key,'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=232888313&classId=152516793&workId=57034725');
 assert.equal(courseKey(url.replace('synthetic','changed')),key);
 assert.notEqual(courseKey(url.replace('57034725','57034726')),key);
 assert.notEqual(courseKey(url.replace('152516793','152516794')),key);
 for(const invalid of [url.replace('mooc1.chaoxing.com','mooc1.chaoxing.com.evil.test'),url.replace('https:','http:'),url.replace('workId=57034725','workId='),url+'&workId=57034725',url.replace('/dowork','/view')])assert.equal(courseKey(invalid),null);
 const settings=bindCourse({},url,{name:'移动通信',requirements:'根据课程教材作答'});
 assert.equal(courseForUrl(settings,url.replace('synthetic','changed')).name,'移动通信');
 assert.equal(courseForUrl(settings,url.replace('57034725','57034726')).name,'');
});
function adapter(saveDraft){const q={id:'cx1',type:'single',stem:'样本',options:[{id:'C',text:'前置码'},{id:'A',text:'纠错码'}],images:[],blankCount:0};let value=null;return{findQuestions:()=>[q],extractQuestion:q=>q,readCurrentAnswer:()=>value,checkWritable:()=>true,writeAnswer:async()=>{value=['C'];},verifyAnswer:async()=>true,saveDraft};}
const answer={questionId:'cx1',type:'single',optionIds:['C']};
test('optional platform draft save completes before done, failure remains at save stage',async()=>{
 const stages=[];let saves=0;const runner=new Runner();await runner.run({adapter:adapter(async()=>{saves++;assert.equal(runner.snapshot().stage,'save');}),settings:{mode:'single'},request:async()=>answer,onUpdate:s=>stages.push(s.stage)});
 assert.equal(saves,1);assert.equal(runner.snapshot().state,'done');assert.equal(runner.snapshot().draftSaved,true);assert(stages.indexOf('save')<stages.indexOf('done'));
 const failed=new Runner();await failed.run({adapter:adapter(async()=>{throw Error('DRAFT_SAVE_FAILED');}),settings:{mode:'single'},request:async()=>answer});
 assert.equal(failed.snapshot().state,'failed');assert.equal(failed.snapshot().stage,'save');assert.equal(failed.snapshot().completed,1);assert.match(failed.snapshot().error,/DRAFT_SAVE_FAILED/);
});
test('stop during draft save rejects late success and no save runs for skipped work',{timeout:2000},async()=>{
 let release,started;const ready=new Promise(r=>started=r),runner=new Runner();
 const pending=runner.run({adapter:adapter(()=>{started();return new Promise(r=>release=r);}),settings:{mode:'single'},request:async()=>answer});
 await ready;runner.stop();release();await pending;assert.equal(runner.snapshot().state,'stopped');assert.notEqual(runner.snapshot().draftSaved,true);
 let saves=0;await new Runner().run({adapter:adapter(async()=>saves++),settings:{filter:'fill'},request:()=>{throw Error('unexpected model request');}});assert.equal(saves,0);
});
