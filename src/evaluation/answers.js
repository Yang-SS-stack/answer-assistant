// Offline scoring only. This module never calls a model or receives credentials.
import {validateAnswer,expectedValue} from '../core/answers.js';

const types=new Set(['single','multiple','fill','judge']);
const norm=value=>value.normalize('NFKC').trim().replace(/\s+/gu,' ');
const fail=message=>{throw Error('EVALUATION_SCHEMA: '+message);};
function unique(items,key,label){
 if(!Array.isArray(items)||!items.length)fail(label+' must be a nonempty array');
 const map=new Map();for(const item of items){if(!item||typeof item[key]!=='string'||!item[key]||map.has(item[key]))fail(label+' missing/duplicate identity');map.set(item[key],item);}return map;
}
function checkQuestions(input){
 if(input?.schemaVersion!==1||typeof input.datasetId!=='string')fail('question dataset schema');
 const map=unique(input.questions,'id','questions');
 for(const q of map.values()){
  if(!types.has(q.type)||typeof q.stem!=='string'||!q.stem.trim())fail('question type/stem');
  if(q.type==='single'||q.type==='multiple'){
   unique(q.options,'id','options');if(q.options.some(o=>typeof o.text!=='string'))fail('option text');
  }
  if(q.type==='fill'&&(!Number.isInteger(q.blankCount)||q.blankCount<1))fail('blank count');
 }
 return map;
}
function checkGold(input,questions,map){
 if(input?.schemaVersion!==1||input.datasetId!==questions.datasetId||!['platform-graded','independent-reference'].includes(input.source?.kind))fail('gold dataset/source');
 const entries=unique(input.answers,'questionId','gold');
 if(entries.size!==map.size)fail('gold must cover all questions');
 for(const [id,a] of entries){
  const q=map.get(id);if(!q||q.type!==a.type)fail('gold identity/type');
  if(a.type==='fill'){
   if(!Array.isArray(a.acceptedBlanks)||a.acceptedBlanks.length!==q.blankCount||a.acceptedBlanks.some(v=>!Array.isArray(v)||!v.length||v.some(x=>typeof x!=='string'||!x.trim())))fail('gold accepted blanks');
  }else validateAnswer(Object.fromEntries(Object.entries(a).filter(([key])=>['questionId','type','optionIds','booleanValue'].includes(key))),q);
 }
 return entries;
}

// Prefer explicit historical run over empty current state in diagnostic exports.
export function adaptOutput(output){
 if(!output||typeof output!=='object'||Array.isArray(output))fail('output object');
 let container=output;
 if(output.previousRun?.results?.length)container=output.previousRun;
 else if(output.state&&typeof output.state==='object')container=output.state;
 else if(output.checkpoint&&typeof output.checkpoint==='object')container=output.checkpoint;
 const direct=Array.isArray(container.answers);
 const rows=direct?container.answers:container.results;
 if(!Array.isArray(rows))fail('output requires answers or results array');
 if(container.elapsedMs!==undefined&&(typeof container.elapsedMs!=='number'||!Number.isFinite(container.elapsedMs)||container.elapsedMs<0))fail('elapsedMs');
 const seen=new Set();
 const records=rows.map(row=>{
  const id=direct?row.questionId:row.id;
  if(typeof id!=='string'||!id||seen.has(id))fail('output missing/duplicate identity');seen.add(id);
  if(!types.has(row.type))fail('output type');
  for(const nested of [row.firstAnswer,row.secondAnswer,row.first?.answer,row.second?.answer])if(nested&&(nested.questionId!==id||nested.type!==row.type))fail('nested answer identity/type mismatch');
  if(direct)return{id,type:row.type,status:'answered',answer:row,autoPassed:false};
  const compact=Object.hasOwn(row,'writtenAnswer');
  const status=row.result??(compact&&row.pageVerified===true?'completed':null);
  if(!['completed','skipped','failed','review_pending','stopped'].includes(status))fail('unknown result status');
  const value=compact?row.writtenAnswer:row.newAnswer;
  const field={single:'optionIds',multiple:'optionIds',fill:'blanks',judge:'booleanValue'}[row.type];
  const answer=value===undefined?null:{questionId:id,type:row.type,[field]:value};
  return{id,type:row.type,status,answer,autoPassed:row.review?.status==='pass'||row.agreementVerified===true};
 });
 return{records,elapsedMs:container.elapsedMs??null};
}

