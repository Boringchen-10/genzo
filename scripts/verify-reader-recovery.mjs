import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {chromium} from "playwright-core";

const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial=process.env.GENZO_READER_DEVICE||"emulator-5554",app="com.genzo.android.readerqa";
assert.ok(["emulator-5554","3B164M00Z0500000"].includes(serial));
const output=`D:/DevTools/Android/Build/qa/reader-fixes/${serial}/recovery`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8"});
const binary=(...args)=>execFileSync(adb,["-s",serial,...args]);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await delay(1000);
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);
command("forward","tcp:9337",`localabstract:webview_devtools_remote_${pid}`);
for(let i=0;i<60;i++){
 const connected=await fetch("http://127.0.0.1:9337/json/version").then(r=>r.ok).catch(()=>false);
 if(connected)break;await delay(250);
}
const browser=await chromium.connectOverCDP("http://127.0.0.1:9337",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
const native=(command,payload={})=>invoke("android_native",{command,payload});
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await native("readerState")).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
async function until(predicate,label){for(let i=0;i<150;i++){const state=await native("readerState");if(predicate(state))return state;await delay(100);}throw new Error(label);}
function ui(){command("shell","uiautomator","dump","/data/local/tmp/reader-recovery-ui.xml");return command("shell","cat","/data/local/tmp/reader-recovery-ui.xml");}
function tapText(label){const node=(ui().match(/<node\b[^>]*>/g)||[]).find(node=>node.includes(`text="${label}"`));assert.ok(node,`Missing ${label}`);const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);command("shell","input","tap",String((+b[1]+ +b[3])/2|0),String((+b[2]+ +b[4])/2|0));}
function capture(name){writeFileSync(`${output}/${name}.png`,binary("exec-out","screencap","-p"));}
const result={scope:"Only own synthetic archives in the independent QA package; temporary emulator airplane mode",cases:{}};
const airplane=command("shell","settings","get","global","airplane_mode_on").trim();
let archive,backup,mutated=false;
function replaceArchive(source){
 assert.match(archive,/^reading-cache\/v1\/[a-f0-9]{64}\/complete-[a-z0-9-]+\/chapter\.cbz$/);
 command("push",source,"/data/local/tmp/genzo-reader-fault.bin");
 command("shell","run-as",app,"cp","/data/local/tmp/genzo-reader-fault.bin",archive);
}
try{
 if(serial==="emulator-5554")command("shell","cmd","connectivity","airplane-mode","enable");
 if(serial==="emulator-5554")assert.equal(command("shell","settings","get","global","airplane_mode_on").trim(),"1");
 for(const kind of ["comic","novel"]){
  await invoke("open_internal_reader",{kind,pathWord:`reader-fixture-${kind}`,entryId:"two",group:kind==="comic"?"default":""});
  const ready=await until(s=>s.rendered&&s.status==="ready",`offline ${kind}`);assert.equal(ready.offline,true);
  await control("catalogue");if(kind==="novel")tapText("全部卷册");await delay(200);
  assert.ok(ui().includes(`合成${kind==="comic"?"漫画":"小说"}测试 · 1`),"cached directory works offline");
  command("shell","input","keyevent","4");capture(`${kind}-offline`);result.cases[`${kind}Offline`]=true;
  await control("close");await until(s=>s.status==="closed","close");await delay(400);
 }
 // Damage a fixture only after the manifest is verified. Page 6 is outside the preload window.
 const manifests=command("shell","run-as",app,"find","reading-cache","-name","manifest.json").trim().split(/\r?\n/);
 for(const path of manifests){
  assert.match(path,/^reading-cache\/v1\/[a-f0-9]{64}\/complete-[a-z0-9-]+\/manifest\.json$/);
  const manifest=JSON.parse(command("shell","run-as",app,"cat",path));
  if(manifest.kind==="comic"&&manifest.bookId==="reader-fixture-comic"&&manifest.entryId==="one")archive=path.replace(/manifest\.json$/,"chapter.cbz");
 }
 assert.ok(archive);backup=`${output}/original-fixture.cbz`;writeFileSync(backup,binary("exec-out","run-as",app,"cat",archive));
 await invoke("open_internal_reader",{kind:"comic",pathWord:"reader-fixture-comic",entryId:"one",group:"default"});
 await until(s=>s.rendered,"comic render");await control("settings",0,{mode:"page-horizontal",autoScroll:false});await control("seek",0);await delay(500);
 await control("close");await until(s=>s.status==="closed","close before uncached page test");await delay(400);
 await invoke("open_internal_reader",{kind:"comic",pathWord:"reader-fixture-comic",entryId:"one",group:"default"});await until(s=>s.rendered&&s.location.pageIndex===0,"cold page one");
 writeFileSync(`${output}/fault.bin`,Buffer.from("Intentional damage of an owned reader QA archive"));mutated=true;replaceArchive(`${output}/fault.bin`);
 await control("seek",1);await delay(700);
 assert.ok(ui().includes("第 6 页读取失败"),"native per-page failure is visible");capture("page-failure");result.cases.pageFailure=true;
 replaceArchive(backup);mutated=false;assert.equal(hash(binary("exec-out","run-as",app,"cat",archive)),hash(readFileSync(backup)));
 tapText("重试");await until(s=>s.rendered&&s.location.pageIndex===5,"retry renders restored page");capture("page-recovered");result.cases.pageRetry=true;
 await control("close");await until(s=>s.status==="closed","close");await delay(400);
 await invoke("open_internal_reader",{kind:"comic",pathWord:"reader-fixture-comic",entryId:"one",group:"default"});
 assert.equal((await until(s=>s.rendered,"verified archive reopens")).offline,true);result.cases.archiveRestored=true;
 await control("close");writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);result.state=await native("readerState").catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}
finally{
 if(mutated)replaceArchive(backup);
 if(serial==="emulator-5554")command("shell","cmd","connectivity","airplane-mode",airplane==="1"?"enable":"disable");
 command("shell","rm","-f","/data/local/tmp/genzo-reader-fault.bin");await browser.close();
}
