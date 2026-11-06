import {modelCapabilities} from '../storage/settings.js';

function roleConfig(settings,purpose){
 if(!['answer','independent','review'].includes(purpose))throw Error('PURPOSE_INVALID');
 const reviewer=purpose!=='answer',provider=reviewer?settings.reviewer.provider:settings.provider;
 const model=reviewer?settings.reviewer.model:settings.providers[provider].model;
 const profile={...settings.providers[provider],provider,model,thinking:reviewer&&settings.reviewer.thinking===true};
 if(reviewer)profile.capabilities=modelCapabilities(provider,settings.providers[provider],model);
 return{profile,source:{provider,model,role:purpose,thinking:provider==='qwen'&&profile.thinking}};
}
export function selectRole(settings,purpose='answer'){
 if(purpose!=='answer'&&settings.reviewMode!=='enhanced')throw Error('REVIEW_MODE_REQUIRED：独立复核仅适用于加强模式');
 const selected=roleConfig(settings,purpose);
 if(purpose!=='answer'&&!selected.profile.apiKey)throw Error('REVIEW_KEY_REQUIRED：请配置 Qwen 加强复核密钥');
 return selected;
}
// Includes only fields used by this role. Never expose this internal fingerprint.
export function roleFingerprint(settings,purpose='answer'){
 const {profile}=roleConfig(settings,purpose);
 return JSON.stringify({reviewMode:purpose==='answer'?undefined:settings.reviewMode,provider:profile.provider,model:profile.model,thinking:profile.thinking,apiKey:profile.apiKey,endpoint:profile.endpoint,capabilities:profile.capabilities,timeoutMs:profile.timeoutMs,maxRetries:profile.maxRetries});
}
