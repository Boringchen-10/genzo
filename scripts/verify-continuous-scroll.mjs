import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial="3B164M00Z0500000",app="com.genzo.android.readerqa";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output=`D:/DevTools/Android/Build/qa/continuous-scroll-${Date.now()}`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",maxBuffer:64*1024*1024});
command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);
await new Promise(r=>setTimeout(r,1500));
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);
command("forward","tcp:9333",`localabstract:webview_devtools_remote_${pid}`);
for(let attempt=0;attempt<40;attempt++){if(command("shell","cat","/proc/net/unix").includes(`webview_devtools_remote_${pid}`))break;await new Promise(r=>setTimeout(r,250));}
const browser=await chromium.connectOverCDP("http://127.0.0.1:9333",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
page.setDefaultTimeout(30000);
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const native=(command,payload={})=>invoke("android_native",{command,payload});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,tries=200){for(let i=0;i<tries;i++){const s=await native("readerState");if(predicate(s))return s;assert.notEqual(s.status,"error",JSON.stringify(s));await delay(100);}throw new Error(label);}
const state=()=>native("readerState");
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await state()).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
function xml(){command("shell","uiautomator","dump","/data/local/tmp/genzo-scroll.xml");return command("shell","cat","/data/local/tmp/genzo-scroll.xml");}
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:64*1024*1024}));}
const result={serial,app,output,cases:{}};
try{
 await page.getByRole("navigation",{name:"主导航"}).getByRole("button",{name:"发现",exact:true}).click();
 await page.getByRole("tab",{name:"漫画",exact:true}).click();
 await page.getByRole("button",{name:"搜索",exact:true}).click();
 await page.getByRole("searchbox",{name:"搜索漫画"}).fill("魔都");
 await page.getByRole("searchbox",{name:"搜索漫画"}).press("Enter");
 await page.getByText("魔都的星塵",{exact:true}).click();
 const chapter=page.locator(".gz-online-chapters [data-chapter-id]").first();
 await chapter.waitFor();await chapter.click();
 await until(s=>s.status==="ready"&&s.rendered,"rendered reader");
 if((await state()).menuVisible)await control("menu");
 await control("settings",0,{mode:"scroll-vertical",rtl:false,theme:"dark",autoScroll:false});
 await delay(700);
 const start=await state();
 result.chapterA={entryId:start.entryId,title:start.title};
 await control("seek",1.0);await delay(1100);
 const boundary=xml();
 writeFileSync(`${output}/boundary.xml`,boundary);
 screenshot("boundary");
 let sawBar=boundary.includes('text="目录"')||boundary.includes('text="&#'+'30446;');
 let sawComments=boundary.includes('text="本话评论"');
 // The chapter boundary is a thin inline band: sample it right after seek (deterministic),
 // then nudge forward in small steps to prove the next chapter continues in the same list.
 let crossed=false;
 if(sawComments)screenshot("between-chapter-bar");
 for(let i=0;i<14&&!crossed;i++){
  await control("next");await delay(600);
  const s=await state();
  if(s.entryId&&s.entryId!==start.entryId){crossed=true;result.chapterB={entryId:s.entryId,title:s.title};screenshot("next-chapter");}
 }
 result.boundaryPills={directory:sawBar,comments:sawComments};
 result.cases.separatorVisible=sawBar;assert.ok(sawBar,"between-chapter 目录 pill must appear inline");
 result.cases.commentsPill=sawComments;assert.ok(sawComments,"本话评论 pill must appear inline");
 result.cases.crossed=crossed;assert.ok(crossed,"scrolling past the bar must continue into the next chapter (continuous)");
 result.passed=true;writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true,cases:result.cases,chapterA:result.chapterA,chapterB:result.chapterB}));
}catch(error){result.error=String(error);result.state=await state().catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
