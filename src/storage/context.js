import {homeworkKey} from '../platforms/zhihuishu/context.js';
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function normalizeCourse(raw={}){const language=clean(raw?.language,80);let requirements=clean(raw?.requirements,8192);if(language)requirements=`原学科/语言约束：${language}${requirements?'\n'+requirements:''}`;return{name:clean(raw?.name,120),language:'',requirements};}
export function requireCourse(raw){const course=normalizeCourse(raw);if(!course.name)throw Error('COURSE_REQUIRED：请先填写当前试卷的课程名称');return course;}
export function courseKey(url){try{const u=new URL(url);if(u.protocol!=='https:')return null;
 if(u.hostname==='hike-teaching-center.polymas.com')return homeworkKey(url);
 if(u.hostname==='www.yuketang.cn'){const ids=u.pathname.match(/^\/(?:ai-workspace\/lms-graph\/(\d+)\/exercise\/(\d+)|v2\/web\/iframe-exercise\/(\d+)\/(\d+))\/?$/);if(ids)return u.origin+'/ai-workspace/lms-graph/'+(ids[1]||ids[3])+'/exercise/'+(ids[2]||ids[4]);}
 if(u.hostname==='examination.xuetangx.com'&&/^\/exam\/[^/]+\/?$/.test(u.pathname))return u.origin+u.pathname.replace(/\/$/,'');
 if(u.hostname==='mooc1.chaoxing.com'&&u.pathname==='/mooc-ans/mooc2/work/dowork'){
  const keys=['courseId','classId','workId'];if(keys.some(k=>u.searchParams.getAll(k).length!==1||!/^\d+$/.test(u.searchParams.get(k))))return null;
  return u.origin+u.pathname+'?'+new URLSearchParams(keys.map(k=>[k,u.searchParams.get(k)])).toString();
 }return null;}catch{return null;}}
export function courseForUrl(settings,url){const key=courseKey(url),name=key&&Object.hasOwn(settings.courseBindings||{},key)?settings.courseBindings[key]:null;return normalizeCourse(name&&Object.hasOwn(settings.courses||{},name)?settings.courses[name]:{});}
export function bindCourse(settings,url,course){const key=courseKey(url);if(!key)throw Error('COURSE_PAGE：请在已适配的考试页面保存课程背景');const value=normalizeCourse(course),courses=Object.assign(Object.create(null),settings.courses),courseBindings=Object.assign(Object.create(null),settings.courseBindings);if(value.name){courses[value.name]=value;courseBindings[key]=value.name;}else delete courseBindings[key];return{...settings,courses,courseBindings};}
