import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial="3B164M00Z0500000",app="com.genzo.android.readerqa";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output=`D:/DevTools/Android/Build/qa/end-bar-${Date.now()}`;mkdirSync(output,{recursive:true});
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
function xml(){command("shell","uiautomator","dump","/data/local/tmp/genzo-end-bar.xml");return command("shell","cat","/data/local/tmp/genzo-end-bar.xml");}
function hasText(label){return xml().includes(`text="${label}"`);}
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
 result.entryId=(await state()).entryId;
 await control("settings",0,{mode:"page-horizontal",rtl:false,theme:"dark",autoScroll:false});
 await control("seek",.3);await delay(800);
 assert.equal(hasText("下一话"),false,"end bar must not show mid-chapter");result.cases.midChapterHidden=true;
 await control("seek",1.0);await delay(900);
 const atEnd=await state();assert.equal(atEnd.settings.mode,"page-horizontal");assert.equal(atEnd.menuVisible,false);
 assert.ok(hasText("目录"),"paging end bar shows 目录");assert.ok(hasText("下一话"),"paging end bar shows 下一话");assert.ok(hasText("继续翻页进入下一话"),"paging end bar shows hint");
 screenshot("paging-last-page");result.cases.pagingBar=true;
 await control("menu");await delay(700);
 assert.equal((await state()).menuVisible,true);
 assert.equal(hasText("继续翻页进入下一话"),false,"end bar hides while toolbar visible");result.cases.hiddenWithToolbar=true;
 screenshot("paging-toolbar-visible");
 await control("menu");await delay(500);
 await control("settings",0,{mode:"scroll-vertical"});await delay(600);
 await control("seek",1.0);await delay(900);
 const scrollState=await state();assert.equal(scrollState.settings.mode,"scroll-vertical");
 assert.equal(scrollState.menuVisible,false,"toolbar must stay hidden in scroll mode");
 const scrollXml=xml();writeFileSync(`${output}/scroll.xml`,scrollXml);
 const scrollTexts=(scrollXml.match(/text="[^"]*"/g)||[]).filter(v=>v!=='text=""');
 result.scrollTexts=[...new Set(scrollTexts)];
 assert.ok(hasText("目录"),"scroll end bar shows 目录");
 assert.equal(hasText("下一话"),false,"scroll end bar has no 下一话");
 assert.equal(hasText("继续翻页进入下一话"),false,"scroll end bar has no hint");
 screenshot("scroll-last-page");result.cases.scrollBar=true;
 await control("close");await until(s=>s.status==="closed","closed");
 result.passed=true;writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true,cases:result.cases}));
}catch(error){result.error=String(error);result.state=await state().catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
