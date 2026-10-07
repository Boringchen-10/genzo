import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial="emulator-5554",app="com.genzo.android.readerqa";
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8"});
const output="D:/DevTools/Android/Build/qa/reader-c/gestures";mkdirSync(output,{recursive:true});
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);command("forward","tcp:9233",`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9233",{noDefaults:true});const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
const native=(command,payload={})=>invoke("android_native",{command,payload});const delay=ms=>new Promise(r=>setTimeout(r,ms));
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await native("readerState")).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
async function until(predicate,label){for(let i=0;i<100;i++){const s=await native("readerState");if(predicate(s))return s;await delay(100);}throw new Error(label);}
function capture(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"]));}
function ui(){command("shell","uiautomator","dump","/data/local/tmp/reader-gesture-ui.xml");return command("shell","cat","/data/local/tmp/reader-gesture-ui.xml");}
const result={cases:{}};
try{
 if((await native("readerState")).status!=="closed"){command("shell","input","keyevent","4");await delay(300);if((await native("readerState")).status!=="closed"){await control("close");await until(s=>s.status==="closed","close");}}
 await invoke("open_internal_reader",{kind:"comic",pathWord:"reader-fixture-comic",entryId:"one",group:"default"});await until(s=>s.rendered,"render");
 await control("settings",0,{mode:"page-horizontal",rtl:false,longPressZoom:true,autoScroll:false});await control("seek",0);await delay(600);
 assert.ok(command("shell","dumpsys","window").includes("com.genzo.android.ReaderActivity"));
 command("shell","CLASSPATH=/data/local/tmp/genzo-reader-gesture.jar","app_process","/","com.genzo.qa.ReaderGesture","540","1100");
 const pinched=await until(s=>s.zoomRatio>1.5,"two-finger zoom");result.cases.pinch=pinched.zoomRatio;capture("pinch");
 await control("settings",0,{mode:"page-vertical"});await control("settings",0,{mode:"page-horizontal"});await control("seek",0);await until(s=>s.rendered&&s.zoomRatio<1.1,"reset zoom");await delay(500);
 const originalZoom=(await native("readerState")).zoomRatio;
 const press=spawn(adb,["-s",serial,"shell","input","touchscreen","swipe","540","1100","540","1100","2600"]);
 const finished=new Promise((resolve,reject)=>{press.on("error",reject);press.on("exit",code=>code===0?resolve():reject(new Error(`Press failed ${code}`)));});
 await delay(1100);const held=await native("readerState");assert.ok(held.zoomRatio>1.5,"long press zooms while held");capture("held");await finished;await delay(400);
 const released=await native("readerState");assert.ok(Math.abs(released.zoomRatio-originalZoom)<.1,"release restores original zoom");result.cases.longPress={original:originalZoom,held:held.zoomRatio,released:released.zoomRatio};
 command("shell","input","tap","540","1100");await delay(100);command("shell","input","tap","540","1100");await delay(600);
 const viewer=ui();assert.ok(viewer.includes('text="旋转"')&&viewer.includes('text="重置"'),"double tap opens viewer");result.cases.doubleTap=true;capture("viewer");command("shell","input","keyevent","4");await delay(300);
 await control("settings",0,{mode:"scroll-vertical",autoScroll:true,autoSpeed:100});await control("seek",0);await delay(300);const initial=(await native("readerState")).location;
 if((await native("readerState")).menuVisible)await control("menu");await delay(2600);const after=(await native("readerState")).location;assert.notDeepEqual(after,initial,"auto scroll moves content");result.cases.autoScroll={initial,after};await control("settings",0,{autoScroll:false});
 await control("close");writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);result.state=await native("readerState").catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
