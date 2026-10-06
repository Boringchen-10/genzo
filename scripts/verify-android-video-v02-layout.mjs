import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const output = "D:/DevTools/Android/Build/qa/video-v02";
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const serial = "emulator-5554";
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = JSON.parse(readFileSync(`${output}/result.json`, "utf8"));
mkdirSync(output, { recursive: true });
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    let browser;
    try {
      adb("forward", "tcp:9227", `localabstract:webview_devtools_remote_${adb("shell", "pidof", "com.genzo.android")}`);
      browser = await chromium.connectOverCDP("http://127.0.0.1:9227", { noDefaults: true });
      if (browser.contexts()[0]?.pages().length) return browser;
    } catch { /* Wait for the WebView after relaunch. */ }
    await browser?.close(); await sleep(250);
  }
  throw new Error("Emulator WebView not ready");
}
let browser = await connect();
let page = browser.contexts()[0].pages()[0];
async function invoke(command, args = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await page.evaluate(({ command, args }) => Promise.race([window.__TAURI_INTERNALS__.invoke(command, args), new Promise((_, reject) => setTimeout(() => reject(new Error(`IPC timed out: ${command}`)), 15000))]), { command, args }); }
    catch (error) {
      if (attempt >= 4 || !String(error).includes("state not managed")) throw error;
      await sleep(400);
    }
  }
}
const nav = title => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: title, exact: true }).click();
const checks = [];
const originalSize = /Override size: (\d+x\d+)/.exec(adb("shell", "wm", "size"))?.[1] ?? "reset";
const densityOutput = adb("shell", "wm", "density");
const density = Number(/Override density: (\d+)/.exec(densityOutput)?.[1] ?? /Physical density: (\d+)/.exec(densityOutput)?.[1]);
assert.ok(density > 0);
try {
  const configured = (await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb").configured;
  assert.ok(configured);
  assert.equal(await invoke("get_setting", { key: "metadata.tmdb_read_token" }), null);
  const saved = await invoke("get_playback_progress", { workId: result.workId });
  for (const [width, height] of [[360, 800], [412, 915], [915, 412]]) {
    adb("shell", "wm", "size", `${Math.round(width * density / 160)}x${Math.round(height * density / 160)}`);
    await sleep(500);
    for (const view of ["home", "library", "sources", "webdav", "correction"]) {
      if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
      if (view === "home") await nav("首页");
      if (view === "library") await nav("媒体库");
      if (["sources", "webdav"].includes(view)) {
        await nav("我的"); await page.getByRole("button", { name: "资料库", exact: false }).click();
        if (view === "webdav") await page.getByRole("button", { name: "添加 WebDAV 视频来源" }).click();
      }
      if (view === "correction") {
        await page.evaluate(id => { location.hash = `#/detail/${id}`; }, result.workId);
        await page.getByRole("tab", { name: "概览", exact: true }).click();
        await page.getByRole("button", { name: "分集纠错", exact: true }).click();
      }
      await sleep(300);
      const geometry = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, main: rect(".gz-scroll"), nav: rect(".gz-tabbar") };
      });
      assert.equal(geometry.scrollWidth, geometry.width, `${view} ${width}`);
      assert.ok(Math.abs(geometry.width - width) < 44, `Android viewport did not resize: ${geometry.width}, expected ${width}`);
      assert.ok(geometry.main.top >= -1 && geometry.main.bottom <= geometry.nav.top + 1, JSON.stringify(geometry));
      assert.ok(geometry.nav.bottom <= geometry.height + 1, JSON.stringify(geometry));
      await page.screenshot({ path: `${output}/layout-${view}-${width}.png` });
      checks.push({ view, width, height, geometry });
    }
    console.log(`PASS: Android layouts at ${width} x ${height}`);
  }
  if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  adb("shell", "wm", "size", originalSize);
  await browser.close();
  console.log("Checking restart persistence");
  adb("shell", "am", "force-stop", "com.genzo.android");
  adb("shell", "am", "start", "-n", "com.genzo.android/.MainActivity");
  browser = await connect(); page = browser.contexts()[0].pages()[0];
  console.log("Restarted WebView connected");
  assert.ok((await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb").configured);
  assert.equal(await invoke("get_setting", { key: "metadata.tmdb_read_token" }), null);
  console.log("PASS: restarted Token remains configured and hidden");
  assert.deepEqual((await invoke("get_playback_progress", { workId: result.workId })).items, saved.items);
  assert.equal((await invoke("get_work", { id: result.workId })).rating, 7.5);
  await page.evaluate(() => { location.hash = "#/home"; });
  writeFileSync(`${output}/layout-result.json`, JSON.stringify({ checks, tokenHiddenAndRetained: true, progressAndRatingRetained: true }, null, 2));
  console.log("PASS: narrow, phone and landscape layouts; Token hidden; restart retains credentials and progress");
} finally {
  adb("shell", "wm", "size", originalSize);
  await browser.close();
}
