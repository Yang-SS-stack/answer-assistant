import {normalizeCourse,courseForUrl} from './context.js';
export const PROVIDERS={deepseek:{name:'DeepSeek',endpoint:'https://api.deepseek.com/chat/completions',models:['deepseek-flash','deepseek-v4-pro']},qwen:{name:'通义千问',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',models:['qwen-plus','qwen-max','qwen3.7-flash']}};
// Exact model identifiers only: unknown models never inherit vision from a name pattern.
export const MODEL_CAPABILITIES={qwen:{'qwen3.7-flash':{vision:true,jsonObject:true,thinking:true,sources:{vision:'https://www.alibabacloud.com/help/en/model-studio/models',jsonObject:'https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output',thinking:'https://www.alibabacloud.com/help/en/model-studio/deep-thinking'}}}};
export function modelCapabilities(provider,profile,model){
 const explicit=profile.modelCapabilities?.[model];
 return{vision:typeof explicit?.vision==='boolean'?explicit.vision:MODEL_CAPABILITIES[provider]?.[model]?.vision===true};
}
export function normalizeSettings(raw={}){
 const reviewerModel=typeof raw.reviewer?.model==='string'&&raw.reviewer.model.trim()?raw.reviewer.model.trim().slice(0,120):'qwen3.7-flash';
 const reviewer={provider:'qwen',model:reviewerModel,thinking:typeof raw.reviewer?.thinking==='boolean'?raw.reviewer.thinking:MODEL_CAPABILITIES.qwen[reviewerModel]?.thinking===true};
 const providers={};for(const [id,p] of Object.entries(PROVIDERS)){
  const r=raw.providers?.[id]||{};const model=typeof r.model==='string'&&r.model.trim()?r.model.trim():p.models[0];
  const perModel={...(r.modelCapabilities||{})};const capabilities=perModel[model]||(Object.keys(perModel).length?modelCapabilities(id,r,model):r.capabilities)||modelCapabilities(id,r,model);perModel[model]={vision:capabilities.vision===true};
  providers[id]={apiKey:typeof r.apiKey==='string'?r.apiKey.trim():'',model,endpoint:p.endpoint,capabilities:{vision:capabilities.vision===true},modelCapabilities:perModel,timeoutMs:Math.min(120000,Math.max(1000,Number(r.timeoutMs)||60000)),maxRetries:Math.min(2,Math.max(0,Number(r.maxRetries)||0))};
 }
 const courses=Object.create(null),courseBindings=Object.create(null);for(const [key,value]of Object.entries(raw.courses||{})){const c=normalizeCourse(value);if(c.name===key)courses[key]=c;}for(const [key,value]of Object.entries(raw.courseBindings||{}))if(Object.hasOwn(courses,value))courseBindings[key]=value;
 return {schemaVersion:4,reviewer,courses,courseBindings,reviewMode:raw.reviewMode==='enhanced'?'enhanced':'standard',provider:PROVIDERS[raw.provider]?raw.provider:'deepseek',providers,mode:['auto','single','batch'].includes(raw.mode)?raw.mode:'auto',filter:['all','single','multiple','judge','fill','subjective'].includes(raw.filter)?raw.filter:'all',existing:raw.existing==='replace'?'replace':'skip',speed:['normal','fast','timed'].includes(raw.speed)?raw.speed:'normal',targetMinutes:Math.min(180,Math.max(1,Number(raw.targetMinutes)||5))};
}
export function switchProvider(s,id){return normalizeSettings({...s,provider:id});}
export function publicSettings(s,url){const p=s.providers[s.provider],r=s.reviewer;return{course:courseForUrl(s,url),reviewMode:s.reviewMode,provider:s.provider,model:p.model,capabilities:p.capabilities,mode:s.mode,filter:s.filter,existing:s.existing,speed:s.speed,targetMinutes:s.targetMinutes,configured:!!p.apiKey,reviewer:{...r,configured:!!s.providers[r.provider].apiKey,capabilities:modelCapabilities(r.provider,s.providers[r.provider],r.model)}};}
