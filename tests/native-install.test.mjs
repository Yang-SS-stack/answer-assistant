import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCredentialStore} from '../native/credential-store.mjs';
const credential={accessToken:'synthetic_secret_12345',sessionId:'11111111-1111-4111-8111-111111111111',region:'cn-beijing',site:'domestic'};
const native=fileURLToPath(new URL('../native',import.meta.url));
const temporary=async t=>{const d=await mkdtemp(path.join(tmpdir(),'aa-native-'));t.after(async()=>{
 assert.equal(path.dirname(path.resolve(d)),path.resolve(tmpdir()));assert.ok(path.basename(d).startsWith('aa-native-'));
 await rm(d,{recursive:true,force:true});
});return d;};
const codecs={protect:async b=>Buffer.from(b).reverse(),unprotect:async b=>Buffer.from(b).reverse()};
test('credential storage roundtrip is encrypted, isolated and clears only its session',async t=>{
 const directory=await temporary(t),store=createCredentialStore({directory,...codecs});assert.equal(await store.load(),null);
 await writeFile(path.join(directory,'unrelated'),'keep');await store.save({...credential,extra:'discard'});
 assert.equal((await readFile(path.join(directory,'session.dat'))).includes(Buffer.from(credential.accessToken)),false);
 assert.deepEqual(await store.load(),credential);assert.deepEqual((await readdir(directory)).sort(),['session.dat','unrelated']);
 await store.clear();assert.equal(await store.load(),null);assert.equal(await readFile(path.join(directory,'unrelated'),'utf8'),'keep');
});
test('failed encryption, rejected commit guard and corrupt data preserve safety',async t=>{
 const directory=await temporary(t),store=createCredentialStore({directory,...codecs});await store.save(credential);
 const saved=await readFile(path.join(directory,'session.dat'));
 await assert.rejects(createCredentialStore({directory,...codecs,protect:async()=>{throw Error(credential.accessToken);}}).save(credential),e=>!e.message.includes(credential.accessToken));
 await assert.rejects(store.save(credential,()=>{throw Error('CANCELLED');}));assert.deepEqual(await readFile(path.join(directory,'session.dat')),saved);
 assert.deepEqual(await readdir(directory),['session.dat']);await writeFile(path.join(directory,'session.dat'),'broken');assert.equal(await store.load(),null);
});
test('rename failure cleans temporary ciphertext without deleting existing path',async t=>{
 const directory=await temporary(t);await mkdir(path.join(directory,'session.dat'));const store=createCredentialStore({directory,...codecs});
 await assert.rejects(store.save(credential),/CREDENTIAL_STORE_FAILED/);assert.deepEqual(await readdir(directory),['session.dat']);
});
test('real CurrentUser DPAPI roundtrip uses only synthetic credentials', {skip:process.platform!=='win32'},async t=>{
 const directory=await temporary(t),store=createCredentialStore({directory});await store.save(credential);assert.deepEqual(await store.load(),credential);
 assert.equal((await readFile(path.join(directory,'session.dat'))).includes(Buffer.from(credential.accessToken)),false);
});
test('installer dry run is read-only and rejects invalid extension IDs', {skip:process.platform!=='win32'},async t=>{
 const directory=await temporary(t);
 const ps=(args)=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(native,'Install.ps1'),...args],{encoding:'utf8',windowsHide:true,env:{...process.env,LOCALAPPDATA:directory}});
 const ok=ps(['-ExtensionId','a'.repeat(32),'-DryRun']);assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/DRY RUN/);assert.match(ok.stdout,/HKCU/);
 for(const id of ['abc','z'.repeat(32),'a'.repeat(31)+';'])assert.notEqual(ps(['-ExtensionId',id,'-DryRun']).status,0);
 assert.deepEqual(await readdir(directory),[]);
});
test('installer dry run rejects foreign or tampered existing registration without touching the registry', {skip:process.platform!=='win32'},async t=>{
 const directory=await temporary(t),owned=path.join(directory,'AnswerAssistant','quota-bridge','4.11.9');await mkdir(owned,{recursive:true});
 const manifestPath=path.join(owned,'com.answer_assistant.quota.json'),markerPath=path.join(owned,'product-marker.txt');
 const manifest={name:'com.answer_assistant.quota',path:path.join(owned,'NativeLauncher.exe'),type:'stdio',allowed_origins:['chrome-extension://'+'b'.repeat(32)+'/']};
 await writeFile(markerPath,'AnswerAssistant.quota-bridge.v1');await writeFile(manifestPath,JSON.stringify(manifest));
 const wrapper=path.join(directory,'registry-fixture.ps1');
 await writeFile(wrapper,`function global:Test-Path { param([string]$LiteralPath,[string]$Path,[string]$PathType) if($LiteralPath -like 'HKCU:*'){return $true}; Microsoft.PowerShell.Management\\Test-Path @PSBoundParameters }
function global:Get-Item { param([string]$LiteralPath,[switch]$Force) if($LiteralPath -like 'HKCU:*'){ $v=New-Object PSObject; $v | Add-Member ScriptMethod GetValue {param($name) return $env:AA_TEST_REGISTRATION}; return $v }; Microsoft.PowerShell.Management\\Get-Item @PSBoundParameters }
function global:Set-Item { throw 'REGISTRY WRITE FORBIDDEN' }
function global:New-Item { param([string]$Path,[string]$ItemType,[switch]$Force) if($Path -like 'HKCU:*'){throw 'REGISTRY WRITE FORBIDDEN'}; Microsoft.PowerShell.Management\\New-Item @PSBoundParameters }
& $env:AA_TEST_INSTALL -ExtensionId ('a' * 32) -DryRun:($env:AA_TEST_DRY -ne '0')
`);
 const run=(registration,dry=true)=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',wrapper],{encoding:'utf8',windowsHide:true,env:{...process.env,LOCALAPPDATA:directory,AA_TEST_INSTALL:path.join(native,'Install.ps1'),AA_TEST_REGISTRATION:registration,AA_TEST_DRY:dry?'1':'0'}});
 const valid=run(manifestPath);assert.equal(valid.status,0,valid.stderr);assert.match(valid.stdout,/DRY RUN/);
 assert.notEqual(run(path.join(directory,'foreign.json')).status,0);
 assert.notEqual(run(path.join(directory,'foreign.json'),false).status,0);
 assert.deepEqual(await readdir(path.dirname(owned)),['4.11.9']);
 assert.notEqual(run('relative.json').status,0);
 await writeFile(markerPath,'other product');assert.notEqual(run(manifestPath).status,0);await writeFile(markerPath,'AnswerAssistant.quota-bridge.v1');
 for(const bad of [{name:'foreign.product'},{path:process.execPath},{allowed_origins:['https://example.com/']},{type:'other'}]){
  await writeFile(manifestPath,JSON.stringify({...manifest,...bad}));assert.notEqual(run(manifestPath).status,0);
 }
 const source=await readFile(path.join(native,'Install.ps1'),'utf8');assert.match(source,/'LICENSE'/);assert.match(source,/'THIRD_PARTY_NOTICES.md'/);
});
test('launcher compiles and relays a frame after stdin EOF, exact origin enforced', {skip:process.platform!=='win32'},async t=>{
 const directory=await temporary(t),exe=path.join(directory,'NativeLauncher.exe');
 const compiled=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/out:'+exe,'/r:System.Web.Extensions.dll',path.join(native,'NativeLauncher.cs')],{encoding:'utf8',windowsHide:true});assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
 const origin='chrome-extension://'+'a'.repeat(32)+'/';await writeFile(path.join(directory,'host-config.json'),JSON.stringify({version:1,bridgeVersion:'4.12.0',origin,nodePath:process.execPath}));
 await writeFile(path.join(directory,'host.mjs'),`if(process.argv[2]!=='--origin'||process.argv[3]!==${JSON.stringify(origin)})process.exit(8);let b=[];for await(const c of process.stdin)b.push(c);await new Promise(r=>setTimeout(r,100));process.stdout.write(Buffer.concat(b));`);
 const body=Buffer.from('{"synthetic":true}'),header=Buffer.alloc(4);header.writeUInt32LE(body.length);const frame=Buffer.concat([header,body]);
 const run=spawnSync(exe,[origin],{input:frame,windowsHide:true,timeout:10000});assert.equal(run.status,0,run.stderr?.toString());assert.deepEqual(run.stdout,frame);
 const denied=spawnSync(exe,[origin+'bad'],{input:frame,windowsHide:true});assert.notEqual(denied.status,0);assert.equal(denied.stdout.length,0);
 for(const bad of [{bridgeVersion:'4.11.0'},{origin:'https://example.com/'},{nodePath:'node.exe'},{version:2}]){
  await writeFile(path.join(directory,'host-config.json'),JSON.stringify({version:1,bridgeVersion:'4.12.0',origin,nodePath:process.execPath,...bad}));
  const run=spawnSync(exe,[origin],{input:frame,windowsHide:true});assert.notEqual(run.status,0);assert.equal(run.stdout.length,0);
 }
 await writeFile(path.join(directory,'host-config.json'),JSON.stringify({version:1,bridgeVersion:'4.12.0',origin,nodePath:process.execPath}));
 await writeFile(path.join(directory,'host.mjs'),`process.stdout.write(JSON.stringify({proxy:process.env.HTTPS_PROXY,use:process.env.NODE_USE_ENV_PROXY}));`);
 const proxyEnv={...process.env,HTTPS_PROXY:'http://127.0.0.1:18273'};delete proxyEnv.NODE_USE_ENV_PROXY;
 const proxy=spawnSync(exe,[origin],{input:Buffer.alloc(0),windowsHide:true,env:proxyEnv});assert.equal(proxy.status,0);
 assert.deepEqual(JSON.parse(proxy.stdout.toString()),{proxy:'http://127.0.0.1:18273',use:'1'});
 await writeFile(path.join(directory,'host.mjs'),`process.stdout.write(JSON.stringify({https:process.env.HTTPS_PROXY,http:process.env.HTTP_PROXY}));`);
 for(const bad of ['http://proxy.example:8080','http://user:synthetic_password@127.0.0.1:8080','https://localhost:8080','http://127.0.0.1:8080/path']){
  const env={...process.env,HTTPS_PROXY:bad,HTTP_PROXY:'http://localhost:18274',NODE_USE_ENV_PROXY:'1'};
  const result=spawnSync(exe,[origin],{input:Buffer.alloc(0),windowsHide:true,env});assert.equal(result.status,0);
  assert.deepEqual(JSON.parse(result.stdout.toString()),{http:'http://localhost:18274'});assert.equal(result.stderr.length,0);
 }
 const clean=spawnSync(exe,[origin],{input:Buffer.alloc(0),windowsHide:true,env:{...process.env,HTTPS_PROXY:'http://remote.invalid:8080',HTTP_PROXY:'http://synthetic_user:synthetic_pass@localhost:8080'}});
 assert.equal(clean.status,0);assert.deepEqual(JSON.parse(clean.stdout.toString()),{});assert.equal(clean.stderr.length,0);
 await writeFile(path.join(directory,'host.mjs'),`console.error('synthetic diagnostic secret');setInterval(()=>{},1000);`);
 const started=Date.now(),hung=spawnSync(exe,[origin],{input:Buffer.alloc(0),windowsHide:true,timeout:10000});
 assert.ok(Date.now()-started<8000);assert.notEqual(hung.status,0);assert.equal(hung.stderr.length,0);assert.equal(hung.stdout.length,0);
});
