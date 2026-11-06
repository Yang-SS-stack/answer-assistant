// Manual confirmation/restoration has its own scope; a previous automatic run
// remains in the audit history, never in the current operation's progress.
export function applicationSnapshot(previous,application,manualResults){
 const done=application.state==='done',row=done?manualResults.get(application.questionId):null,results=row?[row]:[];
 const local=application.persistenceTarget==='extension-local',localDraftCount=results.filter(r=>r.localDraftSaved===true).length;
 const state={state:application.state,stage:done?'done':application.state==='stopped'?'wait':application.stage,
  questionId:application.questionId,mode:'single',executionScope:'current-question',total:1,completed:application.partialRestore?0:results.length,
  skipped:0,reviewPending:0,failed:application.state==='failed'?1:0,results,
  canSave:application.canSave===true,draftSaved:application.draftSaved===true,
  elapsedMs:application.elapsedMs??Date.now()-application.startedAt,error:application.error,application};
 if(application.partialRestore)state.partialRestore=true;
 if(previous.auditError)state.auditError=previous.auditError;
 if(local)Object.assign(state,{persistenceTarget:'extension-local',localDraftSaved:localDraftCount>0,localDraftCount});
 if(application.pageFlow?.kind==='single-paged')state.pageFlow={...application.pageFlow,automaticNext:false,reachedEnd:false,...(done?{stopReason:'single-question'}:{})};
 return state;
}
