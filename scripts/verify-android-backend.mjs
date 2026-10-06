import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, statSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Emulator only. This serves generated color-bar fixtures, never user media.
const serial = process.env.GENZO_ANDROID_SERIAL ?? "emulator-5554";
assert.ok(serial.startsWith("emulator-"), "Physical-device testing requires a separate explicit workflow");
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output = "D:/DevTools/Android/Build/qa/backend";
const samples = "D:/DevTools/Android/Samples/GenzoPrototype";
mkdirSync(output, { recursive: true });
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const files = new Map([
  ["Genzo Backend.mp4", `${samples}/h264.mp4`],
  ["Genzo Backend.srt", `${samples}/h264.srt`],
  ["Genzo Backend Tracks.mkv", `${samples}/h264-tracks.mkv`],
  ["Genzo Backend HEVC.mkv", `${samples}/h265.mkv`],
]);
const auth = `Basic ${Buffer.from("fixture:fixture-only").toString("base64")}`;
let mode = "online";
const requests = [];
const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname).slice(5);
  const entry = { method: req.method, name, range: req.headers.range ?? null, bytes: 0 };
  requests.push(entry);
  res.setHeader("Connection", "close");
  if (mode === "offline") { res.writeHead(503); res.end(); return; }
  if (mode === "auth" || req.headers.authorization !== auth) { res.writeHead(401); res.end(); return; }
  if (req.method === "PROPFIND") {
    const item = (name, size) => `<d:response><d:href>/dav/${encodeURIComponent(name)}</d:href><d:propstat><d:prop><d:resourcetype>${size === null ? "<d:collection/>" : ""}</d:resourcetype>${size === null ? "" : `<d:getcontentlength>${size}</d:getcontentlength><d:getetag>&quot;fixture-v1&quot;</d:getetag>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    const xml = `<d:multistatus xmlns:d="DAV:">${item("", null)}${[...files].map(([name,path]) => item(name,statSync(path).size)).join("")}</d:multistatus>`;
    res.writeHead(207, { "Content-Type": "application/xml", "Content-Length": Buffer.byteLength(xml) }); res.end(xml); return;
  }
  const path = files.get(name);
  if (!path || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404); res.end(); return; }
  const size = statSync(path).size;
  let start = 0, end = size - 1;
  const range = mode !== "no-range" && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; }
  if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
  const headers = { "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Content-Type": name.endsWith("srt") ? "text/plain" : "application/octet-stream" };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === "HEAD") { res.end(); return; }
  const stream = createReadStream(path, { start, end, highWaterMark: 8192 });
  stream.on("data", chunk => { entry.bytes += chunk.length; });
  res.on("close", () => stream.destroy());
  if (mode === "slow") {
    stream.on("data", chunk => { stream.pause(); res.write(chunk); setTimeout(() => { if (!stream.destroyed) stream.resume(); },20); });
    stream.on("end", () => res.end());
  } else stream.pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