export function evaluateAnswers({questions,gold,output}){
 if(!gold){const adapted=adaptOutput(output);return{scored:false,reason:'missing_gold',observedRecords:adapted.records.length,elapsedMs:adapted.elapsedMs,accuracy:null,meetsThreshold:null,threshold:0.9};}
 if(output?.datasetId!==undefined&&output.datasetId!==questions?.datasetId)fail('output dataset identity mismatch');
 const map=checkQuestions(questions),answers=checkGold(gold,questions,map),adapted=adaptOutput(output);
 const records=new Map(adapted.records.map(row=>[row.id,row]));
 for(const row of records.values()){
  const q=map.get(row.id);if(!q||row.type!==q.type)fail('unknown output identity/type');
  if(row.answer)validateAnswer(row.answer,q);
 }
 let correct=0,missing=0,skipped=0,failed=0,unanswered=0,autoPassedWrong=0,autoPassed=0;
 const details=[];
 for(const q of map.values()){
  const row=records.get(q.id),a=answers.get(q.id);let hit=false;
  if(!row)missing++;
  if(row?.status==='skipped')skipped++;
  if(row?.status==='failed')failed++;
  const answered=row&&['answered','completed'].includes(row.status)&&row.answer;
  if(answered){
   if(q.type==='fill')hit=row.answer.blanks.every((v,i)=>a.acceptedBlanks[i].some(x=>norm(x)===norm(v)));
   else if(q.type==='multiple')hit=JSON.stringify([...row.answer.optionIds].sort())===JSON.stringify([...a.optionIds].sort());
   else hit=JSON.stringify(expectedValue(row.answer))===JSON.stringify(expectedValue(a));
   if(row.autoPassed){autoPassed++;if(!hit)autoPassedWrong++;}
  }else unanswered++;
  if(hit)correct++;
  details.push({id:q.id,number:q.number??null,type:q.type,status:row?.status??'missing',correct:Boolean(hit),autoPassed:Boolean(answered&&row.autoPassed),actual:answered?expectedValue(row.answer):null,expected:q.type==='fill'?a.acceptedBlanks:expectedValue(a)});
 }
 const total=map.size,accuracy=correct/total;
 return{scored:true,datasetId:questions.datasetId,goldSource:gold.source,total,correct,incorrect:total-correct,unanswered,missing,skipped,failed,autoPassed,autoPassedWrong,elapsedMs:adapted.elapsedMs,accuracy,threshold:0.9,meetsThreshold:accuracy>=0.9,details};
}

function numberedBlanks(text){
 const sections=[...text.matchAll(/\((\d+)\)([\s\S]*?)(?=\(\d+\)|$)/gu)];
 if(!sections.length||sections.some((m,i)=>Number(m[1])!==i+1))fail('published blank numbering');
 return sections.map(m=>norm(m[2].replace(/Plain Text/gu,'')));
}
function displayedAnswer(text,q){
 if(q.type==='fill')return{blanks:numberedBlanks(text)};
 const value=norm(text);
 if(q.type==='judge'){
  if(!['对','错'].includes(value))fail('published judge value');return{booleanValue:value==='对'};
 }
 const labels=[...value.replace(/[\s,，、]/gu,'')];
 if(!labels.length||new Set(labels).size!==labels.length)fail('published choice labels');
 const optionIds=labels.map(label=>{const matches=q.options.filter(o=>o.displayLabel===label);if(matches.length!==1)fail('published display label missing/ambiguous');return matches[0].id;});
 return{optionIds};
}

// Rebuild reproducibly from captured read-only evidence; no answers enter questions.
export function buildGradedBaseline(observation,diagnostic,raw){
 const graded=unique(observation.questions,'platformId','graded observations');
 const sourceQuestions=unique(raw.questions,'id','ungraded source');
 const diagnosis=unique(diagnostic.diagnosis.questions,'id','diagnosis');
 if(graded.size!==sourceQuestions.size||graded.size!==diagnosis.size)fail('source question coverage');
 const questions=[],gold=[],observed=[];
 for(const g of graded.values()){
  const ids=[...diagnosis.keys()].filter(id=>id.startsWith('cx-'+g.platformId+'-'));
  if(ids.length!==1)fail('platform ID cannot map uniquely');
  const id=ids[0],d=diagnosis.get(id),original=sourceQuestions.get('question'+g.platformId);
  if(!original)fail('missing ungraded source question');
  const type={'单选题':'single','多选题':'multiple','填空题':'fill','判断题':'judge'}[g.type];
  if(type!==d.type||String(original.number)!==g.number)fail('source identity/type mismatch');
  const options=g.options.map(({id,text,displayLabel})=>({id,text:norm(text),displayLabel}));
  if(type==='single'||type==='multiple'){
   unique(options,'id','published options');unique(options,'displayLabel','published display labels');
   for(const option of options){
    const matches=original.choices.filter(c=>c.children.some(x=>x.data===option.id));
    if(matches.length!==1||!matches[0].children.some(x=>norm(x.text??'')===option.text))fail('option content mapping mismatch');
   }
  }
  const stem=original.header.replace(/^\s*\d+\.\s*\([^)]*\)\s*/u,'').trim();
  if(/我的答案|正确答案/u.test(stem))fail('answer leakage in source');
  const q={id,platformId:g.platformId,number:g.number,type,stem,options,blankCount:type==='fill'?d.blanks:0,images:(original.images??[]).map(i=>({url:i.path,width:i.width,height:i.height,...(g.number==='1'?{localFile:'../chaoxing-diagram.png'}:{})}))};
  const sections=g.text.match(/我的答案[:：]([\s\S]*?)正确答案[:：]([\s\S]*)$/u);
  if(!sections)fail('missing published answer sections');
  const expected=displayedAnswer(sections[2],q),actual=displayedAnswer(sections[1],q);
  const entry={questionId:id,type,...expected};
  if(type==='fill'){delete entry.blanks;entry.acceptedBlanks=expected.blanks.map(v=>v.split(/[;；]/u).map(norm));}
  questions.push(q);gold.push(entry);observed.push({questionId:id,type,...actual});
 }
 const datasetId='chaoxing-chapter3-graded-20-2026-11-02';
 return{questions:{schemaVersion:1,datasetId,questions},gold:{schemaVersion:1,datasetId,source:{kind:'platform-graded',file:'outputs/live-tests/2026-11-02-chaoxing-graded-observation.json',observedAt:observation.observedAt,semantics:'display labels mapped to stable option IDs and content; semicolon alternatives per ordered blank'},answers:gold},observed:{schemaVersion:1,datasetId,provenance:'historical page answers; not a new model strategy run',answers:observed}};
}
