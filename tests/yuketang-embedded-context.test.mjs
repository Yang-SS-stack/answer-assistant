import test from 'node:test';
import assert from 'node:assert/strict';
import {courseKey,bindCourse,courseForUrl} from '../src/storage/context.js';
import {normalizeSettings} from '../src/storage/settings.js';
test('embedded course identity binds top exercise and frame to the same exact course/work pair',()=>{
 const top='https://www.yuketang.cn/ai-workspace/lms-graph/31667974/exercise/92302616';
 const frame='https://www.yuketang.cn/v2/web/iframe-exercise/31667974/92302616';
 assert.equal(courseKey(top+'?token=discard'),top);assert.equal(courseKey(frame),top);
 assert.notEqual(courseKey(top.replace('92302616','92302617')),courseKey(top));
 for(const url of [top+'/evil',top.replace('https:','http:'),top.replace('www.yuketang.cn','www.yuketang.cn.evil'),top.replace('31667974','bad'),top.replace('/exercise/','/quiz/')])assert.equal(courseKey(url),null);
 const old='https://examination.xuetangx.com/exam/original';const settings=normalizeSettings({courses:{旧课程:{name:'旧课程'}},courseBindings:{[old]:'旧课程'}});
 const bound=bindCourse(settings,frame,{name:'新课程'});assert.equal(courseForUrl(bound,top).name,'新课程');assert.equal(courseForUrl(normalizeSettings(bound),old).name,'旧课程');
});
