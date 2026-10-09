import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial="3B164M00Z0500000",app="com.genzo.android.readerqa";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output=`D:/DevTools/Android/Build/qa/auto-scroll-${Date.now()}`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",maxBuffer:64*1024*1024});
command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);
await new Promise(r=>setTimeout(r,1500));
const pid=command("shell","pidof",app).trim().split(/\s+/)[0];assert.match(pid,/^\d+$/);
command("forward","tcp:9343",`localabstract:webview_devtools_remote_${pid}`);
for(let attempt=0;attempt<40;attempt++){if(command("shell","cat","/proc/net/unix").includes(`webview_devtools_remote_${pid}`))break;await new Promise(r=>setTimeout(r,250));}
const browser=await chromium.connectOverCDP("http://127.0.0.1:9343",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
page.setDefaultTimeout(30000);
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const native=(command,payload={})=>invoke("android_native",{command,payload});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,tries=200){for(let i=0;i<tries;i++){const s=await native("readerState");if(predicate(s))return s;assert.notEqual(s.status,"error",JSON.stringify(s));await delay(100);}throw new Error(label);}
const state=()=>native("readerState");
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await state()).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
function xml(){command("shell","uiautomator","dump","/data/local/tmp/genzo-auto-scroll.xml");return command("shell","cat","/data/local/tmp/genzo-auto-scroll.xml");}
function hasText(label){return xml().includes(`text="${label}"`);}
function tapText(label){const data=xml();const nodes=data.match(/<node\b[^>]*>/g)||[];const node=nodes.find(node=>node.includes(`text="${label}"`));assert.ok(node,`Missing native control: ${label}`);const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);command("shell","input","tap",String((+b[1]+ +b[3])/2|0),String((+b[2]+ +b[4])/2|0));}
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:64*1024*1024}));}
const result={serial,app,output,cases:{}};
const dismiss=async()=>{command("shell","input","keyevent","4");await delay(500);};
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
 await control("settings",0,{autoScroll:false});
 await control("settings-sheet");await delay(600);
 const offXml=xml();writeFileSync(`${output}/auto-off.xml`,offXml);
 assert.ok(offXml.includes("自动滚动"),"auto-scroll toggle is present when disabled");
 assert.equal(offXml.includes("自动滚动速度"),false,"auto-scroll detail must collapse while disabled");
 assert.ok(offXml.includes("页面间距"),"unrelated rows stay visible while collapsed");result.cases.collapsedWhenOff=true;
 screenshot("auto-off");await dismiss();
 await control("settings",0,{autoScroll:true});
 await control("settings-sheet");await delay(600);
 const onXml=xml();writeFileSync(`${output}/auto-on.xml`,onXml);
 assert.ok(onXml.includes("自动滚动"),"auto-scroll toggle is present when enabled");
 assert.ok(onXml.includes("自动滚动速度"),"auto-scroll detail must expand while enabled");result.cases.expandedWhenOn=true;
 screenshot("auto-on");await dismiss();
 await control("settings",0,{autoScroll:false});
 await control("settings-sheet");await delay(600);
 assert.equal(xml().includes("自动滚动速度"),false,"detail collapses again once disabled");
 tapText("自动滚动");await delay(600);
 assert.ok(xml().includes("自动滚动速度"),"toggling the switch live expands the detail");result.cases.liveToggle=true;
 assert.equal((await state()).settings.autoScroll,true,"switch state persisted");
 screenshot("auto-live-toggle");await dismiss();
 await control("close");await until(s=>s.status==="closed","closed");
 result.passed=true;writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true,cases:result.cases}));
}catch(error){result.error=String(error);result.state=await state().catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
