import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const serial = "emulator-5554";
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output = "D:/DevTools/Android/Build/qa/backend";
mkdirSync(output,{recursive:true});
const adb = (...args) => execFileSync(adbPath,["-s",serial,...args],{encoding:"utf8"}).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
adb("shell","am","start","-n","com.genzo.android/.MainActivity");
await sleep(1500);
adb("forward","tcp:9227",`localabstract:webview_devtools_remote_${adb("shell","pidof","com.genzo.android")}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9227",{noDefaults:true});
const page = browser.contexts()[0].pages()[0];
await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
const invoke = (command,args={}) => page.evaluate(({command,args}) => window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const control = (sessionId,action) => invoke("control_internal_player",{sessionId,action});
function pickerVisible() { return /topResumedActivity=.*documentsui/.test(adb("shell","dumpsys","activity","activities")); }
async function dismissPicker() {
  for(let attempt=0;attempt<6&&pickerVisible();attempt++) { adb("shell","input","keyevent","4"); await sleep(350); }
}
async function until(predicate,label) {
  for(let attempt=0;attempt<100;attempt++) { const state=await invoke("get_internal_player_state"); if(predicate(state)) return state; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
function nodes() {
  adb("shell","uiautomator","dump","/sdcard/genzo-backend-ui.xml");
  const xml=adb("shell","cat","/sdcard/genzo-backend-ui.xml");
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag])=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value])));
}
async function waitNode(predicate,scroll=false) {
  for(let attempt=0;attempt<6;attempt++) {
    const visible=nodes(); const found=visible.find(predicate); if(found) return found;
    const list=scroll&&visible.find(node=>node["resource-id"]==="com.google.android.documentsui:id/dir_list"&&node.scrollable==="true");
    if(list) {
      const [,left,top,right,bottom]=/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(list.bounds);
      const x=Math.round((Number(left)+Number(right))/2), y=Number(top), height=Number(bottom)-y;
      adb("shell","input","swipe",`${x}`,`${Math.round(y+height*.9)}`,`${x}`,`${Math.round(y+height*.5)}`,"350");
    }
    await sleep(250);
  }
  throw new Error("Expected system-picker entry did not appear");
}
function tap(node) {
  assert.ok(node,"Expected a visible system-picker node");
  const [,left,top,right,bottom]=/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(node.bounds);
  console.log("Picker tap:",node.text||node["content-desc"],node.bounds);
  adb("shell","input","tap",`${(Number(left)+Number(right))/2}`,`${(Number(top)+Number(bottom))/2}`);
}
async function pick(sessionId,name) {
  await page.evaluate(sessionId=>{
    window.__subtitleResult=null;
    window.__TAURI_INTERNALS__.invoke("pick_external_subtitle",{sessionId}).then(result=>window.__subtitleResult=result).catch(error=>window.__subtitleResult={error:String(error)});
  },sessionId);
  await sleep(500);
  if(!name) await dismissPicker();
  else {
    let visible=nodes();
    if(!visible.some(node=>node.text===name)) {
      tap(visible.find(node=>["Show roots","显示根目录","打开导航抽屉"].includes(node["content-desc"]))); await sleep(250);
      tap(await waitNode(node=>["Downloads","下载"].includes(node.text)&&node["resource-id"]==="android:id/title"));
      tap(await waitNode(node=>node.text==="GenzoPrototype"&&node["resource-id"]==="android:id/title"));
    }
    tap(await waitNode(node=>node.text===name&&node["resource-id"]==="android:id/title",true));
    await sleep(700);
    console.log("Picker after selection:",nodes().filter(node=>node.text).map(node=>node.text).join(" | "));
  }
  for(let attempt=0;attempt<50;attempt++) {
    const result=await page.evaluate(()=>window.__subtitleResult);
    if(result) { assert.equal(result.error,undefined); return result; }
    await sleep(200);
  }
  throw new Error("Subtitle picker did not resolve");
}
const results={serial};
try {
  const source=(await invoke("get_video_source_states")).find(source=>source.kind==="saf"&&source.label.includes("GenzoPrototype"));
  assert.ok(source,"This script requires the already-authorized synthetic GenzoPrototype SAF source");
  const tree=await invoke("android_native",{command:"listTree",payload:{sourceId:source.id}});
  assert.equal(tree.status,"available");
  assert.ok(tree.uri.includes("GenzoPrototype"));
  await assert.rejects(()=>invoke("android_native",{command:"listTree",payload:{sourceId:"unknown-source"}}));
  let video=(await invoke("list_unassigned_media",{destination:"media"})).find(file=>file.libraryRootId===source.id&&file.fileName==="h264.mp4");
  if(video) {
    const input={title:"Genzo subtitle bridge QA",originalTitle:null,type:"video",description:"Generated samples only",coverPath:null,status:"paused",favorite:false,rating:null,notes:"Subtitle bridge validation",tags:["QA"]};
    const work=await invoke("create_work_from_media",{mediaFileId:video.id,input});
    const pending=(await invoke("list_unassigned_media",{destination:"media"})).filter(file=>file.libraryRootId===source.id&&["h264.srt","h264.ass","h264.ssa"].includes(file.fileName));
    if(pending.length) await invoke("attach_media_files",{workId:work.id,mediaFileIds:pending.map(file=>file.id)});
  } else {
    for(const work of await invoke("list_works")) {
      const detail=await invoke("get_work",{id:work.id});
      video=detail.mediaFiles.find(file=>file.libraryRootId===source.id&&file.fileName==="h264.mp4");
      if(video) break;
    }
  }
  assert.ok(video);
  results.candidates=await invoke("list_subtitle_candidates",{mediaFileId:video.id});
  assert.equal(results.candidates.length,3);
  const opened=await invoke("open_internal_player",{mediaFileId:video.id,restart:true});
  await until(state=>state.sessionId===opened.sessionId&&state.status==="playing","SAF playback");
  assert.ok(!(await invoke("get_internal_player_state")).subtitleTracks.some(track=>track.kind==="sidecar"),"Multiple candidates must not select the first automatically");
  results.cancelled=await pick(opened.sessionId); assert.equal(results.cancelled.status,"cancelled");
  results.invalid=await pick(opened.sessionId,"h264.mp4"); assert.equal(results.invalid.status,"subtitle_error");
  results.selected=await pick(opened.sessionId,"h264.srt"); assert.equal(results.selected.status,"selected");
  assert.equal(results.selected.track.kind,"sidecar");
  assert.equal((await invoke("get_internal_player_state")).subtitleTrackId,results.selected.track.id);
  await control(opened.sessionId,{type:"seek",positionMs:8000}); await control(opened.sessionId,{type:"play"}); await sleep(3000);
  writeFileSync(`${output}/picked-srt.png`,execFileSync(adbPath,["-s",serial,"exec-out","screencap","-p"]));
  await control(opened.sessionId,{type:"close"}); await sleep(500);
  await assert.rejects(()=>invoke("pick_external_subtitle",{sessionId:opened.sessionId}));
  for(const extension of ["ass","ssa"]) {
    const subtitle=results.candidates.find(track=>track.label.endsWith(`.${extension}`));
    const opened=await invoke("open_internal_player",{mediaFileId:video.id,restart:true,subtitleId:subtitle.id});
    results[extension]=await until(state=>state.sessionId===opened.sessionId&&state.subtitleTrackId===subtitle.id,"explicit candidate");
    await control(opened.sessionId,{type:"seek",positionMs:8000}); await sleep(800);
    writeFileSync(`${output}/candidate-${extension}.png`,execFileSync(adbPath,["-s",serial,"exec-out","screencap","-p"]));
    await control(opened.sessionId,{type:"close"}); await sleep(500);
  }
  const calendar=await invoke("get_weekly_calendar");
  assert.equal(calendar.sourceVersion,"Bangumi /calendar");
  assert.equal(calendar.days.length,7);
  assert.ok(calendar.days.some(day=>day.items.length));
  results.calendar={sourceVersion:calendar.sourceVersion,generatedAt:calendar.generatedAt,counts:calendar.days.map(day=>({weekday:day.weekday,count:day.items.length,stale:day.items.some(item=>item.stale)}))};
  // Grant only the generated fixture's child folder, then prove that the older
  // source still resolves its own tree after the native "latest tree" changes.
  const nestedLabel="Z Genzo backend nested QA";
  const priorNested=(await invoke("get_video_source_states")).find(source=>source.label===nestedLabel);
  await page.evaluate(({label,sourceId})=>{
    window.__sourceResult=null;
    window.__TAURI_INTERNALS__.invoke("authorize_video_source",{label,sourceId}).then(result=>window.__sourceResult=result).catch(error=>window.__sourceResult={error:String(error)});
  },{label:nestedLabel,sourceId:priorNested?.id});
  await sleep(500);
  if(!nodes().some(node=>node.text==="Nested"&&node["resource-id"]==="android:id/title")) {
    const download=nodes().find(node=>node.text==="Download"&&node["resource-id"]==="android:id/title");
    if(download) tap(download);
    else {
      tap(await waitNode(node=>node["content-desc"]==="Show roots"));
      tap(await waitNode(node=>node.text==="Downloads"&&node["resource-id"]==="android:id/title"));
    }
    tap(await waitNode(node=>node.text==="GenzoPrototype"&&node["resource-id"]==="android:id/title"));
  }
  tap(await waitNode(node=>node.text==="Nested"&&node["resource-id"]==="android:id/title"));
  tap(await waitNode(node=>/use this folder|使用此文件夹/i.test(node.text)));
  tap(await waitNode(node=>/^(allow|允许)$/i.test(node.text)));
  let authorized;
  for(let attempt=0;attempt<40;attempt++) { authorized=await page.evaluate(()=>window.__sourceResult); if(authorized) break; await sleep(200); }
  assert.equal(authorized?.status,"authorized",JSON.stringify(authorized));
  const nested=await invoke("android_native",{command:"listTree",payload:{sourceId:authorized.source.id}});
  assert.ok(nested.files.some(file=>file.name==="Genzo Fixture S02E03.mkv"));
  assert.ok(!nested.files.some(file=>file.name==="h264.mp4"));
  const original=await invoke("android_native",{command:"listTree",payload:{sourceId:source.id}});
  assert.ok(original.files.some(file=>file.name==="h264.mp4"));
  const cross=await invoke("android_native",{command:"listTree",payload:{sourceId:source.id,uri:nested.uri}});
  assert.equal(cross.status,"permission_denied");
  results.multiSource={originalId:source.id,nestedId:authorized.source.id,olderTreePreserved:true,crossTreeRejected:true};
  await invoke("update_library_root",{id:authorized.source.id,kind:"video",enabled:false});
  writeFileSync(`${output}/subtitles.json`,JSON.stringify(results,null,2));
  console.log("PASS: independent source-ID browsing and cross-tree rejection, multiple-candidate manual choice, system picker cancellation/invalid video/valid SRT, stale picker rejection, explicit ASS/SSA and live cached Bangumi calendar.");
} catch(error) {
  writeFileSync(`${output}/subtitle-failure.json`,JSON.stringify({...results,error:String(error),picker:nodes().filter(node=>node.text||node["content-desc"])},null,2));
  throw error;
} finally {
  await dismissPicker();
  const state=await invoke("get_internal_player_state").catch(()=>null);
  if(state?.sessionId&&!['closed','idle','error'].includes(state.status)) await control(state.sessionId,{type:"close"}).catch(()=>{});
  await browser.close();
}
