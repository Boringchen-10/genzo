import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial=process.env.GENZO_READER_DEVICE||"emulator-5554",app="com.genzo.android.readerqa",adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
assert.ok(["3B164M00Z0500000","emulator-5554"].includes(serial));
const output=`D:/DevTools/Android/Build/qa/reader-fixes/${serial}`;mkdirSync(output,{recursive:true});
const shell=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
shell("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await pause(800);
const pid=shell("shell","pidof",app).trim();assert.match(pid,/^\d+$/);shell("forward","tcp:9335",`localabstract:webview_devtools_remote_${pid}`);
const b=await chromium.connectOverCDP("http://127.0.0.1:9335",{noDefaults:true});
const p=b.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
const invoke=(command,args={})=>{let timer;return Promise.race([p.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${command} timed out`)),20000);})]).finally(()=>clearTimeout(timer));};
assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
const native=(command,payload={})=>invoke("android_native",{command,payload});
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await native("readerState")).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
async function until(test,label){for(let i=0;i<100;i++){const s=await native("readerState");assert.notEqual(s.status,"error",JSON.stringify(s));if(test(s))return s;await pause(100);}throw Error(label);}
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{timeout:15000}));}
const result={serial,cases:{},failures:[]};
try{
 const works=await invoke("list_works");
 if((await native("readerState")).status!=="closed"){await control("close");await until(s=>s.status==="closed","close");await pause(300);}
 let started=Date.now();await invoke("open_internal_reader",{kind:"comic",pathWord:"reader-fixture-comic",entryId:"one",group:"default"});await until(s=>s.rendered,"comic");const comicOpenMilliseconds=Date.now()-started;
 const comicSettings=(await native("readerState")).settings;
 await control("settings",0,{mode:"page-horizontal",rtl:false,dimming:0,autoScroll:false});await control("seek",0);await pause(600);
 let state=await until(s=>s.rendered&&s.imageGeometry,"image geometry");const g=state.imageGeometry;
 assert.equal(g.source,"local-cbz");assert.ok(Math.abs((g.left+g.right)/2-g.width/2)<3,"horizontal centering");assert.ok(Math.abs((g.top+g.bottom)/2-g.height/2)<3,"vertical centering");
 result.cases.cachedComic={milliseconds:comicOpenMilliseconds,geometry:g};screenshot("comic-centered");
 await control("settings",0,{mode:"scroll-vertical"});await control("seek",0);await pause(600);state=await until(s=>s.rendered&&s.imageGeometry,"scroll image");assert.ok(Math.abs(state.imageGeometry.top)<3,"no extra top padding inside comic page");result.cases.comicScrollGeometry=state.imageGeometry;screenshot("comic-scroll");
 await control("settings",0,{...comicSettings,mode:comicSettings.mode||"scroll-vertical",dimming:comicSettings.dimming||0,autoScroll:comicSettings.autoScroll||false});await control("close");await until(s=>s.status==="closed","close");await pause(300);
 await invoke("open_reader_online_fixture");await until(s=>s.rendered,"novel");const novelSettings=(await native("readerState")).settings;
 await control("settings",0,{scroll:true,fontSize:20});await control("seek",.1);await pause(600);const initial=await native("readerState");
 for(let i=0;i<5;i++)shell("shell","input","swipe","600","1900","600","400","100");
 state=await until(s=>s.progress>initial.progress,"progress follows real fast swipes");assert.ok(state.location.locations.cssSelector);result.cases.novelFling={before:initial.progress,after:state.progress};screenshot("novel-fling");
 for(const fraction of [.95,.15,.7]){started=Date.now();await control("seek",fraction);state=await until(s=>s.location?.locations?.totalProgression!=null&&Math.abs(s.location.locations.totalProgression-fraction)<.05,"large seek");result.cases[`seek${fraction}`]={milliseconds:Date.now()-started,progress:state.progress};}
 await control("settings",0,{...novelSettings,scroll:novelSettings.scroll||false,fontSize:novelSettings.fontSize||20});await control("close");await until(s=>s.status==="closed","close");await pause(300);
 for(const [command,args,key] of [
  ["get_bangumi_subject_comments",{externalId:"400602",offset:0,limit:2},"bangumiComments"],
  ...["episodes","characters","related","staff"].map(section=>["get_bangumi_subject_structure",{externalId:"400602",section},section]),
  ["get_comic_explore_comments",{pathWord:"modujingbingdenuli",offset:0,limit:2},"copyComments"]
 ]){
  started=Date.now();try{const value=await invoke(command,args);const items=value[key==="related"?"seasons":key.includes("Comments")?"items":key];assert.ok(items?.length>0,`${key} is populated`);result.cases[key]={milliseconds:Date.now()-started,count:items.length};}catch(error){result.failures.push({key,milliseconds:Date.now()-started,error:String(error)});}
 }
 const after=await invoke("list_works");assert.deepEqual(after.map(w=>({id:w.id,status:w.status,favorite:w.favorite,notes:w.notes})),works.map(w=>({id:w.id,status:w.status,favorite:w.favorite,notes:w.notes})));
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));assert.equal(result.failures.length,0,JSON.stringify(result.failures));console.log(JSON.stringify({output,passed:true,cases:result.cases}));
}catch(error){result.error=String(error);result.state=await native("readerState").catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await b.close();}
