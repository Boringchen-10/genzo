import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",app="com.genzo.android.readerqa";
const command=(...args)=>execFileSync(adb,["-s","emulator-5554",...args],{encoding:"utf8"});
const output="D:/DevTools/Android/Build/qa/reader-c/entry";mkdirSync(output,{recursive:true});
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);command("forward","tcp:9233",`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9233",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
const native=(command,payload={})=>invoke("android_native",{command,payload});
const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await native("readerState")).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){for(let i=0;i<150;i++){const s=await native("readerState");if(predicate(s))return s;assert.notEqual(s.status,"error",JSON.stringify(s));await delay(100);}throw new Error(label);}
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s","emulator-5554","exec-out","screencap","-p"]));}
const result={scope:"Real React chapter/resume buttons, Android recents, hardware back and continuous reading",cases:{}};
try{
 if((await native("readerState")).status!=="closed"){await control("close");await until(s=>s.status==="closed","close");await delay(300);}
 const before=await invoke("list_works");
 for(const kind of ["comic","novel"]){
  await page.getByRole("button",{name:"首页",exact:true}).click();
  await page.getByRole("button",{name:new RegExp(`合成${kind==="comic"?"漫画":"小说"}阅读验收`)}).click();
  await page.getByRole("button",{name:new RegExp(`合成${kind==="comic"?"漫画":"小说"}测试 · 1`)}).click();
  await until(s=>s.kind===kind&&s.rendered,"React chapter launches native reader");
  await control("settings",0,kind==="comic"?{mode:"page-horizontal",autoScroll:false,continuous:true}:{scroll:false,fontSize:20});
  await control("seek",.6);await delay(700);const original=await native("readerState");
  command("shell","input","keyevent","3");await delay(500);command("shell","input","keyevent","187");await delay(500);
  command("shell","uiautomator","dump","/data/local/tmp/reader-entry-recents.xml");const xml=command("shell","cat","/data/local/tmp/reader-entry-recents.xml");
  const cards=(xml.match(/<node\b[^>]*>/g)||[]).filter(n=>n.includes('id/snapshot"')).map(n=>n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)).filter(b=>+b[3]- +b[1]>500);
  assert.equal(cards.length,1,"owned QA task is the central most recent card");const b=cards[0];command("shell","input","tap",String((+b[1]+ +b[3])/2|0),String((+b[2]+ +b[4])/2|0));await delay(600);
  assert.ok(command("shell","dumpsys","activity","activities").includes(`Resumed: ActivityRecord`));
  const resumed=await until(s=>s.rendered,"foreground render");assert.equal(resumed.sessionId,original.sessionId);assert.deepEqual(resumed.location,original.location);
  result.cases[`${kind}Background`]=true;screenshot(`${kind}-foreground`);
  if(kind==="comic"){
   await control("seek",1);await delay(500);await control("settings",0,{continuous:false});await control("next");await delay(500);assert.equal((await native("readerState")).entryId,"one");
   await control("settings",0,{continuous:true});await control("next");await until(s=>s.entryId==="two"&&s.rendered,"continuous chapter");assert.equal((await native("readerState")).location.pageIndex,0);result.cases.continuous=true;
  }
  await delay(900);const saved=await native("readerState");command("shell","input","keyevent","4");await until(s=>s.status==="closed","native back");await delay(400);
  await page.getByRole("button",{name:"继续上次阅读",exact:true}).click();const restored=await until(s=>s.kind===kind&&s.rendered,"React resume launches native");
  assert.equal(restored.entryId,saved.entryId);if(kind==="comic")assert.equal(restored.location.pageIndex,saved.location.pageIndex);else assert.equal(restored.location.locations.cssSelector,saved.location.locations.cssSelector);
  result.cases[`${kind}EntryAndResume`]=true;command("shell","input","keyevent","4");await until(s=>s.status==="closed","close");await delay(300);
 }
 const after=await invoke("list_works");assert.deepEqual(after.map(w=>({id:w.id,status:w.status,favorite:w.favorite})),before.map(w=>({id:w.id,status:w.status,favorite:w.favorite})),"opening readers does not mark works read");
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);result.state=await native("readerState").catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
