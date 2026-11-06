import test from 'node:test';import assert from 'node:assert/strict';
const q={id:'q1',type:'single',options:[{id:'A'},{id:'B'}]};
const answer={questionId:q.id,type:q.type,optionIds:['A']};
const envelope={protocol:1,questionId:q.id,type:q.type,answer,summary:'选项与题干要求对应',observations:['原题提供两项'],limitations:[]};
async function parse(raw,question=q){const m=await import('../src/core/model-result.js');return m.parseModelResult(raw,question);}
test('strict old answer and protocol envelope retain identical strict answers',async()=>{
 assert.deepEqual((await parse(JSON.stringify(envelope))).answer,answer);
 const old=await parse(answer);assert.equal(old.status,'answered');assert.deepEqual(old.answer,answer);assert.match(old.limitations.join(' '),/摘要/);
});
test('uncertain identity is checked before accepting legacy or envelope uncertainty',async()=>{
 assert.equal((await parse({...envelope,answer:null})).status,'uncertain');
 assert.match((await parse({status:'uncertain'})).limitations.join(' '),/摘要/);
 for(const raw of [{status:'uncertain',questionId:'wrong',type:q.type},{status:'uncertain',questionId:q.id},{...envelope,questionId:'wrong',answer:null},{...envelope,type:'judge',answer:null}])await assert.rejects(parse(raw),/IDENTITY/);
});
test('malformed protocol, identity and strict answers fail closed',async()=>{
 for(const raw of [{...envelope,protocol:2},{...envelope,extra:true},{...envelope,answer:{...answer,summary:'bad'}},{...envelope,answer:{...answer,questionId:'wrong'}},{...envelope,answer:{...answer,optionIds:['unknown']}},{...envelope,answer:undefined},{status:'uncertain',extra:true},null,'not json'])await assert.rejects(parse(raw));
});

test('auxiliary metadata variations never gate a separately validated answer and remain bounded text',async()=>{
 for(const value of ['公开说明',null,undefined,{},42,[null,'保留文本',{reasoning_content:'private-content'}]]){
  const raw={...envelope,summary:value,observations:value,limitations:value};if(value===undefined)for(const key of ['summary','observations','limitations'])delete raw[key];
  const r=await parse(raw);assert.deepEqual(r.answer,answer);assert.equal(r.status,'answered');assert.equal(typeof r.summary,'string');assert(r.observations.every(x=>typeof x==='string'));assert(r.limitations.every(x=>typeof x==='string'));assert(!JSON.stringify(r).includes('private-content'));assert(r.limitations.length<=12);
  assert.equal((await parse({...raw,answer:null})).status,'uncertain');
  await assert.rejects(parse({...raw,answer:{...answer,optionIds:['unknown']}}),/ANSWER/);
 }
 const r=await parse({...envelope,observations:'单项说明',limitations:{bad:'never stringify'}});assert.deepEqual(r.observations,['单项说明']);assert.match(r.limitations.join(' '),/说明字段|格式/);assert(!JSON.stringify(r).includes('never stringify'));
});
test('stored source strings and lists have finite bounds',async()=>{
 const result=await parse({...envelope,summary:'x'.repeat(5000),observations:Array(100).fill('y'.repeat(5000)),limitations:Array(100).fill('z'.repeat(5000))});
 assert.ok(result.summary.length<=1000);assert.ok(result.observations.length<=12);assert.ok(result.limitations.length<=12);assert.ok(result.observations.every(x=>x.length<=1000));assert.ok(result.limitations.every(x=>x.length<=1000));
});
test('transport source is retained as a validated public whitelist only',async()=>{
 const source={provider:'qwen',model:'qwen3.7-flash',role:'independent',thinking:true};
 const result=await parse({transport:1,content:JSON.stringify(envelope),source:{...source,apiKey:'secret',reasoning_content:'private',endpoint:'https://private.invalid'}});
 assert.deepEqual(result.answer,answer);assert.deepEqual(result.source,source);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('private'));
 for(const bad of [{...source,provider:'unknown'},{...source,model:'https://private.invalid/key'},{...source,role:'unknown'},{...source,thinking:'yes'}])await assert.rejects(parse({transport:1,content:JSON.stringify(envelope),source:bad}),/SOURCE/);
 await assert.rejects(parse({transport:2,content:JSON.stringify(envelope),source}));
 await assert.rejects(parse({transport:1,content:JSON.stringify({...envelope,questionId:'wrong'}),source}),/IDENTITY/);
});
