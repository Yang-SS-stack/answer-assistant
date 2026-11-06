// Content visibility is stricter than navigation visibility: hidden templates and
// transparent source text must never become model input or editable blank mappings.
export function createContentView(){
 // Extraction is synchronous. Cache only within this projection, never between
 // task phases; each later writable/capture guard gets a fresh DOM observation.
 const styles=new WeakMap(),boxes=new WeakMap();
 function styleVisible(el){
  if(!el||el.nodeType!==1)return true;
  if(styles.has(el))return styles.get(el);
  const s=el.ownerDocument.defaultView.getComputedStyle(el),shown=!el.hidden&&s.display!=='none'&&!['hidden','collapse'].includes(s.visibility)&&Number(s.opacity)!==0&&styleVisible(el.parentElement);
  styles.set(el,shown);return shown;
 }
 function visible(el){
  if(!el?.isConnected||!styleVisible(el))return false;
  if(!boxes.has(el)){const rects=[...el.getClientRects()];boxes.set(el,el.tagName==='BR'?rects.length>0:rects.some(r=>r.width>0&&r.height>0));}
  return boxes.get(el);
 }
 function clone(root){
  if(!visible(root))return null;
  const copy=root.cloneNode(true),originals=[...root.querySelectorAll('*')],copies=[...copy.querySelectorAll('*')];
  originals.forEach((el,i)=>{if(!visible(el))copies[i].remove();});return copy;
 }
 const images=root=>[...root.querySelectorAll('img')].filter(visible);
 function hasContent(root){
  const copy=clone(root);if(!copy)return false;
  copy.querySelectorAll('input,textarea,select,button,[contenteditable],iframe').forEach(el=>el.remove());
  if((copy.textContent||'').trim())return true;
  if([...copy.querySelectorAll('[data-latex]')].some(el=>(el.getAttribute('data-latex')||'').trim()))return true;
  return images(root).some(im=>(im.getAttribute('src')||'').trim()||(im.getAttribute('srcset')||'').trim());
 }
 return{visible,clone,images,hasContent};
}
export const contentVisible=el=>createContentView().visible(el);
export const cloneVisibleContent=root=>createContentView().clone(root);
export const visibleContentImages=root=>createContentView().images(root);
export const hasVisibleQuestionContent=root=>createContentView().hasContent(root);
// A URL identifies bytes, not an occurrence. The same formula may occur in
// several options. Keep a non-serializable local binding outside exported data.
export function bindImageNode(node,descriptor){Object.defineProperty(descriptor,'node',{value:node,enumerable:false});return descriptor;}
