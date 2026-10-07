import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output = "D:/DevTools/Android/Build/qa/reader-c/online";
mkdirSync(output, { recursive: true });
const pid = execFileSync(adb,["-s","emulator-5554","shell","pidof","com.genzo.android.readerqa"],{encoding:"utf8"}).trim();
execFileSync(adb,["-s","emulator-5554","forward","tcp:9233",`localabstract:webview_devtools_remote_${pid}`]);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9233",{noDefaults:true});
const page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost"));
const invoke = (command,args={}) => page.evaluate(({command,args}) => window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
assert.equal((await invoke("get_app_info")).dataDirectory,"/data/user/0/com.genzo.android.readerqa");
const native = (command,payload={}) => invoke("android_native",{command,payload});
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(predicate,label) { for(let i=0;i<150;i++){const state=await native("readerState"); if(predicate(state))return state;assert.notEqual(state.status,"error",JSON.stringify(state));await delay(100);}throw new Error(label); }
const control = async(action,value=0,settings) => native("readerControl",{sessionId:(await native("readerState")).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
function screenshot(name){writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s","emulator-5554","exec-out","screencap","-p"]));}
const result={fixture:"Own synthetic TXT/illustration through live HTTP Publication, not a third-party content test",cases:{}};
try {
  if((await native("readerState")).status!=="closed"){await control("close");await until(s=>s.status==="closed","close");await delay(400);}
  await invoke("open_reader_online_fixture");
  let state=await until(s=>s.status==="ready"&&s.rendered,"online render");
  assert.equal(state.offline,false);result.cases.open=state;
  await control("settings",0,{scroll:true,fontSize:20,theme:"dark"});await control("seek",.1);await delay(900);
  const before=(await native("readerState")).location;
  await control("next");
  state=await until(s=>JSON.stringify(s.location)!==JSON.stringify(before),"scroll movement");
  result.cases.scrollNext=state;screenshot("text");
  const targets=browser.contexts()[0].pages();
  const text=targets.find(p=>p.url().endsWith(state.location.href));
  assert.ok(text);const content=await text.evaluate(()=>({text:document.body.innerText,paragraphs:document.querySelectorAll('p[id]').length}));
  assert.ok(content.text.includes("合成段落"));assert.equal(content.paragraphs,300);
  // Move to illustration with the actual chapter button behavior exposed by QA.
  await control("menu");
  execFileSync(adb,["-s","emulator-5554","shell","uiautomator","dump","/data/local/tmp/reader-online-ui.xml"]);
  const xml=execFileSync(adb,["-s","emulator-5554","shell","cat","/data/local/tmp/reader-online-ui.xml"],{encoding:"utf8"});
  const button=xml.match(/<node[^>]*text="下一章"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(button,"chapter button must exist");
  execFileSync(adb,["-s","emulator-5554","shell","input","tap",String((+button[1]+ +button[3])/2|0),String((+button[2]+ +button[4])/2|0)]);
  state=await until(s=>s.location?.href==="OEBPS/chapter-1.xhtml","illustration chapter");await delay(700);
  const illustration=browser.contexts()[0].pages().find(p=>p.url().endsWith("chapter-1.xhtml"));assert.ok(illustration);
  const image=await illustration.evaluate(()=>{const image=document.querySelector('img');return {loaded:!!image?.complete&&image.naturalWidth>0,href:image?.closest('a')?.href,width:image?.naturalWidth};});
  assert.equal(image.loaded,true);assert.equal(image.width,1000);assert.ok(image.href.startsWith("genzo-image:"));
  result.cases.illustration={state,image};screenshot("illustration");
  await illustration.locator("img").click({noWaitAfter:true});await delay(700);screenshot("illustration-viewer");
  execFileSync(adb,["-s","emulator-5554","shell","uiautomator","dump","/data/local/tmp/reader-viewer-ui.xml"]);
  const viewer=execFileSync(adb,["-s","emulator-5554","shell","cat","/data/local/tmp/reader-viewer-ui.xml"],{encoding:"utf8"});
  assert.ok(viewer.includes('text="旋转"')&&viewer.includes('text="重置"'),"native illustration viewer must open");
  result.cases.viewer=true;
  execFileSync(adb,["-s","emulator-5554","shell","input","keyevent","4"]);await delay(300);
  await control("close");await until(s=>s.status==="closed","close");
  writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
} catch(error){result.error=String(error);result.state=await native("readerState").catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
