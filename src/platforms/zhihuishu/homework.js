import {homeworkKey} from './context.js';
import {createContentView,bindImageNode} from '../content.js';
import {expectedValue,sameAnswer} from '../../core/answers.js';
import {wait} from '../../core/runner.js';
const text=e=>(e?.textContent||'').replace(/\u00a0/g,' ').trim();
const types={'单选题':'single','多选题':'multiple','判断题':'judge'};
const hash=s=>{let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);return(n>>>0).toString(16);};
function one(root,selector,error){const all=root.querySelectorAll(selector);if(all.length!==1)throw Error(error);return all[0];}
export function createAdapter(doc=document,loc=location){
 const key=homeworkKey(loc.href);let boundPaper=null;
 function context(){
  if(!key||homeworkKey(loc.href)!==key)throw Error('PAGE_CHANGED：智慧树作业身份不完整或已切换');
  const view=createContentView(),paper=one(doc,'.answer-homework-page-wrap','CONTAINER：作业区域不唯一');
  if(!view.visible(paper)||boundPaper&&paper!==boundPaper.node)throw Error('PAGE_CHANGED：作业区域已重建或不可见');
  if([...doc.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"],.el-dialog,.el-message-box,.el-overlay,.el-loading-mask')].some(view.visible))throw Error('DIALOG_UNVERIFIED：出现未验证弹窗或加载遮罩，未填写或提交');
  const header=one(paper,':scope > .base-header-component','CONTAINER：缺少作业标题'),body=one(paper,'.answer-homework-question-content-wrap','CONTAINER：缺少题目区域');
  if(!view.visible(header)||!view.visible(body))throw Error('CONTAINER：作业标题或正文不可见');
  const total=Number(text(header).match(/共\s*(\d+)\s*题/)?.[1]);
  const roots=[...body.querySelectorAll('.answer-group .question-item')];
  if(!Number.isInteger(total)||total<1||total>1000||roots.length!==total||body.querySelectorAll('.question-item').length!==roots.length)throw Error('PAPER_INCOMPLETE：题目数量与作业总数不一致');
  const ids=roots.map(e=>e.id);
  if(new Set(ids).size!==ids.length||roots.some((root,i)=>!/^\d{1,32}$/.test(root.id)||doc.querySelectorAll('[id="'+root.id+'"]').length!==1||root.querySelector('.question-item')||!view.visible(root)||Number(text(root.querySelector(':scope > .base-question-component > .title-box > .title')).match(/^(\d+)\s*、/)?.[1])!==i+1))throw Error('PAPER_IDENTITY：题目标识、顺序或可见性无法确认');
  if(boundPaper&&(boundPaper.total!==total||boundPaper.ids!==JSON.stringify(ids)))throw Error('PAGE_CHANGED：作业题目清单已变化');
  // Keep the root reference as well as the ordered identities. No rebinding
  // while an asynchronous answer is outstanding.
  if(!boundPaper)boundPaper={node:paper,total,ids:JSON.stringify(ids)};
  return{paper,body,roots,total,view};
 }
 const currentContext=context;
 function project(node,view){
  if(!view.visible(node)||!view.hasContent(node))throw Error('CONTENT_MISSING：缺少可见题目内容');
  if([...node.querySelectorAll('input,textarea,select,button,[contenteditable],iframe,canvas,svg,math,video,audio,object,embed')].some(view.visible))throw Error('CONTENT_UNVERIFIED：存在尚未适配的题目媒体或编辑控件');
  const copy=view.clone(node);copy.querySelectorAll('script,style').forEach(e=>e.remove());
  copy.querySelectorAll('br').forEach(e=>e.replaceWith(doc.createTextNode('\n')));
  copy.querySelectorAll('[data-latex]').forEach(e=>{if(e.getAttribute('data-latex'))e.replaceWith(doc.createTextNode(e.getAttribute('data-latex')));});
  const value=text(copy);
  if(/[\uE000-\uF8FF\uFFFD]/.test(value))throw Error('TEXT_ENCODING_UNVERIFIED：题目含未验证字形，未发送不完整题面');
  return value||(view.images(node).length?'请查看对应原图。':'');
 }
 function extractQuestion(element){
  const ctx=currentContext(),{view}=ctx;
  if(!ctx.roots.includes(element))throw Error('CONTAINER：不是当前作业题目');
  const component=one(element,':scope > .base-question-component','CONTAINER：题目组件不唯一'),heading=one(component,':scope > .title-box > .title','TYPE_MISSING：缺少题号/题型');
  const match=text(heading).match(/^(\d+)\s*、\s*(单选题|多选题|判断题)\s*$/);
  if(!match)throw Error('TYPE_UNVERIFIED：仅适配此入口已观察的单选、多选、判断题');
  const [,number,label]=match,type=types[label],group=element.closest('.answer-group');
  if(!text(group.querySelector('.group-title')).includes(label))throw Error('TYPE_CONFLICT：分组与题型不一致');
  const stemNode=one(component,':scope > .qeustion-content > .markdown-latex-container','STEM_MISSING：题干边界不唯一');
  const stem=project(stemNode,view),list=one(component,':scope > .option-list','OPTION_MAPPING：选项区域不唯一');
  if(!view.visible(list)||!list.classList.contains('stu-edit'))throw Error('PAGE_READ_ONLY：当前题不是可编辑作业');
  if([...element.querySelectorAll('input,textarea,select,[contenteditable],iframe')].some(view.visible))throw Error('CONTROLS_UNVERIFIED：题内存在未映射编辑控件');
  const rows=[...list.querySelectorAll(':scope > .option-item')];
  if(rows.length<2||rows.length>26||list.querySelectorAll('.option-item').length!==rows.length)throw Error('OPTION_MAPPING：选项数量或边界未确认');
  const bindings=rows.map(row=>{
   if(!view.visible(row)||row.matches('.is-success,.is-error,.is-lou,[disabled],[aria-disabled="true"]'))throw Error('PAGE_READ_ONLY：选项不可编辑或为批改状态');
   const marker=one(row,':scope > .option-order','OPTION_MAPPING：缺少选项标号'),content=one(row,':scope > .option-content','OPTION_MAPPING：缺少选项正文'),icon=one(row,':scope > i.iconfont','OPTION_MAPPING：选择图标不唯一');
   const displayLabel=text(marker).match(/^([A-Z])\.$/)?.[1],optionText=project(content,view),base='aloha-icon-'+(type==='multiple'?'duoxuan':'danxuan');
   if(!displayLabel||!view.visible(marker)||!view.visible(icon)||![base,base+'-xuanzhong'].some(c=>icon.classList.contains(c)))throw Error('OPTION_MAPPING：选项标号或选择控件未验证');
   let id=displayLabel;
   if(type==='judge'){if(optionText==='对')id='true';else if(optionText==='错')id='false';else throw Error('JUDGE_MAPPING：判断选项必须明确为对/错');}
   return{row,marker,content,icon,id,displayLabel,optionText};
  });
  if(new Set(bindings.map(b=>b.id)).size!==rows.length||new Set(bindings.map(b=>b.displayLabel)).size!==rows.length||type==='judge'&&(rows.length!==2||!['true','false'].every(id=>bindings.some(b=>b.id===id))))throw Error('OPTION_MAPPING：选项重复或判断语义不唯一');
  const options=bindings.map(b=>({id:b.id,text:b.optionText,displayLabel:b.displayLabel}));
  const images=[stemNode,...bindings.map(b=>b.content)].flatMap(node=>view.images(node).map(im=>({im,position:node===stemNode?'stem':'option:'+bindings.find(b=>b.content===node).id}))).map(({im,position},i)=>bindImageNode(im,{url:im.currentSrc||im.src,source:im.src,position,width:im.naturalWidth,height:im.naturalHeight,loaded:im.complete&&im.naturalWidth>0,index:i+1}));
  const contentFingerprint=JSON.stringify({type,number,stem,options,images:images.map(({loaded,...im})=>im)}),signature=hash(JSON.stringify({key,platformId:element.id,contentFingerprint}));
  return{id:'zhs-'+element.id+'-'+signature,platformId:element.id,number,type,stem,options,blankCount:0,images,signature,contentFingerprint,element,component,stemNode,list,bindings};
 }
 function checkWritable(q){try{const fresh=extractQuestion(q.element);return fresh.signature===q.signature&&fresh.contentFingerprint===q.contentFingerprint&&fresh.component===q.component&&fresh.stemNode===q.stemNode&&fresh.list===q.list&&fresh.images.length===q.images.length&&fresh.images.every((im,i)=>im.node===q.images[i].node)&&fresh.bindings.length===q.bindings.length&&fresh.bindings.every((b,i)=>['row','marker','content','icon'].every(k=>b[k]===q.bindings[i][k])&&doc.defaultView.getComputedStyle(b.row).pointerEvents!=='none');}catch{return false;}}
 function readCurrentAnswer(q){
  if(!checkWritable(q))throw Error('QUESTION_CHANGED：题目或选项已变化');
  const base='aloha-icon-'+(q.type==='multiple'?'duoxuan':'danxuan');
  const ids=q.bindings.filter(b=>{const chosen=b.row.classList.contains('is-choose'),active=b.icon.classList.contains(base+'-xuanzhong'),idle=b.icon.classList.contains(base);if(chosen!==active||active===idle)throw Error('ANSWER_STATE_CONFLICT：选项行与图标状态不一致');return chosen;}).map(b=>b.id);
  if(q.type!=='multiple'&&ids.length>1)throw Error('ANSWER_STATE_CONFLICT：单选或判断有多个选中值');
  return q.type==='judge'?(ids.length?ids[0]==='true':null):(ids.length?ids:null);
 }
 const guard=(q,signal)=>{signal.throwIfAborted();if(!checkWritable(q))throw Error('QUESTION_CHANGED：作业、题面或选项已变化');};
 async function stable(q,wanted,signal,ms){const deadline=Date.now()+1500;let since=null;for(;;){guard(q,signal);let matches=false;try{matches=sameAnswer(readCurrentAnswer(q),wanted,q.type);}catch(e){if(!e.message.startsWith('ANSWER_STATE_CONFLICT'))throw e;}const now=Date.now();if(matches){since??=now;if(now-since>=ms)return true;}else since=null;if(now>=deadline)return false;await wait(Math.min(40,deadline-now),signal);}}
 return{supportsSubjective:false,
  detectPage(){const identity={platform:'智慧树',scene:'AI教学中心作业（整页）',variant:'zhihuishu-ai-homework',limits:'仅此入口单选、多选、判断；平台保存未确认；不自动提交'};try{const ctx=currentContext();return{...identity,supported:true,paperKey:key,count:ctx.total};}catch(e){return{...identity,supported:false,reason:e.message};}},
  findQuestions(){return currentContext().roots;},extractQuestion,checkWritable,readCurrentAnswer,
  async writeAnswer(q,answer,signal){
   guard(q,signal);if(answer.type!==q.type||answer.questionId&&answer.questionId!==q.id)throw Error('ANSWER_IDENTITY：答案题型或题目标识不匹配');
   const wanted=q.type==='judge'?(typeof answer.booleanValue==='boolean'?[String(answer.booleanValue)]:[]):answer.optionIds;
   if(!Array.isArray(wanted)||!wanted.length||new Set(wanted).size!==wanted.length||q.type!=='multiple'&&wanted.length!==1||wanted.some(id=>!q.options.some(o=>o.id===id)))throw Error('ANSWER_OPTIONS：答案选项不合法');
   const old=readCurrentAnswer(q),planned=new Set(q.type==='judge'?(old===null?[]:[String(old)]):old||[]);
   if(q.type!=='multiple'){const target=q.bindings.find(b=>wanted.includes(b.id));if(!planned.has(target.id)){guard(q,signal);target.row.click();signal.throwIfAborted();}return;}
   for(const b of q.bindings){guard(q,signal);if(planned.has(b.id)===wanted.includes(b.id))continue;
    if(!sameAnswer(readCurrentAnswer(q),planned.size?[...planned]:null,q.type))throw Error('ANSWER_CHANGED：多选填写过程中原答案已变化');
    b.row.click();signal.throwIfAborted();if(wanted.includes(b.id))planned.add(b.id);else planned.delete(b.id);
    if(!await stable(q,planned.size?[...planned]:null,signal,50))throw Error('VERIFY_FAILED：多选单步未稳定接受，已停止后续勾选');
   }
  },
  verifyAnswer(q,answer,signal){return stable(q,expectedValue(answer),signal,200);},
  timer:()=>'未识别'
 };
}
