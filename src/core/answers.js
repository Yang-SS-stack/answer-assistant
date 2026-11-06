const identityKind=value=>value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value;
const identityText=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,255}$/.test(value)&&!/^(sk-|gh[pousr]_|github_pat_)/.test(value)?value:null;
export function assertAnswerIdentity(value,q,layer='answer'){
 if(value?.questionId===q.id&&value?.type===q.type)return;
 const error=Error('ANSWER_IDENTITY：模型返回的题目编号或题型与当前题不一致，已停止且未填写');
 error.modelFailure={code:'ANSWER_IDENTITY',layer,expected:{questionId:identityText(q.id),type:identityText(q.type)},received:{questionId:identityText(value?.questionId),type:identityText(value?.type)},kinds:{questionId:identityKind(value?.questionId),type:identityKind(value?.type)},mismatchedFields:['questionId','type'].filter(k=>value?.[k]!==(k==='questionId'?q.id:q.type))};
 throw error;
}
export function identityFailureDetails(raw){
 if(!raw||raw.code!=='ANSWER_IDENTITY'||!['answer','result','legacy-uncertain'].includes(raw.layer))return;
 const fields=['questionId','type'],kinds=['missing','null','array','object','string','number','boolean','function','symbol','bigint'];
 return{code:'ANSWER_IDENTITY',layer:raw.layer,expected:Object.fromEntries(fields.map(k=>[k,identityText(raw.expected?.[k])])),received:Object.fromEntries(fields.map(k=>[k,identityText(raw.received?.[k])])),kinds:Object.fromEntries(fields.map(k=>[k,kinds.includes(raw.kinds?.[k])?raw.kinds[k]:'missing'])),mismatchedFields:fields.filter(k=>Array.isArray(raw.mismatchedFields)&&raw.mismatchedFields.includes(k))};
}
export function validateAnswer(raw, q) {
 let a;try {a=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('ANSWER_JSON：模型未返回合法 JSON');}
 if(!a||typeof a!=='object'||Array.isArray(a)||a.status==='uncertain') throw Error('ANSWER_UNCERTAIN：模型未提供确定答案');
 assertAnswerIdentity(a,q);
 const field={single:'optionIds',multiple:'optionIds',judge:'booleanValue',fill:'blanks',subjective:'text'}[q.type];
 if(!field||Object.keys(a).some(k=>!['questionId','type',field].includes(k))) throw Error('ANSWER_SCHEMA：答案字段不合法');
 if(field==='optionIds') {
  const ids=a.optionIds;
  if(!Array.isArray(ids)||!ids.length||(q.type==='single'&&ids.length!==1)||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!q.options.some(o=>o.id===id))) throw Error('ANSWER_OPTIONS：选项缺失、重复或不存在');
 } else if(field==='booleanValue'&&typeof a.booleanValue!=='boolean') throw Error('ANSWER_JUDGE：判断题必须返回布尔值');
 else if(field==='blanks'&&(!Array.isArray(a.blanks)||a.blanks.length!==q.blankCount||a.blanks.some(v=>typeof v!=='string'||!v.trim()))) throw Error('ANSWER_BLANKS：填空答案与空位数量不匹配');
 else if(field==='text'&&(typeof a.text!=='string'||!a.text.trim()||a.text.length>30000)) throw Error('ANSWER_TEXT：主观题答案为空或过长');
 return structuredClone(a);
}
export function expectedValue(answer) {return answer.optionIds??answer.booleanValue??answer.blanks??answer.text;}
export function sameAnswer(a,b,type) {return JSON.stringify(type==='multiple'&&Array.isArray(a)?[...a].sort():a)===JSON.stringify(type==='multiple'&&Array.isArray(b)?[...b].sort():b);}
