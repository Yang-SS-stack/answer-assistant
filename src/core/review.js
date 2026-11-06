export function validateReview(raw,q){let r;try{r=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('REVIEW_JSON：复核结果不是合法 JSON');}
 if(!r||r.questionId!==q.id||r.type!==q.type||!['pass','revise','uncertain'].includes(r.status)||!Array.isArray(r.issues)||r.issues.some(x=>typeof x!=='string'||!x.trim())||typeof r.reason!=='string'||!r.reason.trim()||Object.keys(r).some(k=>!['questionId','type','status','issues','reason'].includes(k))||r.status==='pass'&&r.issues.length)throw Error('REVIEW_SCHEMA：复核结果不完整、身份不匹配或结论矛盾');return r;
}
export function languageIssue(q,answer,context={}){
 if(q.type!=='subjective'||!/编程|写.{0,6}代码|编写.{0,6}程序/.test(q.stem)||/用\s*Java|使用\s*Java|Java\s*语言|用\s*C\+\+/i.test(q.stem))return null;
 const constraints=[context.name,context.language,context.requirements].filter(Boolean).join('\n');
 if(!/Python|JavaScript|Java|C\+\+|C#|SQL|TypeScript|Rust|MATLAB|PHP|Ruby|Swift|Kotlin|C语言/i.test(constraints+'\n'+q.stem))return '编程题未确认作答语言，待补充课程背景或人工复审';
 const python=/Python/i.test(constraints)||/用\s*Python|Python\s*语言/i.test(q.stem);
 if(python&&/System\s*\.\s*out\s*\.\s*print|class\s+\w+\s+extends\s+\w+|#include\s*[<"]|public\s+static\s+void\s+main/.test(answer.text||''))return '课程要求 Python，但候选代码存在明确的其他语言语法，待人工复审';return null;
}
