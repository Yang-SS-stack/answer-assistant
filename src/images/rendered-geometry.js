// Geometry only. The background owns screenshots; no scrolling or page mutation here.
const PAD=8,EPS=.25,MAX_PIXELS=16000000;
const fail=message=>{throw Error('RENDERED_GEOMETRY：'+message);};
const names=value=>value.split(',').map(part=>part.trim().replace(/^['"]|['"]$/g,'').toLowerCase());
const box=rect=>({x:rect.left,y:rect.top,width:rect.width,height:rect.height});
const right=r=>r.x+r.width,bottom=r=>r.y+r.height;
const inside=(r,c)=>r.x>=c.x-EPS&&r.y>=c.y-EPS&&right(r)<=right(c)+EPS&&bottom(r)<=bottom(c)+EPS;
const intersects=(a,b)=>a.x<right(b)&&right(a)>b.x&&a.y<bottom(b)&&bottom(a)>b.y;
function shown(el){
 if(!el?.isConnected)return false;const own=el.ownerDocument.defaultView.getComputedStyle(el);if(['hidden','collapse'].includes(own.visibility))return false;
 for(let node=el;node?.nodeType===1;node=node.parentElement){const style=node.ownerDocument.defaultView.getComputedStyle(node);if(node.hidden||style.display==='none'||Number(style.opacity)===0)return false;}
 return true;
}
function viewport(doc){const win=doc.defaultView;return{width:Math.min(win.innerWidth,doc.documentElement.clientWidth||win.innerWidth),height:Math.min(win.innerHeight,doc.documentElement.clientHeight||win.innerHeight)};}
// These effects are absent from getBoundingClientRect / transform matrix proofs.
const expandedPaint=s=>s.borderImageSource&&s.borderImageSource!=='none'||s.webkitBoxReflect&&s.webkitBoxReflect!=='none';
const alternateGeometry=s=>s.offsetPath&&s.offsetPath!=='none'||s.zoom&&Number(s.zoom)!==1;
// Hit-testing omits pointer-events:none. Treat visible paint from an unrelated
// element as an obstruction even when its stacking order cannot be proven.
function painted(style,el,pseudo=false){
 const color=value=>value&&value!=='transparent'&&!/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(value);
 return expandedPaint(style)||pseudo&&style.display==='list-item'||color(style.backgroundColor)||style.backgroundImage!=='none'||style.boxShadow!=='none'||style.textShadow!=='none'||['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none'&&color(style['border'+side+'Color']))||parseFloat(style.outlineWidth)>0&&style.outlineStyle!=='none'&&color(style.outlineColor)||!pseudo&&(['IMG','SVG','CANVAS','VIDEO','IFRAME','OBJECT','EMBED','INPUT','TEXTAREA','SELECT','BUTTON'].includes(el.tagName)||[...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim()));
}
function points(r){const inset=Math.min(.5,r.width/4,r.height/4);return[[r.x+inset,r.y+inset],[right(r)-inset,r.y+inset],[r.x+inset,bottom(r)-inset],[right(r)-inset,bottom(r)-inset],[r.x+r.width/2,r.y+r.height/2]];}
export async function prepareRenderedGeometry(q,{signal,isCurrent}={}){
 if(!signal||typeof isCurrent!=='function')fail('缺少停止信号或当前题校验');
 const deadline=new AbortController(),combined=AbortSignal.any([signal,deadline.signal]),timer=setTimeout(()=>deadline.abort(Error('RENDERED_GEOMETRY_TIMEOUT：等待字体或图片超时')),5000);
 const frame=q?.frame,doc=q?.frameDocument,topDoc=frame?.ownerDocument,win=doc?.defaultView,topWin=topDoc?.defaultView;
 const guard=()=>{
  combined.throwIfAborted();if(q?.visualInput?.kind!=='rendered-question'||!q.id||!q.signature||!q.element?.isConnected||q.element.ownerDocument!==doc||!frame?.isConnected||frame.contentDocument!==doc||doc?.defaultView?.frameElement!==frame||topWin!==topWin?.top||!shown(frame)||isCurrent()!==true)fail('题目、iframe 或任务已变化');combined.throwIfAborted();
 };
 async function checked(promise){
  guard();let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason);combined.addEventListener('abort',abort,{once:true});});
  try{const result=await Promise.race([promise,stopped]);guard();return result;}finally{combined.removeEventListener('abort',abort);}
 }
 function assertAncestors(el,rect,seen,sourceBox=false){
  for(let node=el;node?.nodeType===1;node=node.parentElement){
   const s=node.ownerDocument.defaultView.getComputedStyle(node);
   if(!seen.has(node)){
    if(alternateGeometry(s)||s.transform!=='none'||s.perspective!=='none'||['translate','rotate','scale'].some(key=>s[key]&&s[key]!=='none')||s.clipPath!=='none'||s.filter!=='none')fail('存在不支持的变换或裁剪效果');seen.add(node);
   }
   // The border box of an input/image/SVG is not clipped by its own content
   // viewport. Parent clips and every transform check still apply.
   if(!(sourceBox&&node===el)&&(['auto','scroll','hidden','clip'].includes(s.overflowX)||['auto','scroll','hidden','clip'].includes(s.overflowY))){
    const r=node.getBoundingClientRect(),clip={x:r.left+node.clientLeft,y:r.top+node.clientTop,width:node.clientWidth,height:node.clientHeight};
    if((['auto','scroll','hidden','clip'].includes(s.overflowX)&&(rect.x<clip.x-EPS||right(rect)>right(clip)+EPS))||(['auto','scroll','hidden','clip'].includes(s.overflowY)&&(rect.y<clip.y-EPS||bottom(rect)>bottom(clip)+EPS)))fail('题目被滚动容器裁剪，请人工调整至完整可见');
   }
  }
 }
 // Padding is optional; source text/image bounds are not. Intersect only the
 // padded crop with common viewport/scroll clips, then require all raw entries.
 function paddedCrop(rect,el,entries){
  let x=Math.max(0,rect.x),y=Math.max(0,rect.y),r=Math.min(viewport(el.ownerDocument).width,right(rect)),b=Math.min(viewport(el.ownerDocument).height,bottom(rect));
  // Optional padding must not collect a neighboring navigation row. Restrict it
  // to the question/frame box only when every actual source entry stays inside.
  const own=box(el.getBoundingClientRect());if(entries.every(entry=>inside(entry,own))){x=Math.max(x,own.x);y=Math.max(y,own.y);r=Math.min(r,right(own));b=Math.min(b,bottom(own));}
  for(let n=el;n;n=n.parentElement){const s=n.ownerDocument.defaultView.getComputedStyle(n),c=n.getBoundingClientRect();if(['auto','scroll','hidden','clip'].includes(s.overflowX)){x=Math.max(x,c.left+n.clientLeft);r=Math.min(r,c.left+n.clientLeft+n.clientWidth);}if(['auto','scroll','hidden','clip'].includes(s.overflowY)){y=Math.max(y,c.top+n.clientTop);b=Math.min(b,c.top+n.clientTop+n.clientHeight);}}
  const clipped={x,y,width:r-x,height:b-y};if(r<=x||b<=y||entries.some(entry=>!inside(entry,clipped)))fail('题目实际内容超出可见范围，请人工调整至完整可见');return clipped;
 }
 // Native radio dots and checkbox ticks use the same proof: empty generated
 // paint, a bound native option, no unbounded effects, and every transformed
 // border-box corner inside the control. This also covers collapsed/intermediate
 // 2D selection transitions without assuming scaleY(0) means no paint.
 function boundedControlPaint(el,pseudo,p,style){
  const kind=q.type==='multiple'?'checkbox':['single','judge'].includes(q.type)?'radio':null;
  if(!kind||!['::before','::after'].includes(pseudo)||el.ownerDocument!==doc||!el.matches('span.el-'+kind+'__inner')||el.childNodes.length||style.position!=='relative'||p.position!=='absolute'||p.display!=='block'||!['""',"''"].includes(p.content))return false;
  const label=el.closest('label.el-'+kind),input=label?.querySelector('input');
  if(!q.labels?.includes(label)||!q.controls?.includes(input)||input.type!==kind||!el.parentElement?.matches('.el-'+kind+'__input')||input.parentElement!==el.parentElement)return false;
  const sides=['Top','Right','Bottom','Left'];
  if(expandedPaint(p)||alternateGeometry(p)||p.backgroundImage!=='none'||p.boxShadow!=='none'||p.textShadow!=='none'||p.filter!=='none'||p.backdropFilter!=='none'||p.outlineStyle!=='none'||p.mixBlendMode!=='normal'||p.clipPath!=='none'||p.perspective!=='none'||['translate','rotate','scale'].some(k=>p[k]&&p[k]!=='none'))return false;
  if(sides.some(side=>!Number.isFinite(parseFloat(p['border'+side+'Width']))||parseFloat(p['border'+side+'Width'])>2||parseFloat(p['padding'+side])!==0||parseFloat(p['margin'+side])!==0))return false;
  const r=el.getBoundingClientRect(),width=parseFloat(p.width),height=parseFloat(p.height),left=parseFloat(p.left),top=parseFloat(p.top);
  if(![r.width,r.height,width,height,left,top].every(Number.isFinite)||r.width>24||r.height>24||r.width<=0||r.height<=0||width<=0||height<=0)return false;
  const bw=width+(p.boxSizing==='border-box'?0:parseFloat(p.borderLeftWidth)+parseFloat(p.borderRightWidth)),bh=height+(p.boxSizing==='border-box'?0:parseFloat(p.borderTopWidth)+parseFloat(p.borderBottomWidth));
  if(bw>14||bh>14)return false;
  const m=new win.DOMMatrixReadOnly(p.transform==='none'?undefined:p.transform),[ox,oy]=p.transformOrigin.split(' ').map(parseFloat);
  if(!m.is2D||![ox,oy,m.a,m.b,m.c,m.d,m.e,m.f].every(Number.isFinite))return false;
  for(const [x,y]of [[0,0],[bw,0],[0,bh],[bw,bh]]){
   const px=left+ox+m.a*(x-ox)+m.c*(y-oy)+m.e,py=top+oy+m.b*(x-ox)+m.d*(y-oy)+m.f;
   if(px<0||py<0||px>el.clientWidth||py>el.clientHeight)return false;
  }
  // Ancestor clipping can only remove this decorative paint; unlike source
  // text/images it need not be fully visible. Ancestor transforms/effects could
  // expand or relocate it, so they still invalidate the local containment proof.
  for(let n=el;n;n=n.parentElement){const s=n.ownerDocument.defaultView.getComputedStyle(n);if(alternateGeometry(s)||s.transform!=='none'||s.perspective!=='none'||s.filter!=='none'||s.backdropFilter!=='none'||s.clipPath!=='none'||['translate','rotate','scale'].some(k=>s[k]&&s[k]!=='none'))return false;}
  return true;
 }
 // Permit only measured remote paint or the observed clipped question-header bar.
 // Host bounds alone cannot constrain absolute, relative or negative-margin paint.
 function boundedDecoration(el,pseudo,p,s,rect){
  const empty=['""',"''"].includes(p.content),sides=['Top','Right','Bottom','Left'];
  if(expandedPaint(p)||alternateGeometry(p)||p.display==='list-item'||p.boxShadow!=='none'||p.textShadow!=='none'||p.backgroundImage!=='none'||p.filter!=='none'||p.backdropFilter!=='none'||p.outlineStyle!=='none'||p.transform!=='none'||p.perspective!=='none'||['translate','rotate','scale'].some(k=>p[k]&&p[k]!=='none')||p.mixBlendMode!=='normal')return false;
  const margins=sides.map(k=>parseFloat(p['margin'+k]));if(!margins.every(v=>Number.isFinite(v)&&v>=0&&v<=32))return false;
  let unitFlip=false;
  for(let n=el;n;n=n.parentElement){const c=n.ownerDocument.defaultView.getComputedStyle(n);if(c.transform!=='none'){
   // A unit 180-degree host rotation preserves distances. Its actual projected
   // host bounds plus the measured glyph overhang remain a conservative envelope.
   if(!c.transform.startsWith('matrix('))return false;const m=new n.ownerDocument.defaultView.DOMMatrixReadOnly(c.transform);
   if(!m.is2D||m.a!==-1||m.d!==-1||m.b!==0||m.c!==0||m.e!==0||m.f!==0)return false;unitFlip=true;
  }if(alternateGeometry(c)||c.perspective!=='none'||c.filter!=='none'||c.backdropFilter!=='none'||['translate','rotate','scale'].some(k=>c[k]&&c[k]!=='none'))return false;}
  const width=parseFloat(p.width),height=parseFloat(p.height),r=box(el.getBoundingClientRect());
  if(!unitFlip&&el.ownerDocument===doc&&el.parentElement===q.element&&el.matches('.item-type')&&pseudo==='::before'&&empty&&p.position==='static'&&p.display==='block'&&s.display==='flex'&&s.overflowX==='hidden'&&s.overflowY==='hidden'&&width>0&&width<=4&&height>0&&height<=16&&height<=el.clientHeight&&r.height<=28&&sides.every(k=>parseFloat(p['border'+k+'Width'])===0&&parseFloat(p['padding'+k])===0))return true;
  if(!unitFlip&&p.position==='absolute'&&empty&&Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0){
   let cb=el;while(cb&&cb.ownerDocument.defaultView.getComputedStyle(cb).position==='static')cb=cb.parentElement;if(!cb)return false;
   const b=box(cb.getBoundingClientRect()),[mt,mr,mb,ml]=margins,bw=width+(p.boxSizing==='border-box'?0:parseFloat(p.borderLeftWidth)+parseFloat(p.borderRightWidth)+parseFloat(p.paddingLeft)+parseFloat(p.paddingRight)),bh=height+(p.boxSizing==='border-box'?0:parseFloat(p.borderTopWidth)+parseFloat(p.borderBottomWidth)+parseFloat(p.paddingTop)+parseFloat(p.paddingBottom));
   const left=parseFloat(p.left),top=parseFloat(p.top),rr=parseFloat(p.right),bb=parseFloat(p.bottom),x=Number.isFinite(left)?left+ml:cb.clientWidth-rr-bw-mr,y=Number.isFinite(top)?top+mt:cb.clientHeight-bb-bh-mb;
   if(![x,y,bw,bh].every(Number.isFinite))return false;
   return !intersects({x:b.x+cb.clientLeft+x-cb.scrollLeft,y:b.y+cb.clientTop+y-cb.scrollTop,width:bw,height:bh},rect);
  }
  // Static inline icon text: measure glyph overhang and add a full line/font pad.
  // No estimates based solely on a small host or on a model's name are accepted.
  if(p.position!=='static'||!['inline','inline-block'].includes(p.display)||!/^"[^"\\]*"$/.test(p.content)||painted(p,el,true)||!['normal','0px'].includes(p.letterSpacing)||!['normal','0px'].includes(p.wordSpacing)||p.writingMode!=='horizontal-tb'||sides.some(k=>parseFloat(p['border'+k+'Width'])!==0||parseFloat(p['padding'+k])!==0))return false;
  const text=p.content.slice(1,-1),size=parseFloat(p.fontSize),line=parseFloat(p.lineHeight);if(!text||[...text].length>4||!Number.isFinite(size)||size>24||!Number.isFinite(line)||line>32||!el.ownerDocument.fonts.check(p.font,text))return false;
  const ctx=new OffscreenCanvas(1,1).getContext('2d');ctx.font=p.font;const m=ctx.measureText(text),pad=Math.ceil(Math.max(size,line,m.width,Math.abs(m.actualBoundingBoxLeft),Math.abs(m.actualBoundingBoxRight),m.actualBoundingBoxAscent,m.actualBoundingBoxDescent)+Math.max(...margins));
  return Number.isFinite(pad)&&!intersects({x:r.x-pad,y:r.y-pad,width:r.width+2*pad,height:r.height+2*pad},rect);
 }
 // Outset shadows are clipped out of their own border-box interior. Permit
 // only an actual enclosing ancestor with the entire crop inside its straight
 // interior; descendants (including native controls) and inset paint still stop.
 function enclosingOutset(el,s,rect){
  if(el===q.element||el===frame||!(el.ownerDocument===doc?el.contains(q.element):el.contains(frame))||/\binset\b/i.test(s.boxShadow))return false;
  const r=box(el.getBoundingClientRect());let radius=0;
  for(const corner of ['TopLeft','TopRight','BottomLeft','BottomRight']){const parts=s['border'+corner+'Radius'].split(' ');for(const part of parts){if(!/^\d+(?:\.\d+)?(?:px|%)$/.test(part))return false;radius=Math.max(radius,parseFloat(part)*(part.endsWith('%')?Math.max(r.width,r.height)/100:1));}}
  const inset=radius+Math.max(...['Top','Right','Bottom','Left'].map(side=>parseFloat(s['border'+side+'Width'])));
  return Number.isFinite(inset)&&inside(rect,{x:r.x+inset,y:r.y+inset,width:r.width-2*inset,height:r.height-2*inset});
 }
 function unobstructed(document,rect,allowed){
  const probes=points(rect);
  // Also probe intersections with every unrelated visible element so small overlays
  // do not disappear between regularly spaced sample points.
  for(const el of document.querySelectorAll('html,body,body *')){
   if(!shown(el))continue;const style=document.defaultView.getComputedStyle(el);
   if(expandedPaint(style))fail('存在未验证的边框图像或反射绘制，无法验证整题截图');
   // Generated paint has no independent DOM bounds, including relative/static
   // negative-margin compositions. Refuse unsupported
   // composition rather than temporarily changing pointer-events to hit-test it.
   for(const pseudo of ['::before','::after']){const p=document.defaultView.getComputedStyle(el,pseudo);if(p.content!=='none'&&p.content!=='normal'&&p.display!=='none'&&p.visibility==='visible'&&Number(p.opacity)>0&&(painted(p,el,true)||!['""',"''"].includes(p.content))&&!boundedControlPaint(el,pseudo,p,style)&&!boundedDecoration(el,pseudo,p,style,rect))fail('存在未验证的伪元素绘制，无法验证整题截图 ['+el.tagName.toLowerCase()+'.'+String(el.getAttribute('class')||'').slice(0,80)+' '+pseudo+']');}
   if(allowed(el)){if(style.boxShadow!=='none'&&!enclosingOutset(el,style,rect)||style.textShadow!=='none'||style.filter!=='none'||style.backdropFilter!=='none')fail('题目存在未验证的阴影或滤镜绘制，无法验证整题截图');continue;}
   for(const raw of el.getClientRects()){const r=box(raw);if(r.width<=0||r.height<=0||!intersects(r,rect))continue;
    if(style.pointerEvents==='none'&&painted(style,el))fail('当前题可能被不可点击的界面遮挡，请人工处理后重试');
    const overlap={x:Math.max(r.x,rect.x),y:Math.max(r.y,rect.y),width:Math.min(right(r),right(rect))-Math.max(r.x,rect.x),height:Math.min(bottom(r),bottom(rect))-Math.max(r.y,rect.y)};probes.push(...points(overlap));}}
  for(let y=rect.y+1;y<bottom(rect);y+=40)for(let x=rect.x+1;x<right(rect);x+=40)probes.push([x,y]);
  if(probes.some(([x,y])=>{const hit=document.elementFromPoint(x,y);return !hit||!allowed(hit);}))fail('当前题被其他界面遮挡，请人工处理后重试');
 }
 function sample(images){
  guard();if(doc.fonts?.status!=='loaded')fail('字体仍在加载');const entries=[],seen=new Set(),families=new Set();
  const walker=doc.createTreeWalker(q.element,win.NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   if(!node.textContent.trim()||!shown(node.parentElement))continue;
   const computed=win.getComputedStyle(node.parentElement);if(node.parentElement.closest('.xuetangx-com-encrypted-font')&&!names(computed.fontFamily).includes('exam-data-decrypt-font'))fail('加密字体样式未就绪，不能截图提交给模型');names(computed.fontFamily).forEach(name=>families.add(name));
   if(!doc.fonts.check(computed.font,node.textContent))fail('当前文字所需字体尚未加载');
   const range=doc.createRange();range.setStart(node,node.textContent.search(/\S/));range.setEnd(node,node.textContent.search(/\s*$/));
   for(const raw of range.getClientRects()){if(raw.width<=0||raw.height<=0)continue;const rect=box(raw);assertAncestors(node.parentElement,rect,seen);entries.push(rect);}
  }
  const semanticIcons=q.type==='judge'?(q.labels||[]).flatMap(label=>[...label.querySelectorAll('.radioInput svg')]):[];
  for(const el of [...images,...q.element.querySelectorAll('input[type="text"],textarea'),...semanticIcons]){if(!shown(el))continue;const rect=box(el.getBoundingClientRect());if(rect.width<=0||rect.height<=0)fail('题内图片、输入框或判断图标不可见');assertAncestors(el,rect,seen,true);entries.push(rect);}
  if(!entries.length)fail('没有可截图的题目内容');
  const fontFaces=[...doc.fonts];for(const face of fontFaces)if(families.has(face.family.replace(/^['"]|['"]$/g,'').toLowerCase())&&['loading','error'].includes(face.status))fail('题目字体尚未可靠加载');
  if(families.has('exam-data-decrypt-font')&&!fontFaces.some(face=>face.family.replace(/^['"]|['"]$/g,'').toLowerCase()==='exam-data-decrypt-font'&&face.status==='loaded'))fail('加密题目字体未就绪');
  const innerViewport=viewport(doc);let inner={x:Math.floor(Math.min(...entries.map(r=>r.x))-PAD),y:Math.floor(Math.min(...entries.map(r=>r.y))-PAD)};
  inner.width=Math.ceil(Math.max(...entries.map(right))+PAD)-inner.x;inner.height=Math.ceil(Math.max(...entries.map(bottom))+PAD)-inner.y;
  inner=paddedCrop(inner,q.element,entries);
  // Padding must also stay within every scroll clip, not merely the text boxes.
  assertAncestors(q.element,inner,seen);
  const frameRect=frame.getBoundingClientRect(),style=topWin.getComputedStyle(frame);
  if(['paddingLeft','paddingRight','paddingTop','paddingBottom'].some(key=>parseFloat(style[key])!==0))fail('iframe 内边距结构未验证');
  const offset={x:frameRect.left+frame.clientLeft,y:frameRect.top+frame.clientTop};const rect=paddedCrop({x:offset.x+inner.x,y:offset.y+inner.y,width:inner.width,height:inner.height},frame,entries.map(e=>({...e,x:offset.x+e.x,y:offset.y+e.y}))),topViewport={width:topWin.innerWidth,height:topWin.innerHeight};
  assertAncestors(frame,rect,new Set());if(!inside(rect,{x:0,y:0,...viewport(topDoc)})||rect.width*rect.height>MAX_PIXELS)fail('整题超出顶层可见范围或尺寸过大');
  unobstructed(doc,inner,el=>el===q.element||el.contains(q.element)||q.element.contains(el)&&!['absolute','fixed','sticky'].includes(win.getComputedStyle(el).position));
  unobstructed(topDoc,rect,el=>el===frame||el.contains(frame));
  guard();return{geometry:{questionId:q.id,signature:q.signature,rect,viewport:topViewport,pixelRatio:topWin.devicePixelRatio},stable:{entries,frame:box(frameRect),innerViewport,images:images.map(im=>({src:im.currentSrc||im.src,width:im.naturalWidth,height:im.naturalHeight})),fonts:[...families].sort()}};
 }
 try{
  guard();if(!doc.fonts?.ready)fail('浏览器未提供字体就绪校验');await checked(doc.fonts.ready);
  const images=[...q.element.querySelectorAll('img')].filter(shown);
  for(const image of images){
   guard();if(!image.complete)await checked(new Promise((resolve,reject)=>{const done=()=>{clean();resolve();},error=()=>{clean();reject(Error('RENDERED_IMAGE_LOAD：题内图片加载失败'));},abort=()=>{clean();reject(combined.reason);},clean=()=>{image.removeEventListener('load',done);image.removeEventListener('error',error);combined.removeEventListener('abort',abort);};image.addEventListener('load',done,{once:true});image.addEventListener('error',error,{once:true});combined.addEventListener('abort',abort,{once:true});}));
   guard();if(!image.complete||!image.naturalWidth||!image.naturalHeight)fail('题内图片尚未加载成功');if(typeof image.decode!=='function')fail('浏览器未提供图片解码校验');try{await checked(image.decode());}catch(error){guard();fail('题内图片解码失败：'+String(error.message||error).slice(0,100));}
  }
  const first=sample(images);await checked(new Promise(resolve=>setTimeout(resolve,80)));const second=sample(images);
  if(JSON.stringify(first)!==JSON.stringify(second))fail('等待期间题目位置、尺寸或显示内容不稳定');guard();return second.geometry;
 }finally{clearTimeout(timer);}
}
