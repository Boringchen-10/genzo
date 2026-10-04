import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// This workflow only runs on the emulator and only organizes our generated clips.
const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/frontend";
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
mkdirSync(output, { recursive: true });
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    let connection;
    try {
      const pid = adb("shell", "pidof", "com.genzo.android");
      adb("forward", "tcp:9227", `localabstract:webview_devtools_remote_${pid}`);
      connection = await chromium.connectOverCDP("http://127.0.0.1:9227", { noDefaults: true });
      if (connection.contexts()[0]?.pages().length) return connection;
    } catch { /* WebView socket is not ready immediately after install/start. */ }
    await connection?.close();
    await sleep(250);
  }
  throw new Error("Emulator WebView did not become ready");
}
let browser = await connect();
let page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload });
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) { const value = await predicate(); if (value) return value; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
const nav = title => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: title, exact: true }).click();
const capture = name => writeFileSync(`${output}/${name}.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"]));
async function layout() {
  const value = await page.evaluate(() => {
    const app = document.querySelector(".android-app");
    const main = document.querySelector(".gz-scroll").getBoundingClientRect();
    const nav = document.querySelector(".gz-tabbar").getBoundingClientRect();
    const header = document.querySelector(".gz-topbar").getBoundingClientRect();
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, appHeight: app.getBoundingClientRect().height, height: innerHeight, mainTop: main.top, mainBottom: main.bottom, navTop: nav.top, navBottom: nav.bottom, headerBottom: header.bottom };
  });
  assert.equal(value.scrollWidth, value.width);
  assert.ok(value.mainTop >= value.headerBottom - 1 && value.mainBottom <= value.navTop + 1, JSON.stringify(value));
  assert.ok(value.navBottom <= value.height + 1, JSON.stringify(value));
  return value;
}
try {
  await nav("首页");
  await page.getByRole("heading", { name: "Genzo", exact: true }).waitFor();
  await until(async () => !(await page.getByText("正在读取媒体库…", { exact: true }).count()), "initial snapshot");
  const tree = await native("listTree");
  assert.equal(tree.status, "available");
  assert.ok(tree.uri.endsWith("primary%3ADownload%2FGenzoPrototype"), "Only synthetic fixture tree allowed");
  await nav("我的");
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await until(async () => await page.locator(".android-app").getAttribute("data-theme") === "dark", "dark theme");
  await page.getByRole("button", { name: "目录与来源" }).click();
  await page.getByRole("heading", { name: "来源管理", exact: true }).waitFor();
  const source = (await invoke("get_video_source_states")).find(source => source.kind === "saf");
  assert.ok(source);
  const card = page.locator(".gz-source").filter({ hasText: source.label });
  await card.getByRole("switch").click();
  await until(async () => (await invoke("get_video_source_states")).find(item => item.id === source.id).enabled === false, "source disabled");
  assert.equal(await card.getByRole("button", { name: "扫描", exact: true }).isDisabled(), true);
  await card.getByRole("switch").click();
  await until(async () => (await invoke("get_video_source_states")).find(item => item.id === source.id).enabled, "source enabled");
  const oldTasks = new Set((await invoke("list_scan_tasks")).map(task => task.id));
  await card.getByRole("button", { name: "扫描", exact: true }).click();
  await until(async () => (await invoke("list_scan_tasks")).some(task => !oldTasks.has(task.id) && task.rootId === source.id && task.stage === "completed"), "new scan completion");
  capture("sources"); await layout();
  await nav("媒体库");
  await page.getByRole("button", { name: /^待整理 ·/ }).click();
  const fixtureNames = ["h264.mp4", "h265.mkv", "h264-tracks.mkv"];
  let organizedWorkId;
  for (const name of fixtureNames) {
    const group = (await invoke("list_unassigned_media_groups")).find(group => group.representative.fileName === name);
    if (!group) continue;
    await page.locator(".gz-row-card").filter({ hasText: name }).click();
    const dialog = page.getByRole("dialog");
    await until(async () => (await dialog.locator("details .gz-file-name").count()) > 0, "organize file scope");
    const text = name === "h265.mkv" ? "Genzo 测试 · H.265" : "Genzo 测试 · H.264";
    await dialog.getByLabel("手动创建作品 *").fill(text);
    capture("organize");
    await dialog.getByRole("button", { name: "创建并整理本组" }).click();
    await until(async () => !(await page.getByRole("dialog").count()), "manual organization");
    organizedWorkId = (await invoke("list_works")).find(work => work.title === text)?.id;
    assert.ok(organizedWorkId);
    await nav("媒体库");
    await page.getByRole("button", { name: /^待整理 ·/ }).click();
  }
  const allWorks = await invoke("list_works");
  const work = allWorks.find(work => work.id === organizedWorkId) || allWorks.find(work => work.title.startsWith("Genzo 测试"));
  assert.ok(work);
  await nav("媒体库");
  await page.getByLabel("搜索媒体库").fill("没有这个作品QA");
  await page.getByRole("heading", { name: "没有匹配的作品", exact: true }).waitFor();
  capture("search-empty");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.locator(".gz-card").filter({ hasText: work.title }).first().click();
  await page.getByRole("heading", { name: work.title, exact: true }).waitFor();
  const before = await invoke("get_work", { id: work.id });
  if (!before.favorite) await page.getByRole("button", { name: "加入收藏", exact: true }).click();
  await until(async () => (await invoke("get_work", { id: work.id })).favorite, "favorite stored");
  await page.getByRole("button", { name: "个人记录", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("个人评分（0–10）").fill("8.5");
  await dialog.getByLabel("个人备注").fill("模拟器前端验证：个人记录持久化");
  await dialog.getByRole("button", { name: "保存记录", exact: true }).click();
  await until(async () => !(await page.getByRole("dialog").count()), "personal records saved");
  const saved = await invoke("get_work", { id: work.id });
  assert.equal(saved.rating, 8.5); assert.equal(saved.notes, "模拟器前端验证：个人记录持久化");
  capture("detail"); await layout();
  // System back first closes a sheet, then goes back to the library.
  await page.getByRole("button", { name: "个人记录", exact: true }).click();
  adb("shell", "input", "keyevent", "4");
  await sleep(500);
  // Android consumes Back to dismiss an open IME before forwarding it to the app.
  if (await page.getByRole("dialog").count()) adb("shell", "input", "keyevent", "4");
  await until(async () => !(await page.getByRole("dialog").count()), "native back closes sheet");
  assert.ok((await page.evaluate(() => location.hash)).startsWith("#/detail/"));
  const video = saved.mediaFiles.find(file => file.mediaType === "video");
  assert.ok(video);
  const previousSession = (await native("playerState")).sessionId;
  // The WebView suspends RAF as soon as the native Activity opens. Dispatch the
  // real React button rather than waiting for Playwright's post-click RAF.
  await page.locator(".gz-episode").filter({ hasText: video.fileName }).evaluate(button => button.click());
  await until(async () => { const state = await native("playerState"); return state.sessionId !== previousSession && state.mediaFileId === video.id && state.status === "playing" && state.positionMs > 300 && state.seekable && state.durationMs > 0; }, "real playback from detail");
  await native("playerControl", { action: "seek", value: 17000 });
  await until(async () => Math.abs((await native("playerState")).positionMs - 17000) < 1500, "seek reached");
  await native("playerControl", { action: "pause" });
  const tracked = await until(async () => (await invoke("get_playback_progress", { workId: work.id })).items.find(item => item.mediaFileId === video.id && item.positionMs >= 16000 && item.positionMs < 21000), "Rust stores SQLite progress without frontend write");
  capture("player");
  adb("shell", "input", "keyevent", "4");
  await until(async () => (await native("playerState")).status === "closed", "native player back");
  await nav("首页");
  await page.getByRole("button", { name: "刷新页面数据", exact: true }).click();
  await until(async () => (await page.locator(".gz-continue").filter({ hasText: video.fileName }).count()) > 0, "continue watching card");
  capture("home"); const viewport = await layout();
  const closedSession = (await native("playerState")).sessionId;
  await page.locator(".gz-continue").filter({ hasText: video.fileName }).evaluate(button => button.click());
  const resumed = await until(async () => { const state = await native("playerState"); return state.sessionId !== closedSession && state.mediaFileId === video.id && state.positionMs >= tracked.positionMs - 1500 && state.status === "playing" && state; }, "resume stored progress");
  await native("playerControl", { action: "pause" });
  adb("shell", "input", "keyevent", "4");
  await sleep(600);
  await nav("收藏");
  await page.locator(".gz-card").filter({ hasText: work.title }).first().waitFor();
  capture("favorites"); await layout();
  await nav("我的");
  await page.getByRole("radio", { name: "浅色", exact: true }).click();
  await until(async () => await page.locator(".android-app").getAttribute("data-theme") === "light", "light theme");
  capture("profile-light"); await layout();
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await until(async () => await page.locator(".android-app").getAttribute("data-theme") === "dark", "restore dark theme");
  // Relaunch retains SQL personal data, progress, source grants and theme.
  await browser.close();
  adb("shell", "am", "force-stop", "com.genzo.android");
  adb("shell", "am", "start", "-n", "com.genzo.android/.MainActivity");
  browser = await connect();
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", error => errors.push(String(error)));
  await page.getByRole("heading", { name: "Genzo", exact: true }).waitFor();
  await until(async () => await page.locator(".android-app").getAttribute("data-theme") === "dark", "theme after relaunch");
  const restored = await invoke("get_work", { id: work.id });
  assert.equal(restored.favorite, true);
  assert.equal(restored.rating, 8.5);
  assert.equal(restored.notes, saved.notes);
  const restoredProgress = (await invoke("get_playback_progress", { workId: work.id })).items.find(item => item.mediaFileId === video.id);
  assert.ok(restoredProgress.positionMs >= tracked.positionMs - 1500);
  assert.equal((await native("listTree")).uri, tree.uri);
  assert.equal((await invoke("get_video_source_states")).find(item => item.id === source.id).state, "available");
  capture("home");
  writeFileSync(`${output}/ui.json`, JSON.stringify({ serial, viewport, workId: work.id, mediaFileId: video.id, tracked, resumedPositionMs: resumed.positionMs, restoredPositionMs: restoredProgress.positionMs, restoredTheme: "dark", restoredPersonalRecords: true, restoredGrant: true, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log("PASS: emulator UI navigation, source toggle/scan, real manual organization, search empty state, favorite/personal records, native back, playback, SQLite progress, resume, light/dark layouts and relaunch persistence");
} finally { await browser.close(); }
