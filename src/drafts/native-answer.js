import {validateAnswer} from '../core/answers.js';

// A local backup preserves native state; it does not certify a final answer.
// Only existing fill values may contain empty slots. Model/manual answers always
// take the unchanged final-answer validator, including during local restoration.
export function validateDraftAnswer(record,q=record.question){
 const a=record.answer;
 if(record.origin!=='existing'||q.type!=='fill')return validateAnswer(a,q);
 if(!a||typeof a!=='object'||Array.isArray(a)||a.questionId!==q.id||a.type!==q.type)throw Error('ANSWER_IDENTITY：原生备份题目或题型不匹配');
 if(Object.keys(a).some(k=>!['questionId','type','blanks'].includes(k)))throw Error('ANSWER_SCHEMA：原生备份字段不合法');
 if(!Number.isInteger(q.blankCount)||q.blankCount<1||!Array.isArray(a.blanks)||a.blanks.length!==q.blankCount||Array.from(a.blanks).some(v=>typeof v!=='string'))throw Error('ANSWER_BLANKS：原生填空值与空位数量不匹配');
 return structuredClone(a);
}
export const draftAnswerState=answer=>answer==null?'empty':answer.type==='fill'&&answer.blanks.some(v=>!v.trim())?'partial':'complete';
