export function showCompletionNotice(doc,message){
 doc.getElementById('aa-v4-completion')?.remove();if(!message)return;
 const panel=doc.createElement('aside');panel.id='aa-v4-completion';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
 panel.style.cssText='position:fixed;right:24px;bottom:24px;z-index:2147483647;max-width:min(380px,80vw);padding:20px;background:white;color:#182126;border:2px solid #066e71;border-radius:6px;box-shadow:0 4px 24px #0002;font:14px/1.6 sans-serif';
 const title=doc.createElement('strong');title.textContent='自动答题 · 处理结果';const body=doc.createElement('p');body.textContent=message;
 const close=doc.createElement('button');close.type='button';close.textContent='我已知晓';close.onclick=()=>panel.remove();panel.append(title,body,close);doc.body.append(panel);
}
