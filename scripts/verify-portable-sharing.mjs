// Isolated Windows profile and Android QA package; no ordinary application data.
import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
import {promisify} from "node:util";
import {randomBytes} from "node:crypto";
import {createServer} from "node:http";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const app="com.genzo.android.readerqa",serial="3B164M00Z0500000",adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output=`D:/DevTools/Android/Build/qa/portable-sharing-${Date.now()}`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});
const username="qa",password=randomBytes(24).toString("hex"),authorization=`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const endpoint="http://127.0.0.1:51799/library/",files=new Map();let revision=0;
const cli="D:/DevTools/Android/Build/genzo-sync/debug/examples/device.exe";
const {stdout}=await promisify(execFile)(cli,["document"],{env:{...process.env,GENZO_SYNC_QA_DB:"D:/DevTools/Android/Build/qa/webdav-native-1791425850165/windows.db"},encoding:"utf8"});
files.set("/library/state.json",{bytes:Buffer.from(stdout),etag:`"r-${++revision}"`});
const server=createServer((request,response)=>{
 if(request.headers.authorization!==authorization){response.writeHead(401);response.end();return;}
 const entry=files.get(request.url);
 if(request.method==="GET"){if(!entry){response.writeHead(404);response.end();return;}response.writeHead(200,{ETag:entry.etag});response.end(entry.bytes);return;}
 if(request.method==="DELETE"){files.delete(request.url);response.writeHead(204);response.end();return;}
 if(request.method==="PUT"){
  const chunks=[];request.on("data",chunk=>chunks.push(chunk));request.on("end",()=>{
   if(request.headers["if-none-match"]==="*"&&entry||request.headers["if-match"]&&request.headers["if-match"]!==entry?.etag){response.writeHead(412);response.end();return;}
   files.set(request.url,{bytes:Buffer.concat(chunks),etag:`"r-${++revision}"`});response.writeHead(201);response.end();
  });return;
 }
 response.writeHead(405);response.end();
});
await new Promise(resolve=>server.listen(51799,"127.0.0.1",resolve));command("reverse","tcp:51799","tcp:51799");
command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await new Promise(r=>setTimeout(r,1400));
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);command("forward","tcp:9342",`localabstract:webview_devtools_remote_${pid}`);
const desktop=await chromium.connectOverCDP("http://127.0.0.1:9343",{noDefaults:true}),phone=await chromium.connectOverCDP("http://127.0.0.1:9342",{noDefaults:true});
const pc=desktop.contexts()[0].pages()[0],mobile=phone.contexts()[0].pages()[0];
const invoke=(page,command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const result={output,cases:{}};
try{
 assert.ok((await invoke(pc,"get_app_info")).dataDirectory.endsWith("com.genzo.desktop.sharingqa"));
 assert.equal((await invoke(mobile,"get_app_info")).dataDirectory,`/data/user/0/${app}`);
 const mobileStatus=await invoke(mobile,"sync_status");assert.equal(mobileStatus.endpoint,endpoint);
 await invoke(mobile,"sync_update_credentials",{username,password});await invoke(mobile,"sync_set_enabled",{enabled:false});
 const pcStatus=await invoke(pc,"sync_status");
 if(!pcStatus.connected) await invoke(pc,"sync_connect",{input:{endpoint,username,password,deviceName:"资料包合成测试电脑",allowLoopbackHttp:true},mode:"join"});
 else {assert.equal(pcStatus.endpoint,endpoint);assert.equal(pcStatus.libraryId,mobileStatus.libraryId);await invoke(pc,"sync_update_credentials",{username,password});}
 await invoke(pc,"sync_set_enabled",{enabled:false});
 const keys=["f300ea92-376e-4d8a-8030-ad235c032566","37731d65-cd14-4678-88ab-bfdfae84c779"];
 const works=["comic","novel"].map((kind,index)=>({portableId:keys[index],title:`Genzo 资料包合成验收 ${kind}`,originalTitle:null,kind,description:"自制资料，不含媒体正文",status:"planned",favorite:true,rating:7,notes:"电脑合成笔记",publicIds:{},tags:["合成验收"],year:2026,coverUrl:null,bannerUrl:null}));
 const data=JSON.stringify({format:"genzo-personal-data",version:1,works,files:[],reading:[{kind:"comic",book:"portable-qa-comic",group:"default",entry:"one",location:'{"pageIndex":2,"offset":0.5}',updatedAt:new Date().toISOString()}],bookmarks:[{kind:"novel",book:"portable-qa-novel",group:"default",entry:"one",location:'{"href":"OEBPS/chapter.xhtml","locations":{"totalProgression":0.5}}',label:"合成书签"}]});
 const choices=keys.map(portableId=>({portableId,overwriteExisting:true}));
 await invoke(pc,"import_personal_data",{data,choices,bindings:[],includeReading:true});
 await pc.getByRole("link",{name:"书架",exact:true}).click();
 const uiWork=(await invoke(pc,"list_works")).find(work=>work.title===works[1].title);assert.ok(uiWork);
 const uiTitle=`Genzo 同步界面验收 ${Date.now()}`;
 const uiData=JSON.parse(data);uiData.works[1].title=uiTitle;
 await invoke(pc,"import_personal_data",{data:JSON.stringify(uiData),choices,bindings:[]});await pc.getByText(uiTitle,{exact:true}).first().waitFor();result.cases.desktopBookshelfUpdatesFromRealEvent=true;
 await pc.locator(`a[href$="/bookshelf/${uiWork.id}"]`).first().click();await pc.locator("#notesInput").fill("尚未保存的合成草稿");
 uiData.works[1].title=`${uiTitle} 更新`;uiData.works[1].notes="外部导入的合成笔记";
 await invoke(pc,"import_personal_data",{data:JSON.stringify(uiData),choices,bindings:[]});await pc.getByRole("heading",{name:uiData.works[1].title,exact:true}).waitFor();assert.equal(await pc.locator("#notesInput").inputValue(),"尚未保存的合成草稿");result.cases.desktopKeepsUnsavedDraft=true;
 await invoke(pc,"import_personal_data",{data,choices,bindings:[]});await pc.getByRole("link",{name:"首页",exact:true}).click();
 await invoke(pc,"publish_personal_data");
 const fromPc=await invoke(mobile,"fetch_personal_data");let preview=await invoke(mobile,"preview_personal_data",{data:fromPc});assert.equal(preview.works.filter(w=>keys.includes(w.portableId)).length,2);
 const imported=await invoke(mobile,"import_personal_data",{data:fromPc,choices,bindings:[],includeReading:true,overwriteReading:true});assert.equal(imported.created+imported.updated,2);result.cases.pcToPhoneBooksAndReading=true;
 const exported=JSON.parse(await invoke(mobile,"export_personal_data"));assert.ok(exported.reading.some(r=>r.book==="portable-qa-comic"));assert.ok(exported.bookmarks.some(r=>r.book==="portable-qa-novel"));
 assert.equal(exported.reading.find(r=>r.book==="portable-qa-comic").updatedAt,JSON.parse(fromPc).reading.find(r=>r.book==="portable-qa-comic").updatedAt);result.cases.readingTimePreserved=true;
 const book=(await invoke(mobile,"list_works")).find(w=>w.title===works[1].title);const detail=await invoke(mobile,"get_work",{id:book.id});
 await invoke(mobile,"update_work",{id:book.id,input:{title:detail.title,originalTitle:detail.originalTitle||null,type:detail.type,description:detail.description,status:detail.status,favorite:true,rating:8,notes:"手机返回的合成笔记",tags:detail.tags.map(t=>t.name||t),coverPath:detail.coverPath||null}});
 await invoke(mobile,"publish_personal_data");const fromPhone=await invoke(pc,"fetch_personal_data");
 const before=(await invoke(pc,"list_works")).find(w=>w.title===works[1].title);
 await invoke(pc,"import_personal_data",{data:fromPhone,choices:keys.map(portableId=>({portableId,overwriteExisting:false})),bindings:[]});assert.equal((await invoke(pc,"get_work",{id:before.id})).notes,"电脑合成笔记");result.cases.defaultPreservesLocal=true;
 await invoke(pc,"import_personal_data",{data:fromPhone,choices,bindings:[]});assert.equal((await invoke(pc,"get_work",{id:before.id})).notes,"手机返回的合成笔记");result.cases.phoneToPcBooks=true;
 const filePath=`${output}/phone-personal-data.json`;await invoke(pc,"save_personal_data_file",{path:filePath});await assert.rejects(invoke(pc,"save_personal_data_file",{path:filePath}));const reread=await invoke(pc,"read_personal_data_file",{path:filePath});assert.equal(JSON.parse(reread).format,"genzo-personal-data");result.cases.desktopFileRoundtripAndNoOverwrite=true;
 for(const [width,height] of [[1024,640],[1280,800],[1366,768],[1440,900],[1920,1080]]){
  await pc.setViewportSize({width,height});await pc.getByRole("button",{name:"打开设置",exact:true}).click();await pc.getByRole("tab",{name:"下载与备份"}).click();
  await pc.getByRole("button",{name:"读取 WebDAV 资料包并预览"}).click();await pc.getByRole("button",{name:"导入所选记录"}).waitFor();
  const overflow=await pc.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false,`desktop ${width} overflow`);
  await pc.screenshot({path:`${output}/desktop-${width}.png`});await pc.getByRole("button",{name:"取消",exact:true}).click();
  await pc.getByRole("button",{name:"关闭设置"}).click();
 }
 result.cases.desktopLayouts=true;
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}
finally{await invoke(pc,"sync_set_enabled",{enabled:false}).catch(()=>{});await invoke(mobile,"sync_set_enabled",{enabled:false}).catch(()=>{});await desktop.close();await phone.close();command("reverse","--remove","tcp:51799");await new Promise(resolve=>server.close(resolve));}
