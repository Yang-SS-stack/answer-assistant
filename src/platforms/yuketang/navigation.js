import {sameAnswer} from '../../core/answers.js';
import {wait} from '../../core/runner.js';
import {visibleDialogs} from './progress.js';
const text=el=>(el?.textContent||'').replace(/\u00a0/g,' ').trim();
const message='刚刚答完的习题还没有提交，需要提交吗？';
const fail=reason=>{throw Error('PAGINATION_NAVIGATION：'+reason);};
class IncomingPending extends Error{}
const notReady=reason=>{throw new IncomingPending(reason);};
const transientShape=error=>/^(STEM_MISSING|OPTIONS_INVALID|JUDGE_MAPPING|BLANK_MAPPING|CONTROLS_UNSUPPORTED|VISUAL_OPTION_MAPPING|PAGINATION_PROGRESS|PAGINATION_CONTAINER|CONTAINER|ANSWER_STATE_CONFLICT)(：|$)/.test(error?.message||'');
function declineDialog(doc,visible){
 const dialogs=visibleDialogs(doc,visible);if(!dialogs.length)return null;
 if(dialogs.length!==1)fail('存在多个对话');const dialog=dialogs[0];
 if(!dialog.matches('.el-dialog.homework-problem-change-guard-dialog[role="dialog"]'))fail('未知对话');
 if(dialog.querySelector('button,a,input,form,[contenteditable]')||dialog.querySelectorAll('.rain-btn').length!==2)fail('提示操作结构已变化');
 const footers=dialog.querySelectorAll(':scope > .el-dialog__footer');if(footers.length!==1)fail('提示按钮结构已变化');
 const buttons=[...footers[0].children];
 if(buttons.length!==2||buttons.some(e=>!e.matches('div.rain-btn')||!visible(e)))fail('提示按钮结构已变化');
 const declines=buttons.filter(e=>text(e)==='先不用了'),primary=buttons.filter(e=>e.matches('.homework-problem-change-guard__primary-action.type-1')&&text(e)==='帮我提交');
 if(declines.length!==1||primary.length!==1)fail('拒绝按钮无法唯一确认');const decline=declines[0];
 if(!decline.matches('.type-3')||decline.matches('.homework-problem-change-guard__primary-action,.type-1')||decline.querySelector('button,a,input,form')||decline.getAttribute('aria-disabled')==='true')fail('拒绝按钮形态已变化');
 const clone=dialog.cloneNode(true);clone.querySelector('.el-dialog__footer').remove();
 if(text(clone)!==message)fail('提示文案不在白名单');
 return{dialog,decline};
}
function nextButton(doc,visible){
 const bars=[...doc.querySelectorAll('.problem-fixedbar')].filter(visible);if(bars.length!==1)fail('需要唯一固定导航栏');
 const rights=[...bars[0].querySelectorAll('.text-right')].filter(visible);if(rights.length!==1)fail('下一题导航结构已变化');
 const buttons=[...rights[0].querySelectorAll('button')].filter(visible);
 if(buttons.length!==1)fail('需要唯一下一题按钮');const button=buttons[0];
 if(text(button)!=='下一题'||button.getAttribute('type')!=='button'||!button.matches('.el-button.el-button--text')||button.matches('.el-button--primary,.is-disabled')||button.disabled||button.getAttribute('aria-disabled')==='true'||button.closest('form')||button.querySelector('a,input,button'))fail('下一题按钮未验证');
 return button;
}
// Modal exceptions are scoped to this closure and never exposed through adapter APIs.
export function createNavigation({getContext,getIdentityContext,roots,extract,checkWritable,readAnswer,readProgress,visible}){
 let pending=null,running=false;
 const sameProgress=(a,b)=>a.paperKey===b.paperKey&&a.current===b.current&&a.total===b.total;
 const signalCheck=signal=>{if(!signal||typeof signal.throwIfAborted!=='function')fail('缺少停止信号');signal.throwIfAborted();};
 function oldQuestion(state,signal,allowed=null){
  signalCheck(signal);const ctx=getContext(allowed);
  if(ctx.frame!==state.q.frame||ctx.inner!==state.q.frameDocument)fail('作业 iframe 或文档已变化');
  if(!sameProgress(readProgress(allowed),state.before))fail('当前题号、总数或作业身份已变化');
  let current=state.promptQuestion||state.q;
  if(!checkWritable(current,allowed)){
   // Only the exact validated no-submit prompt permits a semantically identical
   // framework rebuild. No answer write or second next click uses these nodes.
   if(!allowed)fail('当前题或原生控件身份已变化，且不在已验证的不提交提示中');
   const found=roots(ctx);if(found.length!==1)fail('提示期间当前题正文未唯一就绪');
   const fresh=extract(found[0],allowed),old=state.q;
   if(fresh.id!==old.id||fresh.signature!==old.signature||fresh.contentFingerprint!==old.contentFingerprint||fresh.type!==old.type||fresh.number!==old.number)fail('提示期间题目内容、题型或映射已变化');
   if(!checkWritable(fresh,allowed))fail('提示期间重建的原生控件仍未通过身份校验');
   current=fresh;
  }
  if(!sameAnswer(readAnswer(current),state.answer,state.q.type))fail('当前答案已变化，未拒绝提示或继续翻页');
  const next=nextButton(ctx.inner,visible);
  if(next!==state.next&&!allowed)fail('下一题导航控件已变化，且不在已验证的不提交提示中');
  if(allowed){state.promptQuestion=current;state.next=next;}
  signalCheck(signal);return ctx;
 }
 function newQuestion(state,signal){
  signalCheck(signal);const ctx=getContext();
  if(ctx.frame!==state.q.frame||ctx.inner!==state.q.frameDocument||!visible(ctx.frame))fail('iframe 已变化');
  let p;try{p=readProgress();}catch(error){if(transientShape(error))notReady('下一题进度渲染未就绪');throw error;}
  if(p.paperKey!==state.before.paperKey||p.total!==state.before.total||p.current!==state.before.current+1)fail('下一题号、总数或作业身份不符合预期');
  const found=roots(ctx);if(found.length!==1)notReady('下一题正文未唯一就绪');let q;
  try{q=extract(found[0]);}catch(error){if(transientShape(error))notReady('下一题结构尚未就绪：'+error.message.slice(0,120));throw error;}
  if(q.id===state.q.id||q.signature===state.q.signature||!q.contentFingerprint||q.contentFingerprint===state.q.contentFingerprint||Number(q.number)!==p.current||!checkWritable(q))notReady('下一题正文或控件未就绪');signalCheck(signal);return q;
 }
 function incomingSample(state,signal){
  const q=newQuestion(state,signal),doc=q.frameDocument;
  // Intrinsic-size images may initially have zero layout bounds and therefore
  // be absent from the extraction. Wait for visible-source assets before binding.
  for(const image of q.element.querySelectorAll('img')){
   if(!(image.getAttribute('src')||image.getAttribute('srcset')||'').trim())continue;
   let shown=true;for(let n=image;n;n=n.parentElement){const s=doc.defaultView.getComputedStyle(n);if(n.hidden||s.display==='none'||['hidden','collapse'].includes(s.visibility)||Number(s.opacity)===0){shown=false;break;}}
   if(shown&&(!image.complete||!image.naturalWidth||!image.naturalHeight))notReady('下一题图片尚未可靠加载');
  }
  let answer;try{answer=structuredClone(readAnswer(q));}catch(error){if(transientShape(error))notReady('下一题原生答案与框架状态尚未一致');throw error;}
  signalCheck(signal);return{q,answer};
 }
 function changedIncoming(a,b){
  if(a.q.element!==b.q.element)return'题目节点重建';
  if(a.q.signature!==b.q.signature||a.q.contentFingerprint!==b.q.contentFingerprint)return'题面仍在更新';
  if(a.q.controls.length!==b.q.controls.length||a.q.controls.some((el,i)=>el!==b.q.controls[i]))return'原生控件重建';
  if(!sameAnswer(a.answer,b.answer,b.q.type))return'已有答案仍在恢复';return'';
 }
 return{
  kind:'single-paged',persistence:'unverified',navigation:'verified',localDraftSupported:true,
  readProgress(signal){signal?.throwIfAborted();const p=readProgress();signal?.throwIfAborted();return p;},
  async advance(q,before,signal){
   signalCheck(signal);if(running)fail('导航正在执行');pending=null;running=true;
   try{
    const ctx=getContext(),state={q,before:{...before},answer:structuredClone(readAnswer(q)),next:nextButton(ctx.inner,visible)};
    if(!Number.isInteger(before.total)||before.current>=before.total)fail('末题或总数未验证，禁止下一题');
    oldQuestion(state,signal);state.next.click();signalCheck(signal);
    const deadline=Date.now()+3000;let declined=false;
    while(Date.now()<deadline){
     // Waiting allows STOP and delayed platform mutations to settle before any decline click.
     await wait(40,signal);signalCheck(signal);
     const base=getIdentityContext(),prompt=declineDialog(base.inner,visible);
     if(prompt){
      if(declined)fail('拒绝后再次出现提示');oldQuestion(state,signal,prompt.dialog);
      const fresh=declineDialog(base.inner,visible);if(fresh?.dialog!==prompt.dialog||fresh?.decline!==prompt.decline)fail('提示控件已变化');
      signalCheck(signal);prompt.decline.click();declined=true;signalCheck(signal);continue;
     }
     let p;try{p=readProgress();}catch(error){if(transientShape(error))continue;throw error;}
     if(p.paperKey!==before.paperKey||p.total!==before.total||p.current<before.current||p.current>before.current+1)fail('等待下一题期间作业、总数或题号异常');
     if(p.current===before.current)continue;
     try{const next=newQuestion(state,signal);pending={state,next};return true;}catch(error){if(error instanceof IncomingPending)continue;throw error;}
    }
    fail('等待下一题超时，未重试');
   }catch(error){pending=null;throw error;}finally{running=false;}
  },
  async verifyTransition(before,signal){
   signalCheck(signal);const saved=pending;pending=null;if(!saved||!sameProgress(before,saved.state.before))fail('缺少对应的导航记录');
   // The first successful extraction is provisional. A framework can patch its
   // children, restore an old answer or load a formula after the active number
   // changes. Bind only after a continuous stable window; no write/request/click
   // happens here, and an unstable target has a finite deadline.
   const deadline=Date.now()+3000;let candidate=null,stableSince=0,lastReason='下一题尚未稳定';
   while(Date.now()<deadline){
    await wait(40,signal);signalCheck(signal);
    try{
     const sample=incomingSample(saved.state,signal),now=Date.now(),change=candidate?changedIncoming(candidate,sample):'初次读取下一题';
     if(change){candidate=sample;stableSince=now;lastReason=change;continue;}
     if(now-stableSince>=200){signalCheck(signal);return true;}
    }catch(error){if(!(error instanceof IncomingPending))throw error;candidate=null;stableSince=0;lastReason=error.message;}
   }
   fail('下一题未稳定就绪，未继续：'+lastReason);
  }
 };
}
