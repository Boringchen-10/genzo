import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial=process.env.GENZO_READER_DEVICE||"emulator-5554",app="com.genzo.android.readerqa",adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
assert.ok(["emulator-5554","3B164M00Z0500000"].includes(serial));
const shell=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),output=`D:/DevTools/Android/Build/qa/reader-fixes/${serial}/covers`;
mkdirSync(output,{recursive:true});
const pid=shell("shell","pidof",app).trim();assert.match(pid,/^\d+$/);shell("forward","tcp:9336",`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9336",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
assert.equal((await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("get_app_info"))).dataDirectory,`/data/user/0/${app}`);
const result={cases:{}};
const capture=name=>writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{timeout:15000,maxBuffer:16*1024*1024}));
try{
 await page.getByRole("button",{name:"发现",exact:true}).click();
 for(const tab of ["漫画","轻小说"]){
  await page.getByRole("tab",{name:tab,exact:true}).click();
  await page.locator(".comic-explore-cover img").first().waitFor({timeout:20000});
  await page.waitForFunction(()=>[...document.querySelectorAll(".comic-explore-cover img")].some(i=>i.complete&&i.naturalWidth>0&&i.currentSrc.includes("-thumb")),undefined,{timeout:20000});
  const local=await page.locator(".comic-explore-cover img").evaluateAll(es=>es.filter(i=>i.complete&&i.naturalWidth>0&&i.currentSrc.includes("-thumb")).length);assert.ok(local>0);
  for(let i=0;i<3;i++)shell("shell","input","swipe","630","2200","630","450","120");
  await pause(500);capture(`${tab}-down`);
  for(let i=0;i<3;i++)shell("shell","input","swipe","630","500","630","2250","120");
  await pause(600);capture(`${tab}-back`);
  const visible=await page.locator(".comic-explore-cover").evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.width>0;}).map(e=>{const img=e.querySelector("img");return{loaded:!!img?.complete&&img.naturalWidth>0,placeholder:!!e.querySelector(".comic-cover-placeholder"),source:img?.currentSrc};}));
  assert.ok(visible.length>0);assert.ok(visible.every(e=>e.loaded||e.placeholder),"visible cover is decoded or has an explicit loading/retry placeholder");
  assert.equal(await page.locator(".gz-grid > .gz-card").evaluateAll(es=>es.some(e=>getComputedStyle(e).contentVisibility==="auto")),false);
  result.cases[tab]={localThumbnails:local,visible};
 }
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}finally{await browser.close();}
