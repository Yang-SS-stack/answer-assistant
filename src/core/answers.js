export function validateAnswer(raw, q) {
 let a;try {a=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('ANSWER_JSON：模型未返回合法 JSON');}
 if(!a||typeof a!=='object'||Array.isArray(a)||a.status==='uncertain') throw Error('ANSWER_UNCERTAIN：模型未提供确定答案');
 if(a.questionId!==q.id||a.type!==q.type) throw Error('ANSWER_IDENTITY：答案题目或题型不匹配');
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
