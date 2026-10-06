import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/menu-r13";
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
mkdirSync(output, { recursive: true });
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    let connection;
    try {
      const pid = adb("shell", "pidof", "com.genzo.android");
      if (!pid) throw new Error("app not running");
      adb("forward", "tcp:9227", `localabstract:webview_devtools_remote_${pid}`);
      connection = await chromium.connectOverCDP("http://127.0.0.1:9227", { noDefaults: true });
      if (connection.contexts()[0]?.pages().length) return connection;
    } catch { /* WebView socket not ready yet */ }
    await connection?.close();
    await sleep(250);
  }
  throw new Error("Emulator WebView did not become ready");
}
adb("shell", "am", "force-stop", "com.genzo.android");
adb("shell", "am", "start", "-n", "com.genzo.android/.MainActivity");
const browser = await connect();
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) { const value = await predicate(); if (value) return value; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
const capture = async name => { await sleep(350); writeFileSync(`${output}/${name}.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"])); };

try {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的" }).click();
  await page.locator(".gz-profile-page").first().waitFor();

  const sections = await page.locator(".gz-menu-section").evaluateAll(secs => secs.map(s => ({
    title: s.querySelector(".gz-menu-section-title")?.textContent?.trim(),
    rows: [...s.querySelectorAll(".gz-menu-group button .gz-menu-body strong")].map(b => b.textContent.trim()),
    subtitles: [...s.querySelectorAll(".gz-menu-group button .gz-menu-body .gz-meta")].map(b => b.textContent.trim()),
  })));
  assert.deepEqual(sections.map(s => s.title), ["内容与偏好", "数据与应用"], JSON.stringify(sections.map(s => s.title)));
  assert.deepEqual(sections[0].rows, ["通用", "外观", "播放设置", "弹幕设置", "书签", "阅读统计"], JSON.stringify(sections[0].rows));
  assert.deepEqual(sections[1].rows, ["同步备份", "下载设置", "网络", "资料库", "存储管理", "关于"], JSON.stringify(sections[1].rows));

  const allRows = sections.flatMap(s => s.rows);
  assert.equal(allRows.includes("通知中心"), false, "通知中心 removed");
  const allSubtitles = sections.flatMap(s => s.subtitles);
  assert.deepEqual(allSubtitles.slice().sort(), ["后续更新", "后续更新", "后续更新", "后续更新", "本地目录与来源管理", "追番与多设备同步"].sort(), JSON.stringify(allSubtitles));

  await capture("profile-menu");

  // New future entry opens the placeholder.
  await page.locator(".gz-menu-group button").filter({ hasText: "播放设置" }).click();
  await until(async () => (await page.getByText("播放设置 · Future").count()) > 0, "播放设置 placeholder");
  await capture("playback-settings-future");
  await page.locator(".gz-back").first().click();
  await until(async () => (await page.locator(".gz-profile-page").count()) > 0, "back to profile");

  // Existing entries still route correctly.
  await page.locator(".gz-menu-group button").filter({ hasText: "外观" }).click();
  await until(async () => (await page.locator(".gz-pref-block, .gz-set-row").count()) > 0, "appearance rendered");
  await capture("appearance");
  await page.locator(".gz-back").first().click();
  await until(async () => (await page.locator(".gz-profile-page").count()) > 0, "back to profile 2");

  assert.deepEqual(errors, [], JSON.stringify(errors));
  console.log("PASS");
  console.log(JSON.stringify(sections));
} finally {
  await browser.close();
}
