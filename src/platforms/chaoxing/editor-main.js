// Page-world bridge: only the observed question editor and native draft-save API.
// No extension APIs, settings, credentials, raw requests or submit invocation.
(()=>{if(globalThis.__aaV4ChaoxingBridge)return;globalThis.__aaV4ChaoxingBridge=true;
 const plain=body=>(body.innerText||'').replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();
 document.addEventListener('aa-v4-cx-command',event=>{
  let request;const reply=(ok,error)=>document.dispatchEvent(new CustomEvent('aa-v4-cx-result',{detail:JSON.stringify({token:request?.token,ok,...(error?{error}:{})})}));
  try{
   request=JSON.parse(event.detail);const form=document.querySelector('form#submitForm');if(!form||document.querySelectorAll('form#submitForm').length!==1||form.closest('[hidden]')||!form.getClientRects().length)throw Error('QUESTION_CHANGED');
   if(request.action==='save'){
    const controls=[...document.querySelectorAll('a[onclick]')].filter(e=>e.textContent.trim()==='暂时保存'&&e.getAttribute('onclick').trim()==='saveWork();'&&e.getClientRects().length>0&&!e.closest('[hidden]'));
    if(controls.length!==1||typeof globalThis.saveWork!=='function')throw Error('DRAFT_CONTROL_UNVERIFIED');
    globalThis.saveWork({success:data=>reply(data?.status===true,data?.status===true?undefined:'DRAFT_SAVE_FAILED'),failure:()=>reply(false,'DRAFT_SAVE_FAILED：平台未确认草稿保存')});return;
   }
   if(request.action!=='write')throw Error('EDITOR_COMMAND_INVALID');
   const {questionId,frameId,key,oldText,oldSerialized,text}=request;if(typeof text!=='string'||!text.trim()||text.length>30000)throw Error('EDITOR_TEXT_INVALID');
   const root=document.getElementById(questionId),frame=document.getElementById(frameId),area=document.getElementById(key),id=root?.getAttribute('data');
   if(!/^\d+$/.test(id)||questionId!=='question'+id||key!=='answerEditor'+id+'1'||!root?.matches('.questionLi[typename="填空题"]')||!form.contains(root)||!root.contains(frame)||!root.contains(area)||root.querySelectorAll('iframe').length!==1||root.querySelectorAll('textarea').length!==1||area?.tagName!=='TEXTAREA'||area.name!==key||frame.closest('.Answer')!==area.closest('.Answer')||!area.closest('.Answer')||root.closest('[hidden]')||!root.getClientRects().length)throw Error('EDITOR_CHANGED');
   const editors=Object.values(globalThis.UE?.instants||{}).filter(e=>e.key===key&&e.iframe===frame),body=frame.contentDocument?.body;
   if(editors.length!==1)throw Error('EDITOR_UNVERIFIED');const editor=editors[0];
   if(!editor.isReady||editor.body!==body||!body?.isContentEditable||plain(body)!==oldText||area.value!==oldSerialized||typeof editor.sync!=='function')throw Error('EDITOR_CHANGED');
   const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=text;editor.setContent(pre.outerHTML);editor.fireEvent('contentchange');editor.sync();editor.fireEvent('blur');
   for(const el of [body,area])for(const type of ['input','change'])el.dispatchEvent(new Event(type,{bubbles:true}));
   const saved=document.createElement('div');saved.innerHTML=area.value;saved.querySelectorAll('script,style').forEach(e=>e.remove());saved.querySelectorAll('br').forEach(e=>e.replaceWith(document.createTextNode('\n')));
   const expected=text.replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();
   if(plain(body)!==expected||saved.textContent.replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim()!==expected)throw Error('EDITOR_SYNC_FAILED：可见答案与表单字段未同时接受文本');
   reply(true);
  }catch(error){reply(false,error.message);}
 });
})();
