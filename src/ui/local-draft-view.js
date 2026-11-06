import {draftAnswerState} from '../drafts/native-answer.js';
import {optionCaption} from './option-label.js';
const types={single:'单选',multiple:'多选',judge:'判断',fill:'填空',subjective:'主观题'};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
export function draftAnswer(answer,q){if(!answer)return '未保留可恢复的答案';if(answer.optionIds)return answer.optionIds.map(id=>optionCaption(q?.options?.find(o=>o.id===id))).join('\n');if(typeof answer.booleanValue==='boolean')return answer.booleanValue?'正确':'错误';if(answer.blanks)return answer.blanks.map((v,i)=>`第 ${i+1} 空：${v.trim()?v:'（未填写）'}`).join('\n');return answer.text||'未保留可恢复的答案';}
export function renderLocalDraft(container,record){
 const q=record.question,origin={generated:'模型作答',existing:'原有答案备份',skipped:'跳过时的题目记录',manual:'人工确认后填写'};
 const card=el('section',undefined,'draft-card');card.append(el('h3','本机保存的答案'),el('p',draftAnswer(record.answer,q),'draft-answer copy'));
 const dl=el('dl');const source=r=>r?.source?`${r.source.provider} · ${r.source.model}`:'未请求或未保留';
 for(const [name,value]of [['答案状态',draftAnswerState(record.answer)==='partial'?'部分填写 · 仍有空位未完成':record.answer?'完整答案':'未填写'],['来源',origin[record.origin]||'未记录'],['保存位置','当前 Edge 的扩展本机存储'],['平台保存','未确认 · 试卷未提交'],['答题模型',source(record.first)],['复核模型',source(record.second)]])dl.append(el('dt',name),el('dd',value));card.append(dl);container.append(card);
 const original=el('section',undefined,'draft-card');original.append(el('h3',`原题快照 · ${types[q?.type]||'未识别题型'}`),el('p',q?.stem||'原题快照缺失','copy'));for(const o of q?.options||[])original.append(el('p',optionCaption(o),'original-option'));if(q?.images?.length)original.append(el('p',`原题有 ${q.images.length} 张图片；本机草稿不保留图片，请返回原页核对。`,'muted'));container.append(original);
 if(record.first||record.second){const details=el('details',undefined,'draft-card');details.append(el('summary','查看两次模型输出'));for(const [title,result]of [['首次作答',record.first],['独立复答',record.second]]){if(!result)continue;details.append(el('h4',title),el('p',draftAnswer(result.answer,q),'copy'),el('p',result.summary||'未保留依据摘要','copy'));for(const text of [...(result.observations||[]),...(result.limitations||[])])details.append(el('p',text,'copy'));}if(record.review?.reason)details.append(el('p',record.review.reason,'copy'));container.append(details);}
}
