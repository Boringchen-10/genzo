import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial="emulator-5554",app="com.genzo.android.readerqa";
const output="D:/DevTools/Android/Build/qa/reader-c/controls";mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8"});
// Each run starts this owned QA package, preserving its reading records.
command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);
await new Promise(r=>setTimeout(r,900));
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);
command("forward","tcp:9233",`localabstract:webview_devtools_remote_${pid}`);
for(let attempt=0;attempt<40;attempt++){
 const sockets=command("shell","cat","/proc/net/unix");
 if(sockets.includes(`webview_devtools_remote_${pid}`)) break;
 await new Promise(resolve=>setTimeout(resolve,250));
}
const browser=await chromium.connectOverCDP("http://127.0.0.1:9233",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
const native=(command,payload={})=>invoke("android_native",{command,payload});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){for(let i=0;i<150;i++){const s=await native("readerState");if(predicate(s))return s;assert.notEqual(s.status,"error",JSON.stringify(s));await delay(100);}throw new Error(label);}
const ready=()=>until(s=>s.status==="ready"&&s.rendered,"rendered reader");
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await native("readerState")).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
function xml(){command("shell","uiautomator","dump","/data/local/tmp/genzo-reader-controls.xml");return command("shell","cat","/data/local/tmp/genzo-reader-controls.xml");}
function tapText(label){const data=xml();const nodes=data.match(/<node\b[^>]*>/g)||[];const node=nodes.find(node=>node.includes(`text="${label}"`));assert.ok(node,`Missing native control: ${label}`);const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);command("shell","input","tap",String((+b[1]+ +b[3])/2|0),String((+b[2]+ +b[4])/2|0));}
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"]));}
const result={pid,cases:{},scope:"Native dialogs and hardware keys in the isolated QA package"};
try{
 await invoke("open_internal_reader",{kind:"comic",pathWord:"reader-fixture-comic",entryId:"one",group:"default"});await ready();
 await control("settings",0,{mode:"page-horizontal",rtl:false,volumeKeys:true,keepScreenOn:true,systemBrightness:false,brightness:.4});await control("seek",.2);await delay(500);
 command("shell","input","keyevent","25");await until(s=>s.location.pageIndex===2,"volume down");
 command("shell","input","keyevent","24");await until(s=>s.location.pageIndex===1,"volume up");result.cases.volumeKeys=true;
 const window=command("shell","dumpsys","window");assert.ok(window.includes("com.genzo.android.ReaderActivity"));
 const attributes=await ready();assert.ok(Math.abs(attributes.windowBrightness-.4)<.01,"selected brightness reaches actual Window attributes");assert.equal(attributes.keepScreenOn,true);result.cases.brightness=true;
 await control("bookmarks");tapText("添加当前位置");await delay(500);
 await control("bookmarks");tapText("查看 / 删除书签");await delay(300);const marks=xml();assert.ok(marks.includes("合成漫画测试"));result.cases.bookmarks=true;screenshot("bookmarks");command("shell","input","keyevent","4");
 await control("catalogue");await delay(500);tapText("合成漫画测试 · 2");await until(s=>s.entryId==="two"&&s.rendered,"catalogue selection");result.cases.catalogue=true;
 await control("chapter-previous");await until(s=>s.entryId==="one"&&s.rendered,"previous chapter");assert.equal((await ready()).location.pageIndex,5,"previous chapter opens at its end");
 await control("chapter-next");await until(s=>s.entryId==="two"&&s.rendered,"next chapter");assert.equal((await ready()).location.pageIndex,0,"next chapter starts at beginning");result.cases.chapterNavigation=true;
 await delay(900);const resume=await invoke("get_reading_resume",{kind:"comic",pathWord:"reader-fixture-comic"});assert.equal(resume.entryId,"two");result.cases.resume=resume;
 await control("settings-sheet");await delay(300);const settings=xml();assert.ok(settings.includes("阅读模式")&&settings.includes("长按放大"));screenshot("settings");command("shell","input","keyevent","4");
 await control("close");await until(s=>s.status==="closed","close");await delay(400);
 await invoke("open_internal_reader",{kind:"novel",pathWord:"reader-fixture-novel",entryId:"one",group:""});await ready();
 await control("settings",0,{scroll:false,fontSize:20});await control("seek",.1);await delay(700);const before=(await ready()).location;
 command("shell","input","keyevent","25");await until(s=>JSON.stringify(s.location)!==JSON.stringify(before),"novel volume-key page");result.cases.novelVolumeKey=true;
 await control("catalogue");tapText("本卷章节");await delay(300);tapText("第二章：继续阅读");await until(s=>s.location.href==="OEBPS/chapter-2.xhtml","novel contents");result.cases.novelContents=true;
 await control("bookmarks");tapText("添加当前位置");await delay(400);result.cases.novelBookmark=true;
 screenshot("novel");await delay(800);const saved=(await ready()).location;await control("close");await until(s=>s.status==="closed","closed");
 result.cases.beforeRestart=saved;writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);result.state=await native("readerState").catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
