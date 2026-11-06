import {bindImageNode} from '../content.js';
import {expectedValue} from '../../core/answers.js';
import {wait} from '../../core/runner.js';
const text=e=>(e?.textContent||'').replace(/\u00a0/g,' ').trim();
const editorText=e=>(e?.innerText||'').replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();
function fingerprint(value){let hash=2166136261;for(const c of value)hash=Math.imul(hash^c.charCodeAt(0),16777619);return(hash>>>0).toString(16);}
export function createAdapter(doc= document,loc=location){
 const visible=e=>e.isConnected&&!e.closest('[hidden],nav,header,aside,[role="navigation"]')&&doc.defaultView.getComputedStyle(e).display!=='none'&&e.getClientRects().length>0;
 const blanks=e=>[...e.querySelectorAll('.item-body .blank-input[data-blank-index]')];
 const labels=e=>[...e.querySelectorAll('.item-body label')].filter(l=>l.querySelector('input[type="radio"],input[type="checkbox"]'));
 function selected(label,nodes){
  const framework=nodes.every(l=>l.classList.contains('el-radio')||l.classList.contains('el-checkbox'));
  if(!framework)return label.querySelector('input').checked;
  const aria=label.getAttribute('aria-checked'),styled=label.classList.contains('is-checked');
  if(aria==='false'&&styled)throw Error('ANSWER_STATE_CONFLICT：框架选中标记不一致');
  return aria==='true'||styled;
 }
 function extractQuestion(element){
  const body=element.querySelector(':scope > .item-body'),header=text(element.querySelector(':scope > .item-type'));
  if(!body||!/^\d+\./.test(header))throw Error('CONTAINER：缺少明确题号、题型或题目正文');
  const type=/多选题/.test(header)?'multiple':/单选题/.test(header)?'single':/判断题/.test(header)?'judge':/填空题/.test(header)?'fill':/主观题|简答题/.test(header)?'subjective':'unknown';
  const stemElement=body.querySelector(':scope > h4')||body.querySelector(':scope > .exam-font > div');
  if(!stemElement||!text(stemElement))throw Error('STEM_MISSING：题干不存在');
  const clone=stemElement.cloneNode(true);clone.querySelectorAll('.blank-input[data-blank-index]').forEach(input=>input.replaceWith(doc.createTextNode('[空'+(Number(input.dataset.blankIndex)+1)+']')));
  clone.querySelectorAll('br').forEach(el=>el.replaceWith(doc.createTextNode('\n')));clone.querySelectorAll('p,div,pre').forEach(el=>el.append(doc.createTextNode('\n')));
  const stem=text(clone);const optionNodes=labels(element);const options=optionNodes.map(l=>({id:l.querySelector('input').value,text:text(l.querySelector('.radioText,.checkboxText'))||l.querySelector('input').value}));
  if(['single','multiple'].includes(type)&&(options.length<2||new Set(options.map(o=>o.id)).size!==options.length||options.some(o=>!o.id||!o.text)))throw Error('OPTIONS_INVALID：选项不完整或标识重复');
  if(type==='judge'&&(options.length!==2||!['true','false'].every(id=>options.some(o=>o.id===id))))throw Error('JUDGE_MAPPING：判断选项没有明确 true/false 值');
  const blankNodes=blanks(element);if(type==='fill'&&(!blankNodes.length||blankNodes.some((e,i)=>Number(e.dataset.blankIndex)!==i)))throw Error('BLANK_MAPPING：空位索引缺失或顺序异常');
  const images=[...new Set([stemElement,...optionNodes.map(l=>l.querySelector('.radioText,.checkboxText')).filter(Boolean)].flatMap(e=>[...e.querySelectorAll('img')]))].map((im,i)=>bindImageNode(im,{url:im.currentSrc||im.src,source:im.src,position:stemElement.contains(im)?'stem':'option:'+optionNodes.find(l=>l.contains(im))?.querySelector('input')?.value,loaded:im.complete&&im.naturalWidth>0,index:i+1}));
  const signature=fingerprint(JSON.stringify({header:header.match(/^\d+\.[^\s(]+/)?.[0],stem,type,options,blanks:blankNodes.length,images:images.map(im=>({url:im.url,source:im.source,position:im.position,index:im.index}))}));
  const editorFrame=type==='subjective'?frame({element}):null;let editorBody=null;try{editorBody=editorFrame?.contentDocument?.body||null;}catch{}
  return{id:header.match(/^\d+/)[0]+'-'+signature,type,stem,options,blankCount:blankNodes.length,images,element,signature,editorFrame,editorBody};
 }
 function checkWritable(q){try{return visible(q.element)&&extractQuestion(q.element).signature===q.signature&&(q.type!=='subjective'||frame(q)===q.editorFrame&&(!q.editorFrame||q.editorFrame.contentDocument?.body===q.editorBody))&&!q.element.querySelector('.item-body input:disabled,.item-body textarea:disabled,.item-body input[readonly],.item-body textarea[readonly]');}catch{return false;}}
 function frame(q){const frames=[...q.element.querySelectorAll('.item-body .ueditor-content iframe')];return frames.length===1?frames[0]:null;}
 function editor(q){const f=frame(q);if(f){try{return f.contentDocument?.body?.isContentEditable?f.contentDocument.body:null;}catch{return null;}}return q.element.querySelector('.item-body textarea,.item-body [contenteditable="true"]');}
 function writeEditor(q,value,signal){
  signal.throwIfAborted();const f=frame(q),el=editor(q);if(!f||!el||!checkWritable(q))throw Error('EDITOR_UNVERIFIED');
  const token=crypto.randomUUID();let result;const reply=event=>{try{const r=JSON.parse(event.detail);if(r.token===token)result=r;}catch{}};
  doc.addEventListener('aa-v4-editor-result',reply);
  try{signal.throwIfAborted();doc.dispatchEvent(new doc.defaultView.CustomEvent('aa-v4-editor-write',{detail:JSON.stringify({token,frameId:f.id,stem:q.element.querySelector('.item-body > h4')?.textContent,oldText:editorText(el),text:value})}));}finally{doc.removeEventListener('aa-v4-editor-result',reply);}
  if(!result?.ok)throw Error(result?.error||'EDITOR_BRIDGE_UNAVAILABLE');
 }
 function readCurrentAnswer(q){
  if(q.type==='single'||q.type==='multiple'||q.type==='judge'){
   const nodes=labels(q.element),ids=nodes.filter(l=>selected(l,nodes)).map(l=>l.querySelector('input').value);
   if(q.type!=='multiple'&&ids.length>1)throw Error('ANSWER_STATE_CONFLICT：单选题存在多个选中标记');
   if(q.type==='judge')return ids.length?ids[0]==='true':null;return ids.length?ids:null;
  }
  if(q.type==='fill')return blanks(q.element).map(input=>input.value);
  if(q.type==='subjective'){const el=editor(q);return el?(el.isContentEditable?editorText(el):el.value)||null:null;}
  return null;
 }
 function setText(el,value,signal,q){const guard=()=>{signal.throwIfAborted();if(!checkWritable(q)||!el.isConnected||!q.element.contains(el)||el.disabled||el.readOnly)throw Error('QUESTION_CHANGED：填写中题目或控件已变化');};guard();const win=el.ownerDocument.defaultView;if(el.isContentEditable)el.textContent=value;else{const proto=el.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:win.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);}
  for(const type of ['input','change']){guard();el.dispatchEvent(new win.Event(type,{bubbles:true}));}
 }
 return {
  supportsSubjective:true,
  canWriteSubjective(q){return !!editor(q);},
  detectPage(){return loc.hostname==='examination.xuetangx.com'&&/^\/exam\//.test(loc.pathname)?{supported:true,platform:'雨课堂',scene:'考试页面',variant:'xuetang-exam',verified:'DOM inspected; filling pending'}:{supported:false,reason:'当前仅适配已观察的雨课堂考试系统 /exam/ 页面；此页面未验证'};},
  findQuestions(){if(!this.detectPage().supported)return[];return[...doc.querySelectorAll('.exercise-item')].filter(e=>visible(e)&&!e.querySelector('.exercise-item'));},
  extractQuestion,readCurrentAnswer,checkWritable,
  async writeAnswer(q,answer,signal){
   signal.throwIfAborted();if(!checkWritable(q))throw Error('QUESTION_CHANGED');
   if(['single','multiple','judge'].includes(q.type)){
    const wanted=answer.optionIds||[String(answer.booleanValue)];const nodes=labels(q.element);
    for(const id of wanted)if(!nodes.some(l=>l.querySelector('input').value===id))throw Error('OPTION_MISSING');
    for(const label of nodes){signal.throwIfAborted();if(!checkWritable(q))throw Error('QUESTION_CHANGED');const input=label.querySelector('input'),current=selected(label,nodes),target=wanted.includes(input.value);if(current!==target&&(target||q.type==='multiple')){if(input.checked!==current)input.checked=current;signal.throwIfAborted();label.click();}}
   }else if(q.type==='fill'){
    const nodes=blanks(q.element);if(nodes.length!==answer.blanks?.length)throw Error('BLANK_COUNT');for(let i=0;i<nodes.length;i++){if(blanks(q.element)[i]!==nodes[i])throw Error('BLANK_CHANGED');setText(nodes[i],answer.blanks[i],signal,q);}
   }else if(q.type==='subjective'){const el=editor(q);if(!el)throw Error('EDITOR_UNVERIFIED：编辑器未就绪');if(frame(q))writeEditor(q,answer.text,signal);else setText(el,answer.text,signal,q);}
   else throw Error('UNKNOWN_TYPE');
  },
  async verifyAnswer(q,answer,signal){
   for(let i=0;i<8;i++){signal.throwIfAborted();if(!checkWritable(q))return false;const actual=readCurrentAnswer(q),wanted=expectedValue(answer);
    const equal=q.type==='multiple'?JSON.stringify([...(actual||[])].sort())===JSON.stringify([...wanted].sort()):JSON.stringify(actual)===JSON.stringify(wanted);
    if(equal){await wait(200,signal);return checkWritable(q)&&JSON.stringify(readCurrentAnswer(q))===JSON.stringify(actual);}await wait(150,signal);
   }return false;
  },
  timer(){const candidates=[...doc.querySelectorAll('li')].map(text).filter(s=>/答题计时|剩余时间/.test(s)&&s.length<100);return candidates[0]||'未识别';}
 };
}
