import {validateAnswer} from './answers.js';
const TEXT_LIMIT=1000,LIST_LIMIT=12;
const sourceText=value=>value.trim().slice(0,TEXT_LIMIT);
function sourceList(value,field,notes){
 if(value==null){notes.push(field+'说明字段缺失或为空，按空列表处理');return[];}
 if(typeof value==='string'){notes.push(field+'说明字段由文本转换为列表');return value.trim()?[sourceText(value)]:[];}
 if(!Array.isArray(value)){notes.push(field+'说明字段格式异常，已忽略非文本内容');return[];}
 if(value.some(item=>typeof item!=='string'))notes.push(field+'说明字段含非文本项，已忽略这些项');
 return value.filter(item=>typeof item==='string').slice(0,LIST_LIMIT).map(sourceText);
}
function identity(value,q){if(value.questionId!==q.id||value.type!==q.type)throw Error('ANSWER_IDENTITY：答案题目或题型不匹配');}
export function sanitizeModelSource(source){
 if(!source||typeof source!=='object'||Array.isArray(source)||!['deepseek','qwen'].includes(source.provider)||typeof source.model!=='string'||! /^[A-Za-z0-9._-]{1,160}$/.test(source.model)||!['answer','independent','review'].includes(source.role)||typeof source.thinking!=='boolean')throw Error('MODEL_SOURCE：模型来源字段不合法');
 return{provider:source.provider,model:source.model,role:source.role,thinking:source.thinking};
}
export function parseModelResult(raw,q){
 let value;try{value=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('ANSWER_JSON：模型未返回合法 JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('MODEL_RESULT_SCHEMA：模型结果不是对象');
 if(Object.hasOwn(value,'transport')){
  if(value.transport!==1||typeof value.content!=='string')throw Error('MODEL_RESULT_SCHEMA：传输包装不合法');
  const source=sanitizeModelSource(value.source),result=parseModelResult(value.content,q);
  if(result.source)throw Error('MODEL_RESULT_SCHEMA：禁止嵌套传输包装');
  return{...result,source};
 }
 if(Object.hasOwn(value,'protocol')){
  identity(value,q);
  const keys=['protocol','questionId','type','answer','summary','observations','limitations'];
  if(value.protocol!==1||['protocol','questionId','type','answer'].some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!keys.includes(key)))throw Error('MODEL_RESULT_SCHEMA：模型结果字段不合法');
  // Explanation fields cannot make an invalid answer valid, or gate a valid one.
  // Validate the actual answer first; never infer an answer from explanation data.
  const answer=value.answer===null?null:validateAnswer(value.answer,q),notes=[];
  const summary=typeof value.summary==='string'?sourceText(value.summary):'';
  if(typeof value.summary!=='string')notes.push('summary说明字段缺失或格式异常，按空文本处理');
  const observations=sourceList(value.observations,'observations',notes),limitations=sourceList(value.limitations,'limitations',notes);
  if(!summary)notes.push('模型未提供依据摘要');
  return{status:answer===null?'uncertain':'answered',answer,summary,observations,limitations:[...notes,...limitations].slice(0,LIST_LIMIT)};
 }
 if(value.status==='uncertain'){
  // The exact historical sentinel is accepted; any supplied identity must be complete and match.
  if(Object.hasOwn(value,'questionId')||Object.hasOwn(value,'type'))identity(value,q);
  if(Object.keys(value).some(key=>!['status','questionId','type'].includes(key)))throw Error('MODEL_RESULT_SCHEMA：不确定结果字段不合法');
  return{status:'uncertain',answer:null,summary:'',observations:[],limitations:['模型未提供依据摘要']};
 }
 return{status:'answered',answer:validateAnswer(value,q),summary:'',observations:[],limitations:['模型未提供依据摘要']};
}
