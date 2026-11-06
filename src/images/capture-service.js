import {courseKey} from '../storage/context.js';
const MAX_PIXELS=16000000,MAX_DATA_URL=5000000;
const fail=code=>{throw Error(code);};
function png(value){if(typeof value!=='string'||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value))fail('CAPTURE_PNG_INVALID');if(value.length>MAX_DATA_URL)fail('CAPTURE_SIZE');return value;}
function geometry(raw,id){
 if(typeof raw?.error==='string')throw Error('CAPTURE_GEOMETRY：'+raw.error.slice(0,500));
 if(raw?.questionId!==id||typeof raw.signature!=='string'||!raw.signature||raw.signature.length>100000)fail('CAPTURE_GEOMETRY_CHANGED');
 const {rect:r,viewport:v,pixelRatio:d}=raw;
 if(!r||!v||![r.x,r.y,r.width,r.height,v.width,v.height,d].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||v.width<=0||v.height<=0||d<=0||d>8||r.x+r.width>v.width||r.y+r.height>v.height)fail('CAPTURE_GEOMETRY_INVALID');
 if(v.width*v.height*d*d>MAX_PIXELS)fail('CAPTURE_SIZE');
 return{questionId:id,signature:raw.signature,rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:v.width,height:v.height},pixelRatio:d};
}
function sameGeometry(a,b){return a.questionId===b.questionId&&a.signature===b.signature&&a.pixelRatio===b.pixelRatio&&['x','y','width','height'].every(k=>a.rect[k]===b.rect[k])&&['width','height'].every(k=>a.viewport[k]===b.viewport[k]);}
function bounds(g,width=g.viewport.width*g.pixelRatio,height=g.viewport.height*g.pixelRatio){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width*height>MAX_PIXELS)fail('CAPTURE_SIZE');
 if(Math.abs(width-g.viewport.width*g.pixelRatio)>2||Math.abs(height-g.viewport.height*g.pixelRatio)>2)fail('CAPTURE_DPR_DIMENSION');
 const sx=width/g.viewport.width,sy=height/g.viewport.height,x=Math.floor(g.rect.x*sx),y=Math.floor(g.rect.y*sy),right=Math.ceil((g.rect.x+g.rect.width)*sx),bottom=Math.ceil((g.rect.y+g.rect.height)*sy);
 if(x<0||y<0||right>width||bottom>height||right<=x||bottom<=y)fail('CAPTURE_GEOMETRY_INVALID');
 return{x,y,width:right-x,height:bottom-y};
}

export async function cropPng(dataUrl,g,{signal,guard=()=>{}}={}){
 const check=async()=>{signal?.throwIfAborted();await guard();signal?.throwIfAborted();};
 await check();png(dataUrl);geometry(g,g.questionId);
 const binary=atob(dataUrl.slice(dataUrl.indexOf(',')+1)),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
 try{
  await check();const rect=bounds(g,bitmap.width,bitmap.height),canvas=new OffscreenCanvas(rect.width,rect.height),ctx=canvas.getContext('2d');
  if(!ctx)fail('CAPTURE_CANVAS_UNAVAILABLE');ctx.drawImage(bitmap,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
  const blob=await canvas.convertToBlob({type:'image/png'});await check();if(blob.type!=='image/png'||blob.size>MAX_DATA_URL*3/4)fail('CAPTURE_SIZE');
  const buffer=await blob.arrayBuffer();await check();let encoded='';const output=new Uint8Array(buffer);for(let offset=0;offset<output.length;offset+=32768)encoded+=String.fromCharCode(...output.subarray(offset,offset+32768));
  return{dataUrl:png('data:image/png;base64,'+btoa(encoded)),width:rect.width,height:rect.height,sourceWidth:bitmap.width,sourceHeight:bitmap.height};
 }finally{bitmap.close();}
}

export async function captureRenderedQuestion({tabId,questionId,captureId,taskId,signal,guard=()=>{},api=chrome,crop=cropPng,timeoutMs=10000}){
 if(!Number.isInteger(tabId)||tabId<0||[questionId,captureId,taskId].some(v=>typeof v!=='string'||!v||v.length>256)||!Number.isFinite(timeoutMs)||timeoutMs<=0)fail('CAPTURE_BINDING_INVALID');
 const deadline=Date.now()+timeoutMs;let stopped=false;
 const basic=()=>{signal?.throwIfAborted();if(stopped||Date.now()>=deadline)fail('CAPTURE_TIMEOUT');};
 const bounded=fn=>new Promise((resolve,reject)=>{
  let timer;const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const abort=()=>{stopped=true;clean();reject(signal.reason||Error('STOPPED'));};
  try{basic();}catch(error){reject(error);return;}
  signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{stopped=true;clean();reject(Error('CAPTURE_TIMEOUT'));},Math.max(1,deadline-Date.now()));
  Promise.resolve().then(()=>{basic();return fn();}).then(value=>{clean();resolve(value);},error=>{clean();reject(error);});
 });
 const check=async()=>{basic();await bounded(guard);basic();};
 const step=async fn=>{await check();const value=await bounded(fn);await check();return value;};
 const initial=await step(()=>api.tabs.get(tabId)),paper=courseKey(initial.url),windowId=initial.windowId;
 if(initial.id!==tabId||!Number.isInteger(windowId)||!paper||initial.active!==true)fail('CAPTURE_ACTIVE_TAB_CHANGED');
 async function active(){const tab=await step(()=>api.tabs.get(tabId));if(tab.id!==tabId||tab.windowId!==windowId||!tab.active||courseKey(tab.url)!==paper||tab.url!==initial.url)fail('CAPTURE_PAGE_CHANGED');const tabs=await step(()=>api.tabs.query({active:true,windowId}));if(tabs.length!==1||tabs[0].id!==tabId||tabs[0].windowId!==windowId)fail('CAPTURE_ACTIVE_TAB_CHANGED');}
 const message={action:'capture_geometry',taskId,questionId,captureId};
 await active();const first=geometry(await step(()=>api.tabs.sendMessage(tabId,message,{frameId:0})),questionId);await active();
 const full=png(await step(()=>api.tabs.captureVisibleTab(windowId,{format:'png'})));await active();
 const out=await step(()=>crop(full,first,{signal,guard:check}));png(out?.dataUrl);
 const expected=bounds(first,out.sourceWidth,out.sourceHeight);if(!Number.isInteger(out.width)||!Number.isInteger(out.height)||out.width!==expected.width||out.height!==expected.height)fail('CAPTURE_DIMENSION');
 const second=geometry(await step(()=>api.tabs.sendMessage(tabId,message,{frameId:0})),questionId);if(!sameGeometry(first,second))fail('CAPTURE_GEOMETRY_CHANGED');await active();
 await active();await check();return{position:'question-rendered',dataUrl:out.dataUrl,width:out.width,height:out.height};
}