adb("reverse", `tcp:${port}`, `tcp:${port}`);
adb("shell", "am", "start", "-n", "com.genzo.android/.MainActivity");
await sleep(1500);
const pid = adb("shell", "pidof", "com.genzo.android");
adb("forward", "tcp:9227", `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9227", { noDefaults: true });
const page = browser.contexts()[0].pages()[0];
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command,args), { command, args });
const control = (sessionId, action) => invoke("control_internal_player", { sessionId, action });
const state = () => invoke("get_internal_player_state");
async function until(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) { const current = await state(); if (predicate(current)) return current; await sleep(200); }
  throw new Error(`Timed out: ${label}; ${JSON.stringify(await state())}`);
}
async function scan(sourceId, expected = "completed") {
  const { taskId } = await invoke("scan_video_source", { sourceId });
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = (await invoke("list_scan_tasks")).find(task => task.id === taskId);
    if (task && !["queued","scanning","indexing","committing"].includes(task.stage)) {
      assert.equal(task.stage,"completed",JSON.stringify(task));
      if (expected === "partial") { assert.ok(task.errors.length); assert.ok(task.failedDirectories.length); }
      else assert.deepEqual(task.errors,[]);
      return task;
    }
    await sleep(100);
  }
  throw new Error("Scan did not terminate");
}
await page.evaluate(async () => {
  window.__backendEvents = []; window.__backendListeners = [];
  for (const name of ["android-source-state","scan-task-updated","recognition-updated","player-state"]) {
    const handler = window.__TAURI_INTERNALS__.transformCallback(event => window.__backendEvents.push({ name, at:Date.now(), payload:event.payload }));
    const id = await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event:name, target:{kind:"Any"}, handler });
    window.__backendListeners.push({ name,id });
  }
});
const results = { serial };
let sourceId;
try {
  const input = { name:"Genzo 后端验证（合成测试源）", endpoint:`http://127.0.0.1:${port}/dav/`, directory:"", username:"fixture", password:"fixture-only", kind:"video" };
  assert.equal((await invoke("browse_webdav", { input })).filter(entry => !entry.directory).length,4);
  sourceId = await invoke("add_webdav_source", { input });
  results.scan = await scan(sourceId);
  assert.ok(requests.every(request => request.method === "PROPFIND"), "Scanning must not fetch video bodies");
  const indexed = (await invoke("list_unassigned_media", { destination:"media" })).filter(file => file.libraryRootId === sourceId);
  assert.equal(indexed.length,4);
  const video = indexed.find(file => file.fileName === "Genzo Backend.mp4");
  const inputWork = { title:`Genzo backend QA ${sourceId.slice(0,8)}`, originalTitle:null, type:"video", description:"Generated fixtures", coverPath:null, status:"paused", favorite:true, rating:8, notes:"Retain across source failures", tags:["QA"] };
  let work = await invoke("create_work_from_media", { mediaFileId:video.id, input:inputWork });
  const attached = new Set(work.mediaFiles.map(file => file.id));
  const remaining = indexed.filter(file => !attached.has(file.id)).map(file => file.id);
  if (remaining.length) await invoke("attach_media_files", { workId:work.id, mediaFileIds:remaining });
  results.candidates = await invoke("list_subtitle_candidates", { mediaFileId:video.id });
  assert.equal(results.candidates.length,1);
  const opening = await invoke("open_internal_player", { mediaFileId:video.id, restart:true });
  assert.equal(opening.status,"opening");
  const sessionId = opening.sessionId;
  await until(current => current.sessionId === sessionId && current.status === "playing" && current.positionMs > 500, "WebDAV playback");
  const playing = await until(current => current.subtitleTrackId === results.candidates[0].id, "remote SRT auto association");
  assert.equal(playing.seekable,true); assert.ok(playing.durationMs > 39000);
  await sleep(1500);
  writeFileSync(`${output}/webdav-srt-before-seek.png`,execFileSync(adbPath,["-s",serial,"exec-out","screencap","-p"]));
  await control(sessionId,{type:"pause"});
  await until(current => current.status === "paused", "pause");
  await control(sessionId,{type:"seek",positionMs:18000});
  await until(current => Math.abs(current.positionMs - 18000) < 1800,"seek");
  assert.equal((await control(sessionId,{type:"rate",speed:1.5})).rate,1.5);
  assert.equal((await control(sessionId,{type:"subtitle-delay",offsetMs:-500})).subtitleOffsetMs,-500);
  await assert.rejects(() => control("expired",{type:"pause"}));
  await assert.rejects(() => control(sessionId,{type:"audio",trackId:"999999"}));
  await assert.rejects(() => control(sessionId,{type:"seek",positionMs:-1}));
  await control(sessionId,{type:"play"}); await sleep(5000);
  writeFileSync(`${output}/webdav-srt-playing.png`,execFileSync(adbPath,["-s",serial,"exec-out","screencap","-p"]));
  const rawSubtitle=await invoke("android_native",{command:"playerState",payload:{}});
  results.nativeSubtitle={selectedSidecar:rawSubtitle.selectedSidecar,subtitleTrack:rawSubtitle.subtitleTrack,subtitleTracks:rawSubtitle.subtitleTracks};
  await control(sessionId,{type:"pause"});
  await until(current => current.status === "paused","pause after seek"); await sleep(1000);
  results.playback = await state();
  writeFileSync(`${output}/webdav-srt.png`,execFileSync(adbPath,["-s",serial,"exec-out","screencap","-p"]));
  await control(sessionId,{type:"close"}); await sleep(700);
  await assert.rejects(() => control(sessionId,{type:"play"}));
  results.saved = (await invoke("get_playback_progress", { workId:work.id })).items.find(item => item.mediaFileId === video.id);
  assert.ok(results.saved.positionMs >= 17000);
  const reopened = await invoke("open_internal_player", { mediaFileId:video.id, restart:false });
  await until(current => current.sessionId === reopened.sessionId && current.status === "playing" && current.positionMs >= results.saved.positionMs - 1500,"SQLite resume");
  await control(reopened.sessionId,{type:"close"}); await sleep(600);
  mode = "no-range";
  results.rangeFailure = await invoke("open_internal_player", { mediaFileId:video.id, restart:true });
  assert.equal(results.rangeFailure.error.code,"range_unsupported");
  mode = "auth";
  results.authFailure = await invoke("open_internal_player", { mediaFileId:video.id, restart:true });
  assert.equal(results.authFailure.error.code,"credential_invalid");
  assert.equal((await invoke("get_video_source_states")).find(source => source.id === sourceId).state,"credential_invalid");
  mode = "offline"; results.offlineScan = await scan(sourceId,"partial");
  work = await invoke("get_work", { id:work.id });
  assert.equal(work.favorite,true); assert.equal(work.notes,inputWork.notes);
  assert.ok(work.mediaFiles.every(file => !file.missing));
  assert.ok((await invoke("get_playback_progress", { workId:work.id })).items.some(item => item.mediaFileId === video.id));
  mode = "online";
  await invoke("update_webdav_credentials", { id:sourceId, username:input.username, password:input.password });
  results.recovery = await scan(sourceId);
  assert.equal((await invoke("get_video_source_states")).find(source => source.id === sourceId).state,"available");
  assert.equal((await invoke("list_remote_cache")).some(item => indexed.some(file => file.id === item.mediaFileId)),false);
  mode = "slow";
  const interrupted = await invoke("open_internal_player", { mediaFileId:video.id, restart:true });
  await until(current => current.sessionId === interrupted.sessionId && current.status === "playing", "slow stream");
  mode = "offline"; server.closeAllConnections();
  await control(interrupted.sessionId,{type:"seek",positionMs:35000}).catch(() => {});
  results.interruption = await until(current => current.sessionId === interrupted.sessionId && current.status === "error", "connection interruption");
  results.interruptedProgress = (await invoke("get_playback_progress", { workId:work.id })).items.find(item => item.mediaFileId === video.id);
  assert.equal(results.interruptedProgress.completed,false);
  await control(interrupted.sessionId,{type:"close"}); await sleep(600);
  mode = "online";
  const recoveredPlay = await invoke("open_internal_player", { mediaFileId:video.id, restart:false });
  await until(current => current.sessionId === recoveredPlay.sessionId && current.status === "playing", "playback after reconnection");
  await control(recoveredPlay.sessionId,{type:"close"}); await sleep(600);
  const tracksFile = indexed.find(file => file.fileName.endsWith("Tracks.mkv"));
  const tracksOpen = await invoke("open_internal_player", { mediaFileId:tracksFile.id, restart:true });
  const tracks = await until(current => current.sessionId === tracksOpen.sessionId && current.audioTracks.filter(track => track.id !== "-1").length === 2 && current.subtitleTracks.some(track => track.id !== "-1"),"native tracks");
  for (const track of tracks.audioTracks.filter(track => track.id !== "-1")) { assert.equal((await control(tracksOpen.sessionId,{type:"audio",trackId:track.id})).audioTrackId,track.id); }
  const subtitle = tracks.subtitleTracks.find(track => track.id !== "-1");
  assert.equal((await control(tracksOpen.sessionId,{type:"subtitle",trackId:subtitle.id})).subtitleTrackId,subtitle.id);
  await control(tracksOpen.sessionId,{type:"orientation",orientation:"landscape"}); await sleep(700);
  await control(tracksOpen.sessionId,{type:"orientation",orientation:"portrait"});
  await control(tracksOpen.sessionId,{type:"orientation",orientation:"system"});
  await control(tracksOpen.sessionId,{type:"close"}); await sleep(600);
  const hevc = indexed.find(file => file.fileName.endsWith("HEVC.mkv"));
  const hevcOpen = await invoke("open_internal_player", { mediaFileId:hevc.id, restart:true });
  results.hevc = await until(current => current.sessionId === hevcOpen.sessionId && current.status === "playing" && current.positionMs > 500,"H265 MKV");
  await control(hevcOpen.sessionId,{type:"close"}); await sleep(600);
  results.events = await page.evaluate(() => window.__backendEvents);
  for (const name of ["android-source-state","scan-task-updated","recognition-updated","player-state"]) assert.ok(results.events.some(event => event.name === name),`Missing event: ${name}`);
  const revisions = new Map();
  for (const event of results.events) {
    const payload = event.payload;
    const key = `${event.name}:${payload.sourceId ?? payload.task?.id ?? payload.sessionId ?? "global"}`;
    if (event.name !== "player-state") { assert.ok(payload.revision > (revisions.get(key) ?? -1)); revisions.set(key,payload.revision); }
    assert.ok(!JSON.stringify(payload).includes("fixture-only"));
    if (event.name === "player-state") assert.equal(payload.uri,undefined);
  }
  results.requests = requests;
  writeFileSync(`${output}/backend.json`,JSON.stringify(results,null,2));
  console.log("PASS: WebDAV metadata-only scan, authenticated original-stream playback, seek, speed, tracks, remote SRT, ms offset, stale sessions, resume, auth/Range failures, offline index retention, recovery and four event streams.");
} catch (error) {
  writeFileSync(`${output}/backend-failure.json`,JSON.stringify({ ...results, error:String(error), requests },null,2));
  throw error;
} finally {
  const current = await state().catch(() => null);
  if (current?.sessionId && !["closed","idle","error"].includes(current.status)) await control(current.sessionId,{type:"close"}).catch(() => {});
  if (sourceId) await invoke("update_library_root", { id:sourceId, kind:"video", enabled:false }).catch(() => {});
  await page.evaluate(async () => { for (const {name,id} of window.__backendListeners ?? []) await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten",{event:name,eventId:id}); }).catch(() => {});
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  adb("reverse","--remove",`tcp:${port}`);
}
