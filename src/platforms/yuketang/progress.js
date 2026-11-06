// Visible modal discovery never exempts the platform's hidden templates by class.
export function visibleDialogs(doc,visible){
 const found=[...doc.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],.el-dialog,.el-message-box,.homework-problem-change-guard-dialog,.homework-problem-blank-submit-dialog,.homework-problem-batch-submit-dialog')].filter(visible);
 return found;
}
const text=el=>(el?.textContent||'').replace(/\s+/g,'');
export function assertNoSubmissionDialog(doc,visible,allowedDialog=null){
 const dialogs=visibleDialogs(doc,visible);
 if(dialogs.length&&(dialogs.length!==1||dialogs[0]!==allowedDialog))throw Error('SUBMISSION_REQUIRED：出现未授权对话，请在页面人工处理；插件未提交');
}
export function readEmbeddedProgress(doc,{paperKey,current}){
 if(!Number.isInteger(current)||current<1)throw Error('PAGINATION_PROGRESS：正文题号无法确认');
 const result={kind:'single-paged',paperKey,current,total:null,visible:1,automaticNext:false,persistence:'unverified',navigation:'verified',localDraftSupported:true};
 const asides=[...doc.querySelectorAll('.problems-aside')];if(!asides.length)return result;if(asides.length!==1)throw Error('PAGINATION_PROGRESS：存在多个题目导航');
 const aside=asides[0],bars=[...aside.querySelectorAll('.aside-body--progress')],items=[...aside.querySelectorAll('.aside-body > .list-inline > .subject-item.J_order')];
 const match=bars.length===1?text(bars[0]).match(/^(\d+)\/(\d+)题$/):null;
 if(!match)throw Error('PAGINATION_PROGRESS：总题数结构未验证');const answered=Number(match[1]),total=Number(match[2]);
 if(total<1||total>1000||answered>total||items.length!==total)throw Error('PAGINATION_PROGRESS：导航数量或总题数不一致');
 const numbers=items.map(e=>Number([...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()));
 const active=items.filter(e=>e.classList.contains('active'));if(numbers.some((n,i)=>n!==i+1)||active.length!==1||numbers[items.indexOf(active[0])]!==current)throw Error('PAGINATION_PROGRESS：活动题号、顺序或正文题号不一致');
 return{...result,total,platformAnswered:answered};
}
