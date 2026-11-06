using System;
using System.IO;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;
internal static class NativeLauncher {
 static bool Absolute(string value) { return !String.IsNullOrEmpty(value) && Path.IsPathRooted(value) && Path.GetFullPath(value)==value; }
 // Fixed arguments are file paths and a validated origin, neither can contain quotes.
 static string Quote(string value) { if(value.IndexOf('"')>=0)throw new ArgumentException();return "\""+value+"\""; }
 static void Relay(Stream source, Stream target) { byte[] b=new byte[8192];int n;while((n=source.Read(b,0,b.Length))>0){target.Write(b,0,n);target.Flush();} }
 static bool LoopbackProxy(string raw) {
  Uri uri;
  return !String.IsNullOrEmpty(raw) && System.Text.RegularExpressions.Regex.IsMatch(raw,@"\Ahttp://(127\.0\.0\.1|localhost):[0-9]{1,5}/?\z",System.Text.RegularExpressions.RegexOptions.IgnoreCase)
   && Uri.TryCreate(raw,UriKind.Absolute,out uri) && uri.Scheme=="http" && uri.UserInfo=="" && (uri.Host=="127.0.0.1" || uri.Host=="localhost") && uri.Port>0 && uri.Port<=65535 && uri.AbsolutePath=="/" && uri.Query=="" && uri.Fragment=="";
 }
 static void Proxy(ProcessStartInfo info) {
  try {
   bool inherited=false,allowed=false;
   foreach(string key in new string[]{"HTTPS_PROXY","HTTP_PROXY"}) {
    string value=Environment.GetEnvironmentVariable(key);
    if(!String.IsNullOrEmpty(value))inherited=true;
    if(LoopbackProxy(value))allowed=true;else info.EnvironmentVariables.Remove(key);
   }
   if(inherited) {
    if(allowed && String.IsNullOrEmpty(Environment.GetEnvironmentVariable("NODE_USE_ENV_PROXY")))info.EnvironmentVariables["NODE_USE_ENV_PROXY"]="1";
    return; // Do not replace explicitly supplied but rejected proxies with a system fallback.
   }
   using(RegistryKey key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings")) {
    if(key==null || Convert.ToInt32(key.GetValue("ProxyEnable",0))!=1) return;
    string raw=key.GetValue("ProxyServer","") as string;
    if(String.IsNullOrEmpty(raw))return;
    if(raw.IndexOf(';')>=0 || raw.StartsWith("http=")) { string found=null;foreach(string part in raw.Split(';'))if(part.StartsWith("http=",StringComparison.OrdinalIgnoreCase))found=part.Substring(5);raw=found; }
    if(String.IsNullOrEmpty(raw))return;
    raw=raw.IndexOf("://")>=0?raw:"http://"+raw;if(!LoopbackProxy(raw))return;Uri uri=new Uri(raw);
    info.EnvironmentVariables["HTTPS_PROXY"]=uri.GetLeftPart(UriPartial.Authority);info.EnvironmentVariables["HTTP_PROXY"]=uri.GetLeftPart(UriPartial.Authority);
    if(String.IsNullOrEmpty(Environment.GetEnvironmentVariable("NODE_USE_ENV_PROXY")))info.EnvironmentVariables["NODE_USE_ENV_PROXY"]="1";
   }
  } catch {}
 }
 public static int Main(string[] args) {
  Process child=null;
  try {
   string dir=AppDomain.CurrentDomain.BaseDirectory;
   string configFile=Path.Combine(dir,"host-config.json");if(new FileInfo(configFile).Length>8192)return 2;
   var c=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(configFile));
   if(Convert.ToInt32(c["version"])!=1 || (string)c["bridgeVersion"]!="4.12.0")return 2;
   string origin=(string)c["origin"],node=(string)c["nodePath"];
   if(!System.Text.RegularExpressions.Regex.IsMatch(origin,@"\Achrome-extension://[a-p]{32}/\z") || args.Length<1 || args[0]!=origin || !Absolute(node) || !File.Exists(node))return 2;
   var versionInfo=new ProcessStartInfo(node,"--version"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
   using(Process version=Process.Start(versionInfo)) {
    if(!version.WaitForExit(2000)){version.Kill();return 2;}
    string output=version.StandardOutput.ReadToEnd().Trim();Version v;
    if(version.ExitCode!=0 || !Version.TryParse(output.TrimStart('v'),out v) || v.CompareTo(new Version(24,5,0))<0)return 2;
   }
   var info=new ProcessStartInfo(node,Quote(Path.Combine(dir,"host.mjs"))+" --origin "+Quote(origin)){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=dir,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
   Proxy(info);child=Process.Start(info);
   // Drain diagnostics without forwarding them to the browser or logs.
   Thread errors=new Thread(delegate(){try{byte[] b=new byte[4096];while(child.StandardError.BaseStream.Read(b,0,b.Length)>0){}}catch{}});errors.IsBackground=true;errors.Start();
   Thread outputThread=new Thread(delegate(){try{Relay(child.StandardOutput.BaseStream,Console.OpenStandardOutput());}catch{}});outputThread.IsBackground=true;outputThread.Start();
   Relay(Console.OpenStandardInput(),child.StandardInput.BaseStream);child.StandardInput.Close();
   if(!child.WaitForExit(2000)){child.Kill();child.WaitForExit();}
   outputThread.Join(1000);return child.ExitCode;
  }catch{if(child!=null)try{if(!child.HasExited)child.Kill();}catch{}return 2;}
 }
}
