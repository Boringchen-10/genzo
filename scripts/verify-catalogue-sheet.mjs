import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial="3B164M00Z0500000",app="com.genzo.android.readerqa";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output=`D:/DevTools/Android/Build/qa/catalogue-sheet-${Date.now()}`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",maxBuffer:64*1024*1024});
command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);
await new Promise(r=>setTimeout(r,1500));
const pid=command("shell","pidof",app).trim().split(/\s+/)[0];assert.match(pid,/^\d+$/);
command("forward","tcp:9353",`localabstract:webview_devtools_remote_${pid}`);
for(let attempt=0;attempt<40;attempt++){if(command("shell","cat","/proc/net/unix").includes(`webview_devtools_remote_${pid}`))break;await new Promise(r=>setTimeout(r,250));}
const browser=await chromium.connectOverCDP("http://127.0.0.1:9353",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
page.setDefaultTimeout(30000);
const native=(command,payload={})=>page.evaluate(({command,payload})=>window.__TAURI_INTERNALS__.invoke("android_native",{command,payload}),{command,payload});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,tries=200){for(let i=0;i<tries;i++){const s=await native("readerState");if(predicate(s))return s;assert.notEqual(s.status,"error",JSON.stringify(s));await delay(100);}throw new Error(label);}
const state=()=>native("readerState");
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await state()).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
function xml(){let last;for(let i=0;i<6;i++){try{command("shell","uiautomator","dump","/data/local/tmp/genzo-catalogue.xml");return command("shell","cat","/data/local/tmp/genzo-catalogue.xml");}catch(error){last=error;execFileSync(adb,["-s",serial,"shell","rm","-f","/data/local/tmp/genzo-catalogue.xml"],{stdio:"ignore"});}}throw last;}
const nodeOf=(data,re)=>(data.match(/<node\b[^>]*>/g)||[]).find(node=>re.test(node));
const boundsOf=node=>{const m=node&&node.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);return m?m.slice(1).map(Number):null;};
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:64*1024*1024}));}
const size=command("shell","wm","size").match(/(\d+)x(\d+)/);const cx=Math.round(+size[1]/2),h=+size[2];
const dismiss=async()=>{command("shell","input","keyevent","4");await delay(500);};
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
 await control("catalogue");await delay(900);
 const opened=xml();writeFileSync(`${output}/opened.xml`,opened);
 assert.ok(opened.includes("章节目录"),"chapter sheet must show its title");result.cases.hasTitle=true;
 const scroll=nodeOf(opened,/class="[^"]*ScrollView"/);const top=boundsOf(scroll);
 assert.ok(top&&top[1]>h*0.1&&top[1]<h*0.5,`chapter sheet must open at a partial height (top=${top&&top[1]} of ${h})`);result.cases.opensPartial={top:top[1],screen:h};
 const count=opened.match(/(\d+)\s*\/\s*(\d+)/);
 assert.ok(count,"current chapter position must be shown as N / M");result.cases.positionLabel=count[0];
 assert.ok(opened.includes("当前章节"),"the current chapter must carry the highlight marker");result.cases.highlightsCurrent=true;
 screenshot("opened");
 const rows=(opened.match(/<node\b[^>]*>/g)||[]).filter(node=>node.includes("当前章节"));
 assert.equal(rows.length,1,"exactly one chapter is marked current");result.cases.singleCurrent=true;
 for(let i=0;i<8;i++){command("shell","input","swipe",String(cx),String(Math.round(h*0.80)),String(cx),String(Math.round(h*0.34)),"280");await delay(200);}
 await delay(400);screenshot("scrolled");
 await dismiss();
 const settled=await until(s=>s.status==="ready","reader stays open after dismissing the chapter sheet");result.cases.dismissedCleanly=settled.status==="ready";
 await control("settings",0,{theme:"dark"});
 await control("catalogue");await delay(900);
 const dark=xml();writeFileSync(`${output}/dark.xml`,dark);
 assert.ok(dark.includes("章节目录")&&dark.includes("当前章节"),"chapter sheet renders under the dark theme too");result.cases.darkTheme=true;
 screenshot("dark");
 await dismiss();
 await control("close");await until(s=>s.status==="closed","closed");
 result.passed=true;writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true,cases:result.cases}));
}catch(error){result.error=String(error);result.state=await state().catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
