// One-way diagnostic output. Never read this attribute to authorize any action.
export function publishStatus(doc,state,version){
 const status={version,updatedAt:new Date().toISOString(),state:state.state,stage:state.stage,questionId:state.questionId,
  total:state.total,completed:state.completed||0,skipped:state.skipped||0,failed:state.failed||0,reviewPending:state.reviewPending||0,
  elapsedMs:state.elapsedMs||0,error:typeof state.error==='string'?state.error.slice(0,500):null,auditError:typeof state.auditError==='string'?state.auditError.slice(0,500):null};
 if(state.pageFlow?.kind==='single-paged'){const p=state.pageFlow;status.pageFlow={kind:p.kind,current:Number.isInteger(p.current)?p.current:null,total:Number.isInteger(p.total)?p.total:null,automaticNext:p.automaticNext===true,persistence:p.persistence==='verified'?'verified':'unverified',reachedEnd:p.reachedEnd===true};if(p.persistenceTarget==='extension-local'){status.pageFlow.persistenceTarget='extension-local';status.pageFlow.platformPersistence='unverified';}if(['review-pending','persistence-unverified','last-question','single-question','navigation-unverified','unsupported-input'].includes(p.stopReason))status.pageFlow.stopReason=p.stopReason;}
 if(state.persistenceTarget==='extension-local'){status.persistenceTarget='extension-local';status.localDraftSaved=state.localDraftSaved===true;status.localDraftCount=Number.isInteger(state.localDraftCount)?Math.max(0,Math.min(1000,state.localDraftCount)):0;}
 try{if(!doc.documentElement)return false;doc.documentElement.setAttribute('data-aa-v4-status',JSON.stringify(status));return true;}catch{return false;}
}
