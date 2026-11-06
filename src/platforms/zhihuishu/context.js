// Only the observed AI teaching centre homework route; exam and legacy sites
// must establish their own identity and editing contracts before registration.
export function homeworkKey(value){try{
 const u=new URL(typeof value==='string'?value:value.href);
 if(u.protocol!=='https:'||u.hostname!=='hike-teaching-center.polymas.com'||u.port||u.username||u.password||!/^\/exam-hub\/[A-Za-z0-9_-]{1,128}\/stu\/answer-homework\/?$/.test(u.pathname))return null;
 const keys=['homeworkId','paperId','examId'];
 if(keys.some(k=>u.searchParams.getAll(k).length!==1||!(k==='homeworkId'?/^[A-Za-z0-9_-]{1,128}$/:/^\d{1,32}$/).test(u.searchParams.get(k))))return null;
 return u.origin+u.pathname.replace(/\/$/,'')+'?'+new URLSearchParams(keys.map(k=>[k,u.searchParams.get(k)])).toString();
 }catch{return null;}}
