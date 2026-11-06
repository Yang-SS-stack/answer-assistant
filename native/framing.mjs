const MAX=65536;
const protocol=()=>Error('NATIVE_PROTOCOL');
export const validExtensionOrigin=value=>typeof value==='string'&&/^chrome-extension:\/\/[a-p]{32}\/$/.test(value);
export function validateModels(value){if(!Array.isArray(value)||!value.length||value.length>2||new Set(value).size!==value.length||value.some(v=>typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(v)))throw protocol();return [...value];}
export function validateNativeRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value.id)||!['status','login','quota','logout'].includes(value.op))throw protocol();
 const allowed=['version','id','op',...(['login','quota'].includes(value.op)?['models']:[])];if(Object.keys(value).some(k=>!allowed.includes(k)))throw protocol();
 return{version:1,id:value.id,op:value.op,...(['login','quota'].includes(value.op)?{models:validateModels(value.models)}:{})};
}
export function encodeFrame(value){const content=Buffer.from(JSON.stringify(value));if(!content.length||content.length>MAX)throw protocol();const header=Buffer.alloc(4);header.writeUInt32LE(content.length);return Buffer.concat([header,content]);}
export function frameDecoder(){
 let buffer=Buffer.alloc(0),failed=false;
 return{push(chunk){if(failed)throw protocol();buffer=Buffer.concat([buffer,chunk]);const out=[];try{while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(!size||size>MAX)throw protocol();if(buffer.length<size+4)break;const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(4,size+4));out.push(JSON.parse(text));buffer=buffer.subarray(size+4);}if(buffer.length>MAX+4)throw protocol();return out;}catch{failed=true;buffer=Buffer.alloc(0);throw protocol();}},finish(){if(buffer.length)throw protocol();}};
}
