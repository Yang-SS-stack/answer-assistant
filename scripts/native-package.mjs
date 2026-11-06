// Fixed release inputs: never enumerate native/ (it can contain local sessions).
import path from 'node:path';import {spawnSync} from 'node:child_process';
export const nativePackageFiles=Object.freeze(['host.mjs','framing.mjs','qwen-console.mjs','credential-store.mjs','Protect.ps1','NativeLauncher.cs','Install.ps1','Uninstall.ps1','README.md','LICENSE-bailian.txt','LICENSE','THIRD_PARTY_NOTICES.md']);
export const nativePackagePath='bridge/answer-assistant-quota-bridge.zip';
export function buildNativePackage(root){
 const script=`import pathlib,sys,json,zipfile,os,stat
r=pathlib.Path(sys.argv[1]); names=json.loads(sys.argv[2]); output=r/sys.argv[3]
inputs=[]
for name in names:
 p=r/name if name in {'LICENSE','THIRD_PARTY_NOTICES.md'} else r/'native'/name
 assert p.is_file() and not p.is_symlink() and not (os.lstat(p).st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT if os.name=='nt' else False), 'Unsafe or missing component source: '+name
 inputs.append((name,p.read_bytes()))
output.parent.mkdir(parents=True,exist_ok=True)
assert not output.parent.is_symlink() and not output.is_symlink(), 'Linked bridge output is unsupported'
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name,data in inputs:
  item=zipfile.ZipInfo(name,(2020,1,1,0,0,0));item.create_system=3;item.external_attr=0o100644<<16
  z.writestr(item,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(output) as z:
 assert z.testzip() is None and z.namelist()==names
 for name,data in inputs:assert z.read(name)==data
`;
 const result=spawnSync('py',['-3','-c',script,path.resolve(root),JSON.stringify(nativePackageFiles),nativePackagePath],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error(result.stderr||'Native component packaging requires Python 3');
 return path.join(root,nativePackagePath);
}
