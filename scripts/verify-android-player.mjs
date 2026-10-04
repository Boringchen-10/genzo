import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Uses only the generated GenzoPrototype files and this app's debug bridge.
const output = process.env.GENZO_ANDROID_QA_DIR ?? "D:/DevTools/Android/Build/qa";
mkdirSync(output, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9226");
const page = browser.contexts()[0].pages()[0];
const invoke = (command, payload = {}) => page.evaluate(({ command, payload }) =>
  window.__TAURI_INTERNALS__.invoke("android_native", { command, payload }), { command, payload });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await invoke("playerState");
    if (predicate(state)) return state;
    assert.ok(!["playback_error", "permission_denied"].includes(state.status), JSON.stringify(state));
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}
const control = (action, value = 0, uri) => invoke("playerControl", { action, value, uri });
const root = await invoke("listTree");
assert.equal(root.status, "available");
const directory = root.files.find(file => file.name === "GenzoPrototype");
const tree = await invoke("listTree", { uri: directory?.uri ?? root.uri });
const uri = name => {
  const file = tree.files.find(file => file.name === name);
  assert.ok(file, `Missing generated sample: ${name}`);
  return file.uri;
};
const results = {};
const capture = name => {
  const png = execFileSync("adb", ["exec-out", "screencap", "-p"]);
  writeFileSync(`${output}/${name}.png`, png);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};
async function open(name, restart = true) {
  await control("close");
  await sleep(600);
  await invoke("openPlayer", { uri: uri(name), restart });
  await sleep(1000);
  return until(state => state.positionMs > 500 && state.durationMs > 39000 && state.status !== "ended", name);
}
try {
  for (const name of ["h264.mp4", "h265.mkv"]) {
    results[name] = await open(name);
    assert.equal(results[name].seekable, true);
    await control("pause");
    const paused = await until(state => state.status === "paused", "pause");
    await sleep(800);
    assert.ok(Math.abs((await invoke("playerState")).positionMs - paused.positionMs) < 600);
    await control("seek", 20000);
    results[`${name}:seek`] = await until(state => Math.abs(state.positionMs - 20000) < 1500, "seek");
    await control("rate", 1.5);
    assert.equal((await invoke("playerState")).rate, 1.5);
    await control("play");
    await until(state => state.positionMs > 21000, "play after seek");
    await control("pause");
    capture(name.replace(".", "-"));
  }
  results.tracks = await open("h264-tracks.mkv");
  await until(state => state.audioTracks.filter(track => track.id >= 0).length === 2 &&
    state.subtitleTracks.some(track => track.id >= 0), "embedded tracks");
  const tracks = await invoke("playerState");
  for (const track of tracks.audioTracks.filter(track => track.id >= 0)) {
    await control("audio", track.id);
    assert.equal((await invoke("playerState")).audioTrack, track.id);
  }
  await control("subtitle", tracks.subtitleTracks.find(track => track.id >= 0).id);
  await control("seek", 8000);
  await sleep(1200);
  results.embeddedAssFrame = capture("embedded-ass");
  await control("pause");
  await control("subtitleOffset", 500);
  assert.equal((await invoke("playerState")).subtitleDelayUs, 500000);
  results.embeddedAss = await invoke("playerState");
  await open("h264.mp4");
  await control("externalSubtitle", 0, uri("h264.srt"));
  await control("seek", 8000);
  await sleep(1200);
  results.srtFrame = capture("external-srt");
  results.srt = await invoke("playerState");
  await control("externalSubtitle", 0, uri("h264.ass"));
  await control("seek", 8000);
  await sleep(1200);
  results.assFrame = capture("external-ass");
  results.ass = await invoke("playerState");
  await control("landscape");
  await sleep(1500);
  results.landscape = capture("landscape-ass");
  assert.ok(results.landscape.width > results.landscape.height);
  await control("portrait");
  await sleep(1200);
  await control("externalSubtitle", 0, uri("h264.ssa"));
  await control("seek", 8000);
  await sleep(1200);
  results.ssaFrame = capture("external-ssa");
  results.ssa = await invoke("playerState");
  await control("pause");
  const saved = await invoke("playerState");
  await control("close");
  await sleep(800);
  results.resume = await open("h264.mp4", false);
  assert.ok(results.resume.positionMs >= saved.positionMs - 1500, "URI prototype resume");
  await control("pause");
  writeFileSync(`${output}/player.json`, JSON.stringify(results, null, 2));
  console.log("PASS: H264/MP4, H265/MKV, pause, seek, speed, two audio tracks, ASS tracks, SRT/ASS/SSA sidecars, offset, rotation and prototype resume. Inspect saved subtitle frames visually.");
} finally {
  await control("close").catch(() => {});
  await browser.close();
}
