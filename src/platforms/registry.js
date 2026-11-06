import {createAdapter as createYuketangAdapter} from './yuketang/exam.js';
import {createAdapter as createEmbeddedAdapter} from './yuketang/embedded.js';
import {createAdapter as createChaoxingAdapter} from './chaoxing/work.js';
import {createAdapter as createZhihuishuAdapter} from './zhihuishu/homework.js';
import {courseKey} from '../storage/context.js';
// Pin the adapter instance and paper identity across asynchronous model/settings calls.
export function pinPlatform(adapter,currentUrl){
 const key=courseKey(currentUrl()),pinned={...adapter};const current=()=>key!==null&&courseKey(currentUrl())===key;
 for(const [name,method]of Object.entries(adapter))if(typeof method==='function')pinned[name]=(...args)=>{
  if(!current()){if(name==='detectPage')return{...adapter.detectPage(),supported:false,reason:'PAGE_CHANGED：任务期间试卷已切换，请停止后重新开始'};if(name==='checkWritable')return false;if(name==='timer')return'未识别';throw Error('PAGE_CHANGED：任务期间试卷已切换');}
  return method.apply(adapter,args);
 };if(adapter.pagination){pinned.pagination={...adapter.pagination};for(const [name,method]of Object.entries(adapter.pagination))if(typeof method==='function')pinned.pagination[name]=(...args)=>{if(!current())throw Error('PAGE_CHANGED：翻页期间试卷已切换');return method.apply(adapter.pagination,args);};}return pinned;
}
const required=['detectPage','findQuestions','extractQuestion','readCurrentAnswer','checkWritable','writeAnswer','verifyAnswer','timer'];
const registrations=[{id:'yuketang',matches:loc=>loc?.hostname==='examination.xuetangx.com',create:createYuketangAdapter},{id:'chaoxing',matches:loc=>loc?.hostname==='mooc1.chaoxing.com',create:createChaoxingAdapter},{id:'yuketang-embedded',matches:loc=>loc?.hostname==='www.yuketang.cn',create:createEmbeddedAdapter},{id:'zhihuishu-homework',matches:loc=>loc?.hostname==='hike-teaching-center.polymas.com',create:createZhihuishuAdapter}];
export function selectPlatform(doc,loc,entries=registrations){
 const errors=[],reasons=[],candidates=[],rejected=[];
 for(const entry of entries){
  let stage='match';
  try{
   if(!entry.matches(loc))continue;
   stage='initialize';const adapter=entry.create(doc,loc);
   const missing=required.filter(name=>typeof adapter?.[name]!=='function');if(missing.length)throw Error('ADAPTER_CONTRACT：缺少 '+missing.join(', '));
   stage='detect';const page=adapter.detectPage();
   if(page?.supported===true)candidates.push({id:entry.id,adapter});else if(page){rejected.push(page);if(page.reason)reasons.push(page.reason);}
  }catch(error){errors.push({id:entry.id,stage,reason:error.message||String(error)});}
 }
 if(candidates.length===1)return{...candidates[0],errors};
 const reason=candidates.length>1?'ADAPTER_AMBIGUOUS：多个适配器同时匹配，未执行作答（'+candidates.map(c=>c.id).join(', ')+')':reasons.join('；')||(errors.length?'平台适配器不可用，请查看诊断中的注册错误':'当前页面尚未适配，未执行识别或填写');
 const identity={};if(!candidates.length&&rejected.length===1)for(const key of ['platform','scene','variant'])if(typeof rejected[0][key]==='string')identity[key]=rejected[0][key];
 return{id:null,errors,adapter:{supportsSubjective:false,detectPage:()=>({...identity,supported:false,reason}),findQuestions:()=>[],timer:()=>'未识别'}};
}
