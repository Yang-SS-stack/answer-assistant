import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validateCredential} from './qwen-console.mjs';
const script=fileURLToPath(new URL('./Protect.ps1',import.meta.url));
function dpapi(operation,input){
 return new Promise((resolve,reject)=>{
  const fail=()=>reject(Error('CREDENTIAL_STORE_FAILED'));
  if(process.platform!=='win32')return fail();
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Operation',operation],{windowsHide:true,stdio:['pipe','pipe','ignore'],shell:false});
  let output='',overflow=false;const timer=setTimeout(()=>{child.kill();fail();},15000);
  child.stdout.on('data',chunk=>{output+=chunk.toString('ascii');if(output.length>131072){overflow=true;child.kill();}});
  child.on('error',()=>{clearTimeout(timer);fail();});
  child.on('close',code=>{clearTimeout(timer);const s=output.trim();if(code!==0||overflow||!s||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))return fail();resolve(Buffer.from(s,'base64'));});
  child.stdin.on('error',()=>{});child.stdin.end(Buffer.from(input).toString('base64'));
 });
}
export function createCredentialStore({directory,protect=b=>dpapi('Protect',b),unprotect=b=>dpapi('Unprotect',b)}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('CREDENTIAL_STORE_FAILED');
 const file=path.join(directory,'session.dat');
 return{
  async load(){try{if((await stat(file)).size>65536)return null;const plain=await unprotect(await readFile(file));if(Buffer.byteLength(plain)>32768)return null;return validateCredential(JSON.parse(Buffer.from(plain).toString('utf8')));}catch{return null;}},
  async save(raw,guard=()=>{}){
   let temporary;try{
    const c=validateCredential(raw),encrypted=Buffer.from(await protect(Buffer.from(JSON.stringify(c),'utf8')));
    if(!encrypted.length||encrypted.length>65536)throw Error();await guard();
    await mkdir(directory,{recursive:true});temporary=path.join(directory,`.session-${randomUUID()}.tmp`);
    await writeFile(temporary,encrypted,{flag:'wx',mode:0o600});await guard();await rename(temporary,file);temporary=null;
   }catch{throw Error('CREDENTIAL_STORE_FAILED');}finally{if(temporary)await unlink(temporary).catch(()=>{});}
  },
  async clear(){try{await unlink(file);}catch(e){if(e.code!=='ENOENT')throw Error('CREDENTIAL_STORE_FAILED');}}
 };
}
