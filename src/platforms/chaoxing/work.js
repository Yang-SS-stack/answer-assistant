import {bindImageNode} from '../content.js';
import {expectedValue,sameAnswer} from '../../core/answers.js';
import {wait} from '../../core/runner.js';
const text=e=>(e?.textContent||'').replace(/\u00a0/g,' ').trim();
const plain=e=>(e?.innerText||'').replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();
const typeMap={'单选题':['single','0'],'多选题':['multiple','1'],'填空题':['fill','2'],'判断题':['judge','3']};
const nonTextAnswer='img,svg,math,canvas,video,audio,object,embed,table,hr,input,[contenteditable="false"],[data-latex],[data-math],.katex,.MathJax';
function fingerprint(value){let hash=2166136261;for(const c of value)hash=Math.imul(hash^c.charCodeAt(0),16777619);return(hash>>>0).toString(16);}
export function createAdapter(doc=document,loc=location){
 const visible=e=>!!e?.isConnected&&!e.closest('[hidden],nav,header,aside,[role="navigation"]')&&e.getClientRects().length>0&&doc.defaultView.getComputedStyle(e).visibility!=='hidden';
 function form(){const forms=doc.querySelectorAll('form#submitForm');if(forms.length!==1)return null;const f=forms[0];try{const action=new URL(f.getAttribute('action'),'https://'+loc.hostname);return action.origin==='https://mooc1.chaoxing.com'&&action.pathname==='/mooc-ans/work/addStudentWorkNewWeb'&&visible(f)?f:null;}catch{return null;}}
 function detectPage(){
  const supported=(!loc.protocol||loc.protocol==='https:')&&loc.hostname==='mooc1.chaoxing.com'&&loc.pathname==='/mooc-ans/mooc2/work/dowork'&&!!form();
  if(supported&&[...form().querySelectorAll('.questionLi .mark_answer')].some(panel=>visible(panel)&&!!panel.querySelector('.mark_key,.mark_score')))return{supported:false,platform:'学习通',scene:'已提交或已批改',reason:'PAGE_READ_ONLY：当前为已提交或已批改页面，不会请求模型或填写。请通过平台正常重做入口进入可作答页面。'};
  return supported?{supported:true,platform:'学习通',scene:'作业作答',variant:'chaoxing-mooc2-work',verified:'真实结构已观察；上线填写验收中',limits:'仅此作业结构；主观、多空填空、考试与其他入口未验证'}:{supported:false,reason:'仅适配已观察的学习通 /mooc-ans/mooc2/work/dowork 作业表单；当前结构未确认'};
 }
 function findQuestions(){if(!detectPage().supported)return[];const roots=[...form().querySelectorAll('.questionLi')].filter(visible);const ids=roots.map(e=>e.id);if(new Set(ids).size!==ids.length||roots.some(e=>e.querySelector('.questionLi')))throw Error('CONTAINER_AMBIGUOUS：题目嵌套或标识重复');return roots;}
 function one(root,selector,reason){const all=root.querySelectorAll(selector);if(all.length!==1)throw Error(reason);return all[0];}
 function extractQuestion(element){
  if(!detectPage().supported||!form().contains(element)||!element.matches('.questionLi')||element.querySelector('.questionLi')||!visible(element))throw Error('CONTAINER：不是完整可见的作业题目');
  const platformId=element.getAttribute('data');if(!/^\d+$/.test(platformId)||element.id!=='question'+platformId||doc.querySelectorAll('[id="'+element.id+'"]').length!==1)throw Error('QUESTION_ID：题目标识缺失或重复');
  const header=one(element,':scope > h3.mark_name','STEM_MISSING：缺少题目标题'),body=one(element,':scope > .stem_answer','CONTAINER：缺少作答区域');
  const heading=text(header),number=heading.match(/^\s*(\d+)\s*[.．]/)?.[1],label=element.getAttribute('typename'),mapping=typeMap[label];
  if(!number||!heading.includes('('+label+')')&&!heading.includes('（'+label+'）'))throw Error('TYPE_CONFLICT：标题和题型标识不一致');
  const typeInput=one(element,'input[name="answertype'+platformId+'"]','TYPE_MISSING：缺少平台题型字段');
  const type=mapping?.[0]||'unknown';if(mapping&&typeInput.value!==mapping[1])throw Error('TYPE_CONFLICT：平台题型字段冲突');
  const stemNode=header.cloneNode(true);stemNode.querySelectorAll(':scope > .colorShallow').forEach(e=>e.remove());stemNode.querySelectorAll('br').forEach(e=>e.replaceWith(doc.createTextNode('\n')));stemNode.querySelectorAll('p,div,pre').forEach(e=>e.append(doc.createTextNode('\n')));
  const stem=text(stemNode).replace(/^\d+\s*[.．]\s*/,'').replace(new RegExp('^[（(]'+label+'[)）]\\s*'),'').trim();
  const rows=[...body.querySelectorAll(':scope > .answerBg')],bindings=[],options=[];let answerField=null;
  if(['single','multiple','judge'].includes(type)){
   answerField=one(element,'input[name="answer'+platformId+'"]','ANSWER_FIELD：缺少答案字段');
   for(const row of rows){const marker=one(row,':scope > .'+(type==='multiple'?'num_option_dx':'num_option'),'OPTION_MAPPING：选项标识不完整'),content=one(row,':scope > .answer_p','OPTION_MAPPING：缺少选项内容'),id=marker.getAttribute('data');
    if(row.getAttribute('qid')!==platformId||row.getAttribute('role')!==(type==='multiple'?'checkbox':'radio')||!(type==='judge'?/^(true|false)$/:/^[A-Z]$/).test(id))throw Error('OPTION_MAPPING：选项所属题目或编号不确定');
    const displayLabel=text(marker).replace(/[.．、]\s*$/,'').trim();
    if(!/^[A-Z]$/.test(displayLabel))throw Error('OPTION_LABEL：无法确认页面选项标号');
    bindings.push({row,marker,content,id});options.push({id,text:text(content),displayLabel});
   }
   if(options.length<2||new Set(options.map(o=>o.id)).size!==options.length||new Set(options.map(o=>o.displayLabel)).size!==options.length||options.some(o=>!o.text)||type==='judge'&&(options.length!==2||!['true','false'].every(id=>options.some(o=>o.id===id))))throw Error('OPTIONS_INVALID：选项缺失、重复或判断映射不明确');
  }
  let blankCount=0;
  if(type==='fill'){
   const size=one(element,'input[name="tiankongsize'+platformId+'"]','BLANK_MAPPING：缺少空位数量');blankCount=Number(size.value);
   if(blankCount!==1)throw Error('BLANK_UNVERIFIED：当前仅验证单空富文本填空，多空待适配');
   const section=one(body,':scope > .Answer','BLANK_MAPPING：空位区域不唯一'),area=one(section,'textarea[name="answerEditor'+platformId+'1"]','BLANK_MAPPING：编辑器字段不匹配'),frame=one(section,'iframe','EDITOR_UNVERIFIED：空位 iframe 不唯一');
   let editorBody;try{editorBody=frame.contentDocument?.body;}catch{}
   if(area.id!==area.name||doc.querySelectorAll('[id="'+area.id+'"]').length!==1||!frame.id||doc.querySelectorAll('[id="'+frame.id+'"]').length!==1||text(section.querySelector('.tiankong'))!=='第1空'||!editorBody?.isContentEditable)throw Error('EDITOR_UNVERIFIED：编辑器未就绪或归属不明确');
   bindings.push({section,area,frame,editorBody});
  }
  const imageNodes=[...new Set([header,...bindings.map(b=>b.content).filter(Boolean)].flatMap(e=>[...e.querySelectorAll('img')]))];
  const images=imageNodes.map((im,i)=>bindImageNode(im,{url:im.currentSrc||im.src,source:im.src,position:header.contains(im)?'stem':'option:'+bindings.find(b=>b.content?.contains(im))?.id,loaded:im.complete&&im.naturalWidth>0,index:i+1}));
  if(!stem&&!images.length)throw Error('STEM_MISSING：空题干且没有题目图片');
  // Preserve existing question identity; the observed labels are checked separately below.
  const signature=fingerprint(JSON.stringify({platformId,number,type,stem,options:options.map(({id,text})=>({id,text})),blankCount,images:images.map(({loaded,...im})=>im)}));
  return{id:'cx-'+platformId+'-'+signature,platformId,number,type,stem,options,blankCount,images,element,signature,bindings,answerField,typeInput};
 }
 function checkWritable(q){try{const fresh=extractQuestion(q.element);return fresh.signature===q.signature&&fresh.options.every((o,i)=>o.displayLabel===q.options[i]?.displayLabel)&&fresh.answerField===q.answerField&&fresh.typeInput===q.typeInput&&fresh.bindings.length===q.bindings.length&&fresh.bindings.every((b,i)=>q.type==='fill'?b.area===q.bindings[i].area&&b.frame===q.bindings[i].frame&&b.editorBody===q.bindings[i].editorBody: b.row===q.bindings[i].row&&b.marker===q.bindings[i].marker)&&!q.element.querySelector('input:disabled,textarea:disabled,input[readonly],textarea[readonly]');}catch{return false;}}
 function readCurrentAnswer(q){
  if(!checkWritable(q))throw Error('QUESTION_CHANGED：题目或控件已变化');
  if(['single','multiple','judge'].includes(q.type)){
   const cls=q.type==='multiple'?'check_answer_dx':'check_answer';const ids=q.bindings.filter(b=>{const checked=b.marker.classList.contains(cls),aria=b.row.getAttribute('aria-checked');if(aria!==null&&aria!==String(checked))throw Error('ANSWER_STATE_CONFLICT：选中标记与无障碍状态不一致');return checked;}).map(b=>b.id);
   if(q.type!=='multiple'&&ids.length>1)throw Error('ANSWER_STATE_CONFLICT：单选或判断存在多个选中答案');
   const serialized=q.answerField.value,expected=q.type==='multiple'?[...ids].sort().join(''):ids.join('');
   if(q.type==='multiple'?serialized.split('').sort().join('')!==expected:serialized!==expected)throw Error('ANSWER_STATE_CONFLICT：选中标记与平台保存字段不一致');
   return q.type==='judge'?(ids.length?ids[0]==='true':null):(ids.length?ids:null);
  }
  if(q.type==='fill')return q.bindings.map(b=>{
   const serialized=doc.createElement('div');serialized.innerHTML=b.area.value;serialized.querySelectorAll('script,style').forEach(e=>e.remove());
   if(b.editorBody.querySelector(nonTextAnswer)||serialized.querySelector(nonTextAnswer))throw Error('RICH_ANSWER_UNVERIFIED：原富文本含图片、公式或其他非文本内容，无法安全判空，未请求或覆盖');
   serialized.querySelectorAll('br').forEach(e=>e.replaceWith(doc.createTextNode('\n')));serialized.querySelectorAll('p,div,pre,li').forEach(e=>e.append(doc.createTextNode('\n')));
   const visible=plain(b.editorBody),stored=text(serialized),normalized=s=>s.replace(/\s+/g,' ').trim();
   if(normalized(visible)!==normalized(stored))throw Error('ANSWER_STATE_CONFLICT：富文本可见答案与保存字段不一致，未请求或覆盖');
   return visible;
  });return null;
 }
 function bridge(request,signal,{async=false}={}){
  signal.throwIfAborted();const token=crypto.randomUUID();
  if(!async){let result;const reply=e=>{try{const r=JSON.parse(e.detail);if(r.token===token)result=r;}catch{}};doc.addEventListener('aa-v4-cx-result',reply);
   try{signal.throwIfAborted();doc.dispatchEvent(new doc.defaultView.CustomEvent('aa-v4-cx-command',{detail:JSON.stringify({...request,token})}));}finally{doc.removeEventListener('aa-v4-cx-result',reply);}signal.throwIfAborted();if(!result?.ok)throw Error(result?.error||'EDITOR_BRIDGE_UNAVAILABLE');return;
  }
  return new Promise((resolve,reject)=>{let timer;const clean=()=>{clearTimeout(timer);doc.removeEventListener('aa-v4-cx-result',reply);signal.removeEventListener('abort',abort);};const abort=()=>{clean();reject(signal.reason);};const reply=e=>{let r;try{r=JSON.parse(e.detail);}catch{return;}if(r.token!==token)return;clean();if(signal.aborted)reject(signal.reason);else if(r.ok)resolve();else reject(Error(r.error||'DRAFT_SAVE_FAILED'));};
   doc.addEventListener('aa-v4-cx-result',reply);signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{clean();reject(Error('DRAFT_SAVE_TIMEOUT：未确认草稿保存，请检查页面'));},20000);
   if(signal.aborted){abort();return;}doc.dispatchEvent(new doc.defaultView.CustomEvent('aa-v4-cx-command',{detail:JSON.stringify({...request,token})}));
  });
 }
 return{detectPage,findQuestions,extractQuestion,readCurrentAnswer,checkWritable,supportsSubjective:false,
  async writeAnswer(q,answer,signal){
   signal.throwIfAborted();if(!checkWritable(q))throw Error('QUESTION_CHANGED');if(answer.type!==q.type)throw Error('ANSWER_IDENTITY：答案题型不匹配');readCurrentAnswer(q);
   if(['single','multiple','judge'].includes(q.type)){
    const wanted=answer.optionIds||[String(answer.booleanValue)];if(!wanted.length||wanted.some(id=>!q.options.some(o=>o.id===id))||new Set(wanted).size!==wanted.length||q.type!=='multiple'&&wanted.length!==1)throw Error('ANSWER_OPTIONS');
    for(const b of q.bindings){signal.throwIfAborted();if(!checkWritable(q))throw Error('QUESTION_CHANGED');const current=readCurrentAnswer(q),ids=q.type==='judge'?(current===null?[]:[String(current)]):current||[];if(ids.includes(b.id)!==wanted.includes(b.id)&&(q.type==='multiple'||wanted.includes(b.id))){b.row.click();signal.throwIfAborted();readCurrentAnswer(q);}}
   }else if(q.type==='fill'){
    if(answer.blanks?.length!==q.blankCount)throw Error('BLANK_COUNT');const b=q.bindings[0];bridge({action:'write',questionId:q.element.id,frameId:b.frame.id,key:b.area.id,oldText:plain(b.editorBody),oldSerialized:b.area.value,text:answer.blanks[0]},signal);
   }else throw Error('UNKNOWN_TYPE：此题型尚未适配');
  },
  async verifyAnswer(q,answer,signal){
   const accepted=()=>{if(!checkWritable(q)||!sameAnswer(readCurrentAnswer(q),expectedValue(answer),q.type))return false;if(q.type==='fill'){const stored=doc.createElement('div');stored.innerHTML=q.bindings[0].area.value;stored.querySelectorAll('script,style').forEach(e=>e.remove());stored.querySelectorAll('br').forEach(e=>e.replaceWith(doc.createTextNode('\n')));return text(stored).replace(/\r\n/g,'\n')===answer.blanks[0].replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();}return true;};
   for(let i=0;i<8;i++){signal.throwIfAborted();if(!checkWritable(q))return false;if(accepted()){await wait(150,signal);return accepted();}await wait(100,signal);}return false;
  },
  async saveDraft(signal){signal.throwIfAborted();if(!detectPage().supported)throw Error('DRAFT_PAGE_CHANGED');return bridge({action:'save'},signal,{async:true});},
  timer:()=>'未识别'
 };
}
