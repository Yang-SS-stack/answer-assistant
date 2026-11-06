// Page-world bridge: no extension APIs, settings, credentials, requests or timers.
(()=>{if(globalThis.__aaV4EditorBridge)return;globalThis.__aaV4EditorBridge=true;
const plain=body=>(body.innerText||'').replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();
document.addEventListener('aa-v4-editor-write',event=>{
 let request,result;
 try{
  request=JSON.parse(event.detail);const {frameId,stem,oldText,text}=request;
  if(typeof text!=='string'||!text.trim()||text.length>50000)throw Error('EDITOR_TEXT_INVALID');
  const frame=document.getElementById(frameId),root=frame?.closest('.exercise-item');
  if(!root||!frame.matches('.ueditor-content iframe')||!root.isConnected||root.closest('[hidden]')||root.getClientRects().length===0)throw Error('EDITOR_CHANGED');
  if(root.querySelector('.item-body > h4')?.textContent!==stem)throw Error('QUESTION_CHANGED');
  const editors=Object.values(globalThis.UE?.instants||{}).filter(e=>e.iframe===frame);
  if(editors.length!==1)throw Error('EDITOR_UNVERIFIED');const editor=editors[0],holder=document.getElementById(editor.key),body=frame.contentDocument?.body;
  if(!editor.isReady||editor.body!==body||!holder?.contains(frame)||!body?.isContentEditable||plain(body)!==oldText)throw Error('EDITOR_CHANGED');
  const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=text;
  editor.setContent(pre.outerHTML);editor.fireEvent('contentchange');editor.fireEvent('blur');
  const ok=plain(body)===text.replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();
  result={token:request.token,ok,...(!ok?{error:'EDITOR_VERIFY_FAILED'}:{})};
 }catch(error){result={token:request?.token,ok:false,error:error.message};}
 document.dispatchEvent(new CustomEvent('aa-v4-editor-result',{detail:JSON.stringify(result)}));
});})();
