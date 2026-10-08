import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
import {promisify} from "node:util";
import {randomBytes} from "node:crypto";
import {createServer} from "node:http";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const serial=process.env.GENZO_READER_DEVICE||"emulator-5554",app="com.genzo.android.readerqa",adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe";
assert.ok(["emulator-5554","3B164M00Z0500000"].includes(serial));
const resume=process.env.GENZO_SYNC_QA_RESUME;
const output=resume||`D:/DevTools/Android/Build/qa/webdav-native-${Date.now()}`;mkdirSync(output,{recursive:true});
const username="qa",password=randomBytes(24).toString("hex"),auth=`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const files=new Map();let revision=0,offline=false;
const server=createServer((request,response)=>{
 if(request.headers.authorization!==auth){response.writeHead(401);response.end();return;}
 if(offline){response.writeHead(503);response.end();return;}
 const key=request.url;const entry=files.get(key);
 if(request.method==="GET"){if(!entry){response.writeHead(404);response.end();return;}response.writeHead(200,{ETag:entry.etag,"Content-Type":"application/json"});response.end(entry.bytes);return;}
 if(request.method==="DELETE"){files.delete(key);response.writeHead(204);response.end();return;}
 if(request.method==="PUT"){
  const chunks=[];request.on("data",chunk=>chunks.push(chunk));request.on("end",()=>{
   if(request.headers["if-none-match"]==="*"&&entry||request.headers["if-match"]&&request.headers["if-match"]!==entry?.etag){response.writeHead(412);response.end();return;}
   files.set(key,{bytes:Buffer.concat(chunks),etag:`"r-${++revision}"`});response.writeHead(201);response.end();
  });return;
 }
 response.writeHead(405);response.end();
});
await new Promise(resolve=>server.listen(Number(process.env.GENZO_SYNC_QA_PORT||0),"127.0.0.1",resolve));const port=server.address().port,endpoint=`http://127.0.0.1:${port}/library/`;
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});
command("reverse",`tcp:${port}`,`tcp:${port}`);
const cli="D:/DevTools/Android/Build/genzo-sync/debug/examples/device.exe",env={...process.env,GENZO_SYNC_QA_DB:`${output}/windows.db`,GENZO_SYNC_QA_ENDPOINT:endpoint,GENZO_SYNC_QA_USERNAME:username,GENZO_SYNC_QA_PASSWORD:password};
const desktop=async action=>(await promisify(execFile)(cli,[action],{cwd:process.cwd(),env,encoding:"utf8",timeout:30000})).stdout;
if(resume){const document=await desktop("document");files.set("/library/state.json",{bytes:Buffer.from(document),etag:`"r-${++revision}"`});}
else{await desktop("seed");await desktop("create");}
const flavor=serial==="emulator-5554"?"x86_64":"arm64";
command("install","--no-streaming","-r",process.env.GENZO_SYNC_QA_APK||`D:/DevTools/Android/Build/reader-gradle/app/outputs/apk/${flavor}/debug/app-${flavor}-debug.apk`);
command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await new Promise(r=>setTimeout(r,1300));
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);command("forward","tcp:9341",`localabstract:webview_devtools_remote_${pid}`);
let browser=await chromium.connectOverCDP("http://127.0.0.1:9341",{noDefaults:true});
let page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
const result={output,serial,cases:{}};
try{
 const status=await invoke("sync_status");
 if(resume){assert.equal(status.endpoint,endpoint);assert.equal(status.libraryId,JSON.parse(await desktop("document")).libraryId);await invoke("sync_update_credentials",{username,password});await invoke("sync_now");}
 else{assert.equal(status.connected,false,"This test needs an unconnected QA profile; do not replace an existing connection");await invoke("sync_connect",{input:{endpoint,username,password,deviceName:"Android QA",allowLoopbackHttp:true},mode:"join"});}
 await invoke("sync_set_enabled",{enabled:false});
 let works=await invoke("list_works"),film=works.find(w=>w.title==="Genzo 多设备合成验收");assert.ok(film);result.cases.desktopToPhone=true;
 const detail=await invoke("get_work",{id:film.id});
 const input={title:detail.title,originalTitle:detail.originalTitle||null,description:detail.description||"",type:detail.type,status:detail.status,favorite:true,rating:9,notes:"手机修改的合成笔记",tags:detail.tags.map(t=>typeof t==="string"?t:t.name),coverPath:detail.coverPath||null};
 await invoke("update_work",{id:film.id,input});await invoke("sync_now");
 const pulled=JSON.parse(await desktop("sync"));assert.ok(pulled.some(row=>row[3]===9&&row[4]==="手机修改的合成笔记"));result.cases.phoneToDesktop=true;
 await desktop("change");await invoke("sync_now");film=(await invoke("get_work",{id:film.id}));assert.equal(film.rating,8);assert.equal(film.notes,"电脑后续修改");result.cases.returnUpdate=true;
 offline=true;input.notes="离线保留的合成笔记";await invoke("update_work",{id:film.id,input});await assert.rejects(invoke("sync_now"));assert.equal((await invoke("get_work",{id:film.id})).notes,input.notes);assert.ok((await invoke("sync_status")).pending>0);result.cases.offlinePreserved=true;
 offline=false;await invoke("sync_now");assert.ok(JSON.parse(await desktop("sync")).some(row=>row[4]===input.notes));result.cases.recovery=true;
 const beforeRestart=await invoke("sync_status");await browser.close();
 command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);
 await new Promise(r=>setTimeout(r,1800));
 const restartedPid=command("shell","pidof",app).trim();assert.match(restartedPid,/^\d+$/);command("forward","tcp:9341",`localabstract:webview_devtools_remote_${restartedPid}`);
 browser=await chromium.connectOverCDP("http://127.0.0.1:9341",{noDefaults:true});page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
 const afterRestart=await invoke("sync_status");assert.equal(afterRestart.libraryId,beforeRestart.libraryId);assert.equal(afterRestart.deviceId,beforeRestart.deviceId);assert.equal(afterRestart.enabled,false);
 await invoke("sync_now");assert.equal((await invoke("get_work",{id:film.id})).notes,input.notes);result.cases.restartWithStoredCredentials=true;
 const beforeEnable=(await invoke("sync_status")).lastSuccess;await invoke("sync_set_enabled",{enabled:true});
 for(let attempt=0;attempt<100;attempt++){const value=await invoke("sync_status");if(!value.running&&value.pending===0&&value.lastSuccess!==beforeEnable)break;await new Promise(r=>setTimeout(r,100));}
 assert.notEqual((await invoke("sync_status")).lastSuccess,beforeEnable,"Enable-triggered synchronization completed first");
 assert.equal((await invoke("sync_status")).pending,0,"Receiver is idle before the remote-only edit");
 await desktop("change");const remoteChangedAt=Date.now();
 for(let attempt=0;attempt<75;attempt++){
  const work=await invoke("get_work",{id:film.id});if(work.notes==="电脑后续修改"){result.cases.automaticIdlePull={milliseconds:Date.now()-remoteChangedAt};break;}
  if(attempt===74)throw Error("Idle receiver did not pull remote changes automatically");await new Promise(r=>setTimeout(r,1000));
 }
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}
finally{await invoke("sync_set_enabled",{enabled:false}).catch(()=>{});await browser.close();command("reverse","--remove",`tcp:${port}`);await new Promise(resolve=>server.close(resolve));}
