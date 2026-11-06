import {expectedValue,sameAnswer} from '../../core/answers.js';
import {wait} from '../../core/runner.js';
import {courseKey} from '../../storage/context.js';
import {assertNoSubmissionDialog,readEmbeddedProgress} from './progress.js';
import {createNavigation} from './navigation.js';
import {contentVisible as visibleContent,createContentView,bindImageNode} from '../content.js';
const text=el=>(el?.textContent||'').replace(/\u00a0/g,' ').trim();
const topPath=/^\/ai-workspace\/lms-graph\/(\d+)\/exercise\/(\d+)\/?$/;
const framePath=/^\/v2\/web\/iframe-exercise\/(\d+)\/(\d+)\/?$/;
const hash=value=>{let h=2166136261;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0).toString(16);};
// Current real evidence: embedded fill DOM only. Other native control shapes are fixture-tested.
// Safe page-switch uses the observed decline action; platform persistence remains unverified.
export function createAdapter(doc=document,loc=location){
 const initialKey=courseKey(loc.href),initialPath=loc.pathname;
 function context(allowedDialog=null,identityOnly=false){
  if(loc.protocol!=='https:'||loc.hostname!=='www.yuketang.cn'||loc.pathname!==initialPath||courseKey(loc.href)!==initialKey)throw Error('PAGE_CHANGED：当前作业身份已变化');
  const ids=loc.pathname.match(topPath);if(!ids)throw Error('PAGE_UNSUPPORTED：此雨课堂页面变体未验证');
  const frames=[...doc.querySelectorAll('iframe#iframeExerciseId')];if(frames.length!==1)throw Error('FRAME_NOT_READY：需要唯一作业 iframe');
  const frame=frames[0],url=new URL(frame.src,doc.baseURI),parts=url.pathname.match(framePath);
  if(url.origin!=='https://www.yuketang.cn'||!parts||parts[1]!==ids[1]||parts[2]!==ids[2]||url.username||url.password)throw Error('FRAME_IDENTITY：iframe 与当前课程/作业不一致');
  let inner;try{inner=frame.contentDocument;if(!inner||new URL(inner.location.href).origin!==url.origin||inner.location.pathname!==url.pathname)throw Error();}catch{throw Error('FRAME_UNAVAILABLE：作业 iframe 非同源或尚未就绪');}
  assertNoSubmissionDialog(doc,visible);if(!identityOnly)assertNoSubmissionDialog(inner,visible,allowedDialog);return{frame,inner};
 }
 function visible(el){if(!el?.isConnected)return false;for(let n=el;n?.nodeType===1;n=n.parentElement){const s=n.ownerDocument.defaultView.getComputedStyle(n);if(n.hidden||s.display==='none'||s.visibility==='hidden')return false;}return el.getClientRects().length>0;}
 function roots(ctx){return[...ctx.inner.querySelectorAll('.container-problem .subject-item')].filter(e=>visible(e)&&!e.closest('.problems-aside,nav,aside,[role="navigation"]')&&!e.querySelector('.subject-item'));}
 function controls(el,isVisible=visibleContent){return[...el.querySelectorAll('.item-body input,.item-body textarea,.item-body [contenteditable],.item-body iframe')].filter(control=>control.matches('input[type="radio"],input[type="checkbox"]')?isVisible(control.closest('label')):isVisible(control));}
 // These glyphs render through a platform substitution font; DOM text is not the
 // visible question. Mark it for rendered input, including inherited fonts.
 function textEncoding(nodes,isVisible=visibleContent){
  const markers=[];
  for(const root of nodes){
   const walker=root.ownerDocument.createTreeWalker(root,root.ownerDocument.defaultView.NodeFilter.SHOW_TEXT);
   for(let node=walker.nextNode();node;node=walker.nextNode()){
    const parent=node.parentElement;if(!node.textContent.trim()||!isVisible(parent))continue;
    const fonts=parent.ownerDocument.defaultView.getComputedStyle(parent).fontFamily.split(',').map(font=>font.trim().replace(/^['"]|['"]$/g,'').toLowerCase());
    if(parent.closest('.xuetangx-com-encrypted-font')||fonts.includes('exam-data-decrypt-font'))markers.push({text:node.textContent,font:parent.ownerDocument.defaultView.getComputedStyle(parent).fontFamily});
   }
  }
  return markers;
 }
 function extractQuestion(element,allowedDialog=null){
  const view=createContentView(),visibleContent=view.visible,visibleClone=view.clone,hasVisibleQuestionContent=view.hasContent,visibleContentImages=view.images;
  const ctx=context(allowedDialog);if(roots(ctx).length!==1||roots(ctx)[0]!==element)throw Error('CONTAINER：仅支持正文中唯一当前题目');
  const header=text(element.querySelector(':scope > .item-type')),number=header.match(/^(\d+)\s*[.．]/)?.[1],body=element.querySelector(':scope > .item-body');
  if(!number||!body)throw Error('CONTAINER：缺少明确题号、题型或正文');
  const progress=readEmbeddedProgress(ctx.inner,{paperKey:initialKey,current:Number(number)});
  const type=/多选题/.test(header)?'multiple':/单选题/.test(header)?'single':/判断题/.test(header)?'judge':/填空题/.test(header)?'fill':/主观题|简答题/.test(header)?'subjective':'unknown';
  const blankNodes=[...body.querySelectorAll('input.blank-item-dynamic')];
  const labels=[...body.querySelectorAll('label')].filter(l=>visibleContent(l)&&l.querySelector('input[type="radio"],input[type="checkbox"]'));
  const stemNodes=(type==='fill'?[...body.querySelectorAll(':scope > div')]:[...body.querySelectorAll('.problem-body')]).filter(visibleContent);
  if(stemNodes.length!==1)throw Error('STEM_MISSING：题干结构或可见性未验证');const stemNode=stemNodes[0];
  if(!hasVisibleQuestionContent(stemNode))throw Error('STEM_MISSING：没有可见的原题内容');
  const fontMarkers=textEncoding([stemNode,...labels],visibleContent),clone=visibleClone(stemNode);
  const imageOnlyStem=!text(clone)&&visibleContentImages(stemNode).some(im=>(im.getAttribute('src')||'').trim()||(im.getAttribute('srcset')||'').trim());
  clone.querySelectorAll('input.blank-item-dynamic').forEach((e,i)=>e.replaceWith(ctx.inner.createTextNode('[空'+(i+1)+']')));
  clone.querySelectorAll('br').forEach(e=>e.replaceWith(ctx.inner.createTextNode('\n')));clone.querySelectorAll('[data-latex]').forEach(e=>{e.replaceWith(ctx.inner.createTextNode(e.getAttribute('data-latex')));});
  let stem=text(clone);
  if(!stem&&!imageOnlyStem)throw Error('STEM_MISSING');
  if(imageOnlyStem)stem='题干仅含图片，请查看整题截图。';
  if(type==='fill'&&(!blankNodes.length||labels.length||blankNodes.some(e=>!stemNode.contains(e)||e.type!=='text'||!visibleContent(e))))throw Error('BLANK_MAPPING：空位结构、可见性或题型对应未验证');
  if(['single','multiple','judge'].includes(type)&&blankNodes.length)throw Error('CONTROLS_UNSUPPORTED：当前题型含未验证空位');
  const owned=[...blankNodes,...labels.map(l=>l.querySelector('input'))];
  if(['single','multiple','judge','fill'].includes(type)&&controls(element,visibleContent).some(control=>!owned.includes(control)))throw Error('CONTROLS_UNSUPPORTED：存在未映射的可见编辑控件');
  let options=labels.map(l=>{
   const input=l.querySelector('input'),id=input.getAttribute('value'),clone=visibleClone(l);clone.querySelectorAll('input').forEach(e=>e.remove());let optionText=text(clone);
   // Observed exercise judges render no text: explicit boolean native values
   // are paired with these exact correct/incorrect SVG symbols. Never infer by order.
   if(type==='judge'&&!optionText){
    const marker=l.querySelector('.radioInput'),icons=marker?.querySelectorAll('svg')||[],uses=marker?.querySelectorAll('use')||[];
    const expected=id==='true'?'#icon--tiankongtizhengque':id==='false'?'#icon--tiankongticuowu':null;
    if(expected&&icons.length===1&&uses.length===1&&visibleContent(marker)&&visibleContent(icons[0])&&(uses[0].getAttribute('href')||uses[0].getAttribute('xlink:href'))===expected)optionText=id==='true'?'正确':'错误';
   }
   return{id,text:optionText};
  });
  if(['single','multiple','judge'].includes(type)&&(options.length<2||options.some(o=>!o.id||!o.text)||new Set(options.map(o=>o.id)).size!==options.length||labels.some(l=>l.querySelectorAll('input').length!==1||l.querySelector('input').type!==(type==='multiple'?'checkbox':'radio'))))throw Error('OPTIONS_INVALID：仅支持明确值与题内原生选项');
  if(type==='judge'&&(options.length!==2||!['true','false'].every(id=>options.some(o=>o.id===id))))throw Error('JUDGE_MAPPING：判断值未明确映射 true/false');
  const rendered=fontMarkers.length>0||imageOnlyStem;
  let images=[...new Set([stemNode,...labels].flatMap(visibleContentImages))].map((im,i)=>bindImageNode(im,{url:im.currentSrc||im.src,source:im.src,position:stemNode.contains(im)?'stem':'option:'+labels.find(l=>l.contains(im))?.querySelector('input')?.value,loaded:im.complete&&im.naturalWidth>0,index:i+1,...(rendered?{visible:true}:{})}));
  const contentFingerprint=JSON.stringify({stem,type,options,blanks:blankNodes.length,images:images.map(({loaded,...im})=>im),...(fontMarkers.length?{fontMarkers}:{})});
  const signature=hash(JSON.stringify({key:initialKey,header,stem,type,options,blanks:blankNodes.length,progress:{current:progress.current,total:progress.total},images:images.map(({loaded,...im})=>im),...(fontMarkers.length?{fontMarkers}:{})}));
  const visualInput=rendered?{kind:'rendered-question'}:null;
  if(visualInput){
   stem='请依据整题截图中的题干和选项作答。';
   options=options.map((option,i)=>{const markers=labels[i].querySelectorAll(type==='multiple'?'.checkboxInput':'.radioInput'),marker=markers.length===1?markers[0]:null,displayLabel=marker&&visibleContent(marker)&&!textEncoding([marker],visibleContent).length?text(marker):'';return{id:option.id,text:'请查看整题截图中的对应选项',...(/^[A-Z]$/.test(displayLabel)?{displayLabel}:{})};});
   if(['single','multiple'].includes(type)&&(options.some(option=>!option.displayLabel)||new Set(options.map(option=>option.displayLabel)).size!==options.length))throw Error('VISUAL_OPTION_MAPPING：截图选项标号不能唯一对应原生控件，未请求模型');
   images=[{position:'question-rendered',loaded:true}];
  }
  return{...(visualInput?{visualInput}:{}),id:number+'-'+signature,number,type,stem,options,blankCount:blankNodes.length,images,element,signature,contentFingerprint,frame:ctx.frame,frameDocument:ctx.inner,controls:controls(element,visibleContent),blankNodes,labels};
 }
 function checkWritable(q,allowedDialog=null){try{const ctx=context(allowedDialog),fresh=extractQuestion(q.element,allowedDialog);return visible(ctx.frame)&&ctx.frame===q.frame&&ctx.inner===q.frameDocument&&fresh.signature===q.signature&&fresh.controls.length===q.controls.length&&fresh.controls.every((e,i)=>e===q.controls[i]&&!e.disabled&&!e.readOnly&&!e.matches('iframe,[contenteditable]'))&&['single','multiple','judge','fill'].includes(q.type);}catch{return false;}}
 function selected(label){const input=label.querySelector('input'),mark=label.querySelector('.el-radio__input,.el-checkbox__input')||label;const framework=label.matches('.el-radio,.el-checkbox'),aria=label.getAttribute('aria-checked')??mark.getAttribute('aria-checked'),checked=mark.classList.contains('is-checked')||label.classList.contains('is-checked');if(aria==='false'&&checked||framework&&input.checked!==(aria==='true'||checked))throw Error('ANSWER_STATE_CONFLICT');return framework?aria==='true'||checked:input.checked;}
 function readCurrentAnswer(q){if(q.type==='fill')return q.blankNodes.map(e=>e.value);if(['single','multiple','judge'].includes(q.type)){const ids=q.labels.filter(selected).map(l=>l.querySelector('input').value);if(q.type!=='multiple'&&ids.length>1)throw Error('ANSWER_STATE_CONFLICT');return q.type==='judge'?(ids.length?ids[0]==='true':null):(ids.length?ids:null);}return null;}
 const guard=(q,signal)=>{signal.throwIfAborted();if(!checkWritable(q))throw Error('QUESTION_CHANGED：题目、iframe 或控件已变化');};
 async function waitForAnswer(q,wanted,signal,stableMs){
  const deadline=Date.now()+1500;let matchingSince=null;
  for(;;){guard(q,signal);const now=Date.now();let matches=false;try{matches=sameAnswer(readCurrentAnswer(q),wanted,q.type);}catch(e){if(e.message!=='ANSWER_STATE_CONFLICT')throw e;}if(matches){matchingSince??=now;if(now-matchingSince>=stableMs)return true;}else matchingSince=null;
   if(now>=deadline)return false;await wait(Math.min(50,deadline-now),signal);
  }
 }
 function readProgress(allowedDialog=null){const ctx=context(allowedDialog),found=roots(ctx);if(found.length!==1)throw Error('PAGINATION_CONTAINER：需要唯一当前题');const number=text(found[0].querySelector(':scope > .item-type')).match(/^(\d+)\s*[.．]/)?.[1];return readEmbeddedProgress(ctx.inner,{paperKey:initialKey,current:Number(number)});}
 const pagination=createNavigation({getContext:allowed=>context(allowed),getIdentityContext:()=>context(null,true),roots,extract:extractQuestion,checkWritable,readAnswer:readCurrentAnswer,readProgress,visible});
 return{
  executionScope:'current-question',
  pagination,
  supportsSubjective:false,canWriteSubjective:()=>false,
  detectPage(){const identity={platform:'雨课堂',scene:'内嵌作业（单题分页）',variant:'yuketang-embedded-exercise',pageFlow:{kind:'single-paged',automaticNext:false,persistence:'unverified'},capabilities:{fill:'observed-dom',single:'simulated-only',multiple:'simulated-only',judge:'simulated-only',subjective:'unsupported',saveDraft:'unverified',next:'blocked-until-save-verified',completion:'unverified'},limitation:'单题分页：仅填写并读回当前题；独立暂存未验证，不自动切题或提交。'};try{const ctx=context();if(!visible(ctx.frame)||roots(ctx).length!==1)throw Error('FRAME_NOT_READY：当前题正文未就绪或存在多个题根');const pageFlow=readProgress();return{...identity,scene:`内嵌作业（单题分页）· 第 ${pageFlow.current} / ${pageFlow.total??'未知'} 题`,pageFlow,supported:true,paperKey:initialKey};}catch(e){return{...identity,supported:false,reason:e.message};}},
  findQuestions(){try{const ctx=context();const found=roots(ctx);return visible(ctx.frame)&&found.length===1?found:[];}catch{return[];}},
  extractQuestion:element=>extractQuestion(element),readCurrentAnswer,checkWritable:q=>checkWritable(q),
  async writeAnswer(q,answer,signal){
   guard(q,signal);
   if(q.type==='fill'){
    if(answer.blanks?.length!==q.blankNodes.length)throw Error('BLANK_COUNT');
    for(let i=0;i<q.blankNodes.length;i++){
     guard(q,signal);const el=q.blankNodes[i],win=el.ownerDocument.defaultView;
     Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set.call(el,answer.blanks[i]);
     for(const event of ['input','change']){guard(q,signal);el.dispatchEvent(new win.Event(event,{bubbles:true}));}
    }
    return;
   }
   if(!['single','multiple','judge'].includes(q.type))throw Error('EDITOR_UNVERIFIED：此题型未适配');
   const wanted=answer.optionIds||[String(answer.booleanValue)];
   if(wanted.some(id=>!q.options.some(o=>o.id===id)))throw Error('OPTION_MISSING');
   // Read the initial group once. A radio click updates native peers before the
   // framework commits; do not interpret that expected transition as a new state.
   const states=q.labels.map(label=>({label,input:label.querySelector('input'),current:selected(label),target:wanted.includes(label.querySelector('input').value)}));
   if(q.type!=='multiple'){
    const target=states.find(state=>state.target);if(!target)throw Error('OPTION_MISSING');
    guard(q,signal);if(!target.current){target.input.checked=target.current;target.label.click();}return;
   }
   // Vue's checkbox change handler reads a per-component array prop. Synchronous
   // clicks can each read the pre-render array and lose earlier selections. Wait
   // for the entire planned group after every one-off click before the next one.
   const planned=new Set(states.filter(s=>s.current).map(s=>s.input.value));
   for(const state of states){
    guard(q,signal);if(state.current===state.target)continue;
    if(!sameAnswer(readCurrentAnswer(q),planned.size?[...planned]:null,q.type))throw Error('ANSWER_CHANGED：多选填写期间答案已变化');
    state.input.checked=state.current;state.label.click();
    if(state.target)planned.add(state.input.value);else planned.delete(state.input.value);
    if(!await waitForAnswer(q,planned.size?[...planned]:null,signal,50))throw Error('VERIFY_FAILED：多选单步未稳定接受，已停止后续勾选');
   }
  },
  async verifyAnswer(q,answer,signal){
   // Framework state may be committed after the click handler has returned.
   // Read only: never retry clicking, and require a stable match before accepting.
   return waitForAnswer(q,expectedValue(answer),signal,200);
  },
  findNext:()=>null,isComplete:()=>false,timer:()=>'未识别'
 };
}
