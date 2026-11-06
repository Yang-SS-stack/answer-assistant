function resultMessage(state){
 if(state.state!=='done')return null;
 if(state.auditError)return '本次页面处理已结束，但本地记录保存失败，请保留页面并导出诊断检查；试卷未提交。';
 if(state.partialRestore)return '当前题的部分原生答案已恢复并验证；仍有空位未完成，请继续填写。未自动切题或提交。';
 if(state.reviewPending){const end=state.pageFlow?.reachedEnd?`本次已处理至最后一题（第 ${state.pageFlow.current} / ${state.pageFlow.total} 题）。`:'本次处理结束。';return end+`本轮填写 ${state.completed||0} 题，待复审 ${state.reviewPending} 题，跳过 ${state.skipped||0} 题。待复审题未自动填写；请在工作台核对，并返回对应题确认填写。试卷未提交。`;}
 if(state.failed)return '本次处理结束，仍有失败题目，请检查记录并手动处理；试卷未提交。';
 if(state.pageFlow?.stopReason==='unsupported-input')return '当前题的图片能力或编辑器尚未支持，已停留本题。请检查跳过原因；试卷未提交。';
 if(state.executionScope==='current-question'&&state.persistenceTarget==='extension-local')return state.completed?'当前题已填写并验证，请检查；未自动切题或提交。':'本次单题处理结束，未新增填写，请检查原答案与记录；未提交。';
 if(state.executionScope==='current-question')return state.completed?(state.draftSaved?'当前题已填写并验证，请检查；未自动切题或提交。':'当前题已填写并验证。独立暂存尚未验证，请保持当前题并检查保存状态；不会自动切题或提交。'):'当前题尚未完成，请检查记录；不会自动切题或提交。';
 if(state.executionScope==='paginated')return state.pageFlow?.reachedEnd?`本次已处理至最后一题（第 ${state.pageFlow.current} / ${state.pageFlow.total} 题），跳过 ${state.skipped||0} 题；请检查全部答案后手动提交试卷。`:'本次分页处理结束，请检查进度与答案；试卷未提交。';
 if(state.mode==='single')return '本次单题作答完成，请检查；其余题目仍需核对，试卷未提交。';
 if(state.skipped)return `本次处理结束，跳过 ${state.skipped} 题。请检查全部答案及跳过原因后手动提交试卷。`;
 if(!state.total||state.completed!==state.total)return '本次处理结束，尚未确认全部题目作答完成，请检查；试卷未提交。';
 return '作答完成，请检查后手动提交试卷。';
}
export function completionMessage(state){const message=resultMessage(state);if(!message)return null;if(state.persistenceTarget==='extension-local')return(state.localDraftSaved?`本机草稿已保存 ${state.localDraftCount||1} 项。`:'')+'平台保存未确认。'+message;return state.draftSaved?'草稿已保存。'+message:message;}
