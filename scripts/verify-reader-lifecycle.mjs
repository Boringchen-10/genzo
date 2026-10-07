import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",app="com.genzo.android.readerqa";
const command=(...args)=>execFileSync(adb,["-s","emulator-5554",...args],{encoding:"utf8"});
const output="D:/DevTools/Android/Build/qa/reader-c/lifecycle";mkdirSync(output,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser,page;
async function connect(){
 command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await delay(900);
 const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);
 for(let i=0;i<40;i++){if(command("shell","cat","/proc/net/unix").includes(`webview_devtools_remote_${pid}`))break;await delay(250);}
 command("forward","tcp:9233",`localabstract:webview_devtools_remote_${pid}`);
 browser=await chromium.connectOverCDP("http://127.0.0.1:9233",{noDefaults:true});page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
 assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);return pid;
}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const native=(command,payload={})=>invoke("android_native",{command,payload});
async function until(test,label){for(let i=0;i<150;i++){const s=await native("readerState");if(test(s))return s;assert.notEqual(s.status,"error",JSON.stringify(s));await delay(100);}throw new Error(label);}
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await native("readerState")).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s","emulator-5554","exec-out","screencap","-p"]));}
const result={cases:{}};
function samePlace(before,after){
 assert.equal(after.href,before.href);
 const paragraph=location=>Number(location.locations?.cssSelector?.match(/^#p(\d+)$/)?.[1]);
 if(Number.isFinite(paragraph(before)))assert.ok(Math.abs(paragraph(after)-paragraph(before))<=8,`Paragraph moved: ${JSON.stringify({before,after})}`);
}
try{
 command("shell","am","force-stop",app);result.initialPid=await connect();
 for(const kind of ["comic","novel"]){
  await invoke("open_internal_reader",{kind,pathWord:`reader-fixture-${kind}`,entryId:"one",group:kind==="comic"?"default":""});await until(s=>s.rendered,"render");
  await control("settings",0,kind==="comic"?{mode:"page-horizontal",rtl:false}:{scroll:false,fontSize:20});await control("seek",.6);await delay(800);
  const before=await native("readerState");
  await control("orientation",1);await until(s=>s.rendered&&s.viewportWidth>s.viewportHeight,"landscape");await delay(700);screenshot(`${kind}-landscape`);
  await control("orientation",0);await until(s=>s.rendered&&s.viewportHeight>s.viewportWidth,"portrait");await delay(700);screenshot(`${kind}-portrait`);
  const after=await native("readerState");
  if(kind==="comic")assert.equal(after.location.pageIndex,before.location.pageIndex);else samePlace(before.location,after.location);
  result.cases[`${kind}Rotation`]={before:before.location,after:after.location};
  await delay(900);await control("close");await until(s=>s.status==="closed","close");await delay(400);
  await browser.close();command("shell","am","force-stop",app);result[`${kind}RestartPid`]=await connect();
  await invoke("open_internal_reader",{kind,pathWord:`reader-fixture-${kind}`,entryId:"one",group:kind==="comic"?"default":""});
  const restored=await until(s=>s.rendered,"restart render");await delay(600);
  if(kind==="comic")assert.equal(restored.location.pageIndex,after.location.pageIndex);else samePlace(after.location,restored.location);
  result.cases[`${kind}Restart`]=restored.location;await control("close");await until(s=>s.status==="closed","closed");await delay(400);
 }
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);result.state=await native("readerState").catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser?.close();}
