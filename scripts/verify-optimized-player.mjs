import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {chromium} from "playwright-core";
const output="D:/DevTools/Android/Build/qa/optimized-player",adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial="3B164M00Z0500000";mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});
command("shell","am","start","-n","com.genzo.android.readerqa/com.genzo.android.MainActivity");await new Promise(resolve=>setTimeout(resolve,1400));
const pid=command("shell","pidof","com.genzo.android.readerqa").trim();assert.match(pid,/^\d+$/);command("forward","tcp:9342",`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9342",{noDefaults:true}),page=browser.contexts()[0].pages()[0];
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result={cases:{}};let session;
try{
 assert.equal((await invoke("get_app_info")).dataDirectory,"/data/user/0/com.genzo.android.readerqa");
 const active=await invoke("get_internal_player_state");if(active.sessionId&&active.status!=="closed") {await invoke("control_internal_player",{sessionId:active.sessionId,action:{type:"close"}});await pause(600);}
 const source=(await invoke("get_video_source_states")).find(s=>s.label==="GenzoSharingQA-1791431130");assert.ok(source?.enabled);
 const scan=await invoke("scan_video_source",{sourceId:source.id});
 for(let attempt=0;attempt<100;attempt++){
  const task=(await invoke("list_scan_tasks")).find(t=>t.id===scan.taskId);
  if(task?.stage==="completed")break;assert.ok(!["failed","cancelled"].includes(task?.stage),JSON.stringify(task));if(attempt===99)throw Error("scan timed out");await pause(100);
 }
 const film=(await invoke("list_works")).find(w=>w.title==="Genzo 多设备合成验收");assert.ok(film);
 let files=(await invoke("get_work",{id:film.id})).mediaFiles;
 const unassigned=await invoke("list_unassigned_media");
 const candidates=unassigned.filter(f=>f.libraryRootId===source.id);
 if(candidates.length)await invoke("attach_media_files",{workId:film.id,mediaFileIds:candidates.map(f=>f.id)});
 files=(await invoke("get_work",{id:film.id})).mediaFiles.filter(f=>f.libraryRootId===source.id);assert.equal(files.length,2);
 const versions=[];
 for(const name of ["h264.mp4","h265.mkv"]){
  const file=files.find(f=>f.fileName===name);assert.ok(file);
  const bytes=readFileSync(`D:/DevTools/Android/Samples/GenzoPrototype/${name}`),expected=`sha256:${createHash("sha256").update(bytes).digest("hex")}:${bytes.length}`;
  const version=await invoke("sync_bind_media",{mediaFileId:file.id});assert.equal(version,expected);versions.push(version);
  const opening=await invoke("open_internal_player",{mediaFileId:file.id,restart:true});session=opening.sessionId;
  await pause(600);
  let state;
  for(let attempt=0;attempt<60;attempt++){
   state=await invoke("get_internal_player_state",{sessionId:session});if(state.positionMs>1000&&state.durationMs>39000)break;
   assert.notEqual(state.status,"error",JSON.stringify(state));if(attempt===59)throw Error(`playback timed out: ${JSON.stringify(state)}`);await pause(200);
  }
  await invoke("control_internal_player",{sessionId:session,action:{type:"pause"}});
  state=await invoke("control_internal_player",{sessionId:session,action:{type:"seek",positionMs:20000}});await pause(500);
  state=await invoke("get_internal_player_state",{sessionId:session});assert.ok(Math.abs(state.positionMs-20000)<1200);assert.equal(state.seekable,true);
  writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:16*1024*1024}));
  await invoke("control_internal_player",{sessionId:session,action:{type:"close"}});session=null;
  await pause(600);
  const progress=await invoke("get_playback_progress",{workId:film.id});assert.ok(progress.items.some(row=>row.mediaFileId===file.id&&row.positionMs>18000));
  result.cases[name]={verifiedVersion:version,played:true,seek:true,persisted:true};
 }
 assert.notEqual(versions[0],versions[1]);result.cases.differentEncodingDifferentVersion=true;
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}
finally{if(session)await invoke("control_internal_player",{sessionId:session,action:{type:"close"}}).catch(()=>{});await browser.close();}
