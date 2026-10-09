import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial="3B164M00Z0500000",app="com.genzo.android.readerqa";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output=`D:/DevTools/Android/Build/qa/settings-ui-${Date.now()}`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",maxBuffer:64*1024*1024});
command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);
await new Promise(r=>setTimeout(r,1500));
const pid=command("shell","pidof",app).trim().split(/\s+/)[0];assert.match(pid,/^\d+$/);
command("forward","tcp:9363",`localabstract:webview_devtools_remote_${pid}`);
for(let attempt=0;attempt<40;attempt++){if(command("shell","cat","/proc/net/unix").includes(`webview_devtools_remote_${pid}`))break;await new Promise(r=>setTimeout(r,250));}
const browser=await chromium.connectOverCDP("http://127.0.0.1:9363",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
page.setDefaultTimeout(30000);
const native=(command,payload={})=>page.evaluate(({command,payload})=>window.__TAURI_INTERNALS__.invoke("android_native",{command,payload}),{command,payload});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,tries=200){for(let i=0;i<tries;i++){const s=await native("readerState");if(predicate(s))return s;assert.notEqual(s.status,"error",JSON.stringify(s));await delay(100);}throw new Error(label);}
const state=()=>native("readerState");
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await state()).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
function xml(){let last;for(let i=0;i<6;i++){try{command("shell","uiautomator","dump","/data/local/tmp/genzo-settings-ui.xml");return command("shell","cat","/data/local/tmp/genzo-settings-ui.xml");}catch(error){last=error;execFileSync(adb,["-s",serial,"shell","rm","-f","/data/local/tmp/genzo-settings-ui.xml"],{stdio:"ignore"});}}throw last;}
function tapText(label){const data=xml();const nodes=data.match(/<node\b[^>]*>/g)||[];const node=nodes.find(node=>node.includes(`text="${label}"`));assert.ok(node,`Missing native control: ${label}`);const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);command("shell","input","tap",String((+b[1]+ +b[3])/2|0),String((+b[2]+ +b[4])/2|0));}
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:64*1024*1024}));}
const size=command("shell","wm","size").match(/(\d+)x(\d+)/);const cx=Math.round(+size[1]/2),h=+size[2];
const swipeUp=()=>command("shell","input","swipe",String(cx),String(Math.round(h*0.82)),String(cx),String(Math.round(h*0.24)),"260");
const swipeDown=()=>command("shell","input","swipe",String(cx),String(Math.round(h*0.24)),String(cx),String(Math.round(h*0.82)),"260");
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
 await control("settings",0,{theme:"dark",autoScroll:false});
 await control("settings-sheet");await delay(900);
 const top=xml();writeFileSync(`${output}/dark-top.xml`,top);
 for(const label of ["阅读设置","阅读配色","翻页方式","排版","自动进入下一章","长按放大","自动滚动"]){
  assert.ok(top.includes(`text="${label}"`),`grouped sheet must show ${label}`);
 }
 screenshot("dark-top");result.cases.grouped=true;
 assert.equal(top.includes("阅读亮度"),false,"system card starts below the fold");
 for(let i=0;i<5;i++){swipeUp();await delay(220);}
 await delay(300);const bottom=xml();writeFileSync(`${output}/dark-bottom.xml`,bottom);
 for(const label of ["显示","系统","阅读亮度"]){assert.ok(bottom.includes(`text="${label}"`),`scrolled sheet must show ${label}`);}
 screenshot("dark-bottom");result.cases.bottomReachable=true;
 for(let i=0;i<6;i++){swipeDown();await delay(200);}
 await delay(300);
 tapText("阅读配色");await delay(900);
 const theme=xml();writeFileSync(`${output}/theme-sheet.xml`,theme);
 for(const label of ["深色","纸张","白色","护眼绿"]){assert.ok(theme.includes(`text="${label}"`),`theme sheet must list ${label}`);}
 assert.ok(theme.includes('content-desc="已选"'),"current theme row is marked as selected");
 assert.ok(/class="[^"]*ScrollView"/.test(theme),"theme sheet uses the styled scroll container");
 screenshot("theme-sheet");result.cases.themeSheet=true;
 tapText("白色");await delay(700);
 assert.equal((await state()).settings.theme,"white","choosing 白色 persists the theme");
 screenshot("after-pick-white");result.cases.themePersisted=true;
 await dismiss();
 await control("settings",0,{theme:"white"});await control("settings-sheet");await delay(900);
 const light=xml();writeFileSync(`${output}/light-top.xml`,light);
 assert.ok(light.includes('text="白色"'),"value row reflects the active theme");
 assert.ok(light.includes('text="阅读设置"'),"sheet reopens in light theme");
 screenshot("light-theme");result.cases.lightTheme=true;
 await dismiss();
 await control("settings",0,{theme:"dark"});
 await control("close");await until(s=>s.status==="closed","closed");
 result.passed=true;writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true,cases:result.cases}));
}catch(error){result.error=String(error);result.state=await state().catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
