// A page's visible letter, its answer text and its stable DOM ID are different values.
export function optionCaption(option){
 if(!option)return '选项内容未保留';
 return option.displayLabel?`页面 ${option.displayLabel} · 内容 ${option.text}`:`内容 ${option.text}（页面标号未记录）`;
}
export function missingLetterLabels(q){
 return q?.id?.startsWith('cx-')&&['single','multiple'].includes(q.type)&&q.options?.length>0&&q.options.every(o=>/^[A-Z]$/.test(o.text.trim()))&&q.options.some(o=>!o.displayLabel);
}
