// Native system picker regression for the connected OnePlus QA device.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial="3B164M00Z0500000",app="com.genzo.android.readerqa",adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output=`D:/DevTools/Android/Build/qa/package-picker-${Date.now()}`,name=`Genzo-qa-final-${Date.now()}`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await pause(1200);
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);command("forward","tcp:9342",`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9342",{noDefaults:true}),page=browser.contexts()[0].pages()[0];
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
function nodes(){
 command("shell","uiautomator","dump","/sdcard/genzo-qa-package-ui.xml");const xml=command("shell","cat","/sdcard/genzo-qa-package-ui.xml");
 return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(([,attributes])=>Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value.replaceAll("&#10;","\n").replaceAll("&amp;","&")])));
}
function tap(node){assert.ok(node,"Expected picker control");const values=node.bounds.match(/\d+/g).map(Number);assert.ok(values[2]>values[0]&&values[3]>values[1]);command("shell","input","tap",String(Math.round((values[0]+values[2])/2)),String(Math.round((values[1]+values[3])/2)));}
const allFiles=items=>items.find(n=>n.text==="全部文件"&&n["resource-id"].endsWith("item_title"));
const result={output,cases:{}};
try{
 assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
 const before=await invoke("list_works");
 await page.evaluate(()=>{location.hash="#/sync/webdav";});await page.getByRole("button",{name:"导出资料包",exact:true}).waitFor();
 await page.evaluate(()=>{window.__qaPackageSave=window.__TAURI_INTERNALS__.invoke("export_personal_data_file");});await pause(300);
 let items=nodes();if(allFiles(items)){tap(allFiles(items));items=nodes();}
 const edit=items.find(n=>n["resource-id"].endsWith("edit_file_name")&&n.class==="android.widget.EditText");tap(edit);
 command("shell","input","keyevent","123");command("shell","input","keyevent",...Array(50).fill("67"));command("shell","input","text",name);command("shell","input","keyevent","4");
 items=nodes();if(allFiles(items)){tap(allFiles(items));items=nodes();}
 assert.ok(items.some(n=>n.text===name),"Unique generated export name");tap(items.find(n=>n["resource-id"].endsWith("action_file_operate")&&n.text==="保存"));
 assert.equal((await page.evaluate(()=>window.__qaPackageSave)).status,"saved");result.cases.systemSave=true;
 await page.getByRole("button",{name:"选择资料包并预览",exact:true}).click();await pause(300);
 items=nodes();tap(items.find(n=>n["resource-id"].endsWith("action_search")));items=nodes();tap(items.find(n=>n["resource-id"].endsWith("search_src_text")));
 command("shell","input","text",name);items=nodes();tap(items.find(n=>n["resource-id"].endsWith("file_list_item_title")&&n.text.replaceAll("\n","")===name));
 await page.getByRole("button",{name:"导入所选记录",exact:true}).waitFor();result.cases.systemOpenAndPreview=true;
 const readingChoice=page.getByText(/导入 \d+ 条阅读位置/);if(await readingChoice.count())assert.equal(await readingChoice.locator('input').isChecked(),false);
 assert.equal(await page.locator("select").evaluateAll(items=>items.filter(e=>e.closest('[aria-label="离线资料包"]')).every(e=>e.value==="")),true);
 const fileChoice=page.locator('[aria-label="离线资料包"] label.field').filter({hasText:"h264.mp4"}).locator('select');
 if(await fileChoice.count()){
  const candidate=await fileChoice.locator('option').evaluateAll(items=>items.find(option=>option.value)?.value);assert.ok(candidate);await fileChoice.selectOption(candidate);
  await page.locator('[aria-label="离线资料包"] .sync-check').filter({hasText:"Genzo 多设备合成验收"}).locator('input').uncheck();
  result.cases.deselectedFileBindingExcluded=true;
 }
 await page.getByRole("button",{name:"导入所选记录",exact:true}).click();await page.getByText(/导入完成：/).waitFor();
 const after=await invoke("list_works");assert.deepEqual(after.map(w=>[w.id,w.status,w.favorite,w.rating,w.notes]),before.map(w=>[w.id,w.status,w.favorite,w.rating,w.notes]));result.cases.roundtripPreservesExisting=true;
 writeFileSync(`${output}/screen.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:16*1024*1024}));
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}
finally{await browser.close();}
