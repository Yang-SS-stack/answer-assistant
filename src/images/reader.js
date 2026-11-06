const MAX_PIXELS=16000000,MAX_DATA_URL=5000000;
function loadAnonymous(url,{doc,signal,timeoutMs}){
 return new Promise((resolve,reject)=>{
  const image=new doc.defaultView.Image();let timer;
  const clean=()=>{clearTimeout(timer);image.onload=null;image.onerror=null;signal.removeEventListener('abort',abort);};
  const fail=error=>{clean();image.removeAttribute('src');reject(error);};
  const abort=()=>fail(signal.reason||Error('STOPPED'));
  image.crossOrigin='anonymous';image.referrerPolicy='origin';
  image.onload=()=>{clean();if(signal.aborted){image.removeAttribute('src');reject(signal.reason);}else resolve(image);};
  image.onerror=()=>fail(Error('IMAGE_CORS_FAILED：原图匿名读取失败，当前题未填写'));
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  timer=setTimeout(()=>fail(Error('IMAGE_TIMEOUT：原图读取超时，当前题未填写')),timeoutMs);
  image.src=url;
 });
}
export async function collectQuestionImages(q,{doc=document,signal,isCurrent=()=>true,timeoutMs=15000}={}){
 signal.throwIfAborted();const images=[];
 for(const im of q.images||[]){
  signal.throwIfAborted();if(!im.loaded)throw Error('IMAGE_LOAD_FAILED：题目图片未加载');
  const matches=[...q.element.querySelectorAll('img')].filter(el=>(el.currentSrc||el.src)===im.url);
  const source=im.node??(matches.length===1?matches[0]:null);
  if(!source||!source.matches?.('img')||!q.element.contains(source)||(source.currentSrc||source.src)!==im.url)throw Error('IMAGE_MAPPING：图片与题目的对应关系不唯一，当前题未填写');
  const width=source.naturalWidth,height=source.naturalHeight;
  const guard=()=>{signal.throwIfAborted();if(!q.element.isConnected||!q.element.contains(source)||!source.isConnected||!isCurrent()||(source.currentSrc||source.src)!==im.url||im.source&&source.src!==im.source||source.naturalWidth!==width||source.naturalHeight!==height)throw Error('IMAGE_CHANGED：读取期间题目或图片已变化，当前题未填写');};
  guard();if(!width||!height)throw Error('IMAGE_LOAD_FAILED：图片尺寸不可用');if(width*height>MAX_PIXELS)throw Error('IMAGE_TOO_LARGE：图片像素超过限制，当前题未填写');
  const convert=image=>{const canvas=doc.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('IMAGE_CANVAS_UNAVAILABLE');context.drawImage(image,0,0);return canvas.toDataURL('image/png');};
  let dataUrl;
  try{dataUrl=convert(source);}catch(error){
   guard();if(error.name!=='SecurityError')throw Error('IMAGE_CONVERT_FAILED：图片转换失败，当前题未填写');
   let url;try{url=new URL(im.url);}catch{}
   if(!url||url.protocol!=='https:'||url.username||url.password)throw Error('IMAGE_SOURCE_UNSUPPORTED：当前图片来源无法安全读取');
   const copy=await loadAnonymous(url.href,{doc,signal,timeoutMs});
   try{guard();if(copy.naturalWidth!==width||copy.naturalHeight!==height)throw Error('IMAGE_CHANGED：重新读取的图片尺寸不一致');dataUrl=convert(copy);}finally{copy.removeAttribute('src');}
  }
  guard();if(!dataUrl.startsWith('data:image/png;base64,')||dataUrl.length>MAX_DATA_URL)throw Error('IMAGE_TOO_LARGE：图片转换结果为空或超过大小限制');
  images.push({position:im.position,dataUrl});
 }
 signal.throwIfAborted();return images;
}
