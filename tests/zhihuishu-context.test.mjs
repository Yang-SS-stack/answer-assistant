import test from 'node:test';
import assert from 'node:assert/strict';
import {courseKey,bindCourse,courseForUrl} from '../src/storage/context.js';
const base='https://hike-teaching-center.polymas.com/exam-hub/courseABC_123/stu/answer-homework';
const query='homeworkId=hw_abc-123&paperId=10001&examId=20001';
const url=base+'?'+query;
test('Zhihuishu homework identity binds the exact course and all paper identifiers',()=>{
 assert.equal(courseKey(url),url);
 assert.equal(courseKey(base+'?examId=20001&paperId=10001&homeworkId=hw_abc-123&view=1#question'),url);
 const s=bindCourse({},url,{name:'市场营销学'});assert.equal(courseForUrl(s,url).name,'市场营销学');
 for(const other of [url.replace('courseABC_123','courseDEF'),url.replace('hw_abc-123','hw_other'),url.replace('10001','10002'),url.replace('20001','20002')])assert.equal(courseForUrl(s,other).name,'');
});
test('Zhihuishu missing, duplicate, malformed and lookalike identities are rejected',()=>{
 for(const bad of [base,base+'?homeworkId=x&paperId=1',url+'&examId=2',url+'&paperId=3',url+'&homeworkId=other',url.replace('paperId=10001','paperId=1.5'),url.replace('hw_abc-123','bad%2Fid'),url.replace('courseABC_123','course%2Fbad'),url.replace('https:','http:'),url.replace('.com/','.com.evil.test/'),url.replace('/answer-homework','/answer-exam'),url.replace('/stu/','/tch/'),url.replace('/answer-homework','/answer-homework/extra'),url.replace('https://','https://user:password@')])assert.equal(courseKey(bad),null,bad);
});
