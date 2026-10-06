import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/sync-r12";
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
// Cold reset so the WebView always starts on #/home.
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
const nav = title => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: title }).click();
const capture = async name => { await sleep(350); writeFileSync(`${output}/${name}.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"])); };
const backToProfile = async () => {
  await page.locator(".gz-back").first().click();
  await until(async () => (await page.locator(".gz-profile-page").count()) > 0, "back to profile");
};
try {
  await nav("我的");
  await page.locator(".gz-profile-page").waitFor();

  // 数据与应用 exposes 同步备份 as the first entry.
  const syncEntry = page.locator(".gz-menu-section").filter({ hasText: "数据与应用" }).getByRole("button", { name: "同步备份" });
  assert.equal(await syncEntry.count(), 1, "同步备份 entry present");
  await capture("profile-sync-entry");

  await syncEntry.click();
  await until(async () => (await page.locator(".gz-sync-card").count()) === 2, "sync settings rendered");
  const cards = await page.locator(".gz-sync-card").allInnerTexts();
  assert.ok(cards.some(text => text.includes("Bangumi") && text.includes("追番同步")), "Bangumi card");
  assert.ok(cards.some(text => text.includes("WebDAV") && text.includes("多设备同步")), "WebDAV card");
  const badges = await page.locator(".gz-sync-card .gz-badge").allInnerTexts();
  assert.deepEqual(badges, ["未连接", "未配置"], JSON.stringify(badges));
  await capture("sync-settings");

  // Bangumi sync page.
  await page.locator(".gz-sync-action").filter({ hasText: "连接 Bangumi" }).click();
  await until(async () => (await page.locator(".gz-sync-account").count()) > 0, "bangumi page rendered");
  assert.equal(await page.getByLabel("Access Token").count(), 1);
  assert.equal(await page.getByRole("button", { name: "获取授权码" }).count(), 1);
  const autoToggle = page.locator(".gz-toggle-row").filter({ hasText: "自动同步追番" });
  assert.ok(await autoToggle.isDisabled(), "auto sync disabled before connect");
  await page.locator(".gz-toggle-row").filter({ hasText: "同步偏好" }).click();
  await until(async () => (await page.locator(".gz-sync-pref-body .gz-choice-row").count()) === 2, "sync preference choices");
  await page.locator(".gz-sync-pref-body .gz-choice-row").filter({ hasText: "远端优先" }).click();
  await capture("bangumi-sync");

  await page.getByLabel("Access Token").fill("demo-access-token");
  await page.getByRole("button", { name: "验证并保存" }).click();
  await until(async () => !(await autoToggle.isDisabled()), "auto sync enabled after connect");
  await page.locator(".gz-toggle-row").filter({ hasText: "自动同步追番" }).click();
  await page.getByRole("button", { name: "立即同步追番" }).click();
  await until(async () => (await page.getByText("立即同步追番待后端接入").count()) > 0, "bangumi sync toast");
  await capture("bangumi-connected");

  await page.locator(".gz-back").first().click();
  await until(async () => (await page.locator(".gz-sync-card").count()) === 2, "back to sync settings");
  const badgesAfter = await page.locator(".gz-sync-card .gz-badge").allInnerTexts();
  assert.deepEqual(badgesAfter, ["已连接", "未配置"], JSON.stringify(badgesAfter));

  // WebDAV sync page.
  await page.locator(".gz-sync-action").filter({ hasText: "设置 WebDAV" }).click();
  await until(async () => (await page.locator(".gz-block-title").filter({ hasText: "同步内容" }).count()) > 0, "webdav page rendered");
  const enableToggle = page.locator(".gz-toggle-row").filter({ hasText: "启用 WebDAV" });
  assert.ok(await enableToggle.isDisabled(), "webdav toggle disabled before configure");
  assert.equal(await page.locator(".gz-block-body .gz-toggle-row").count(), 3, "sync content rows");
  await capture("webdav-sync");

  await page.locator(".gz-sync-cloud").click();
  await until(async () => (await page.locator("#gz-sync-server-title").count()) > 0, "sync server sheet");
  assert.equal(await page.locator("#gz-sync-server-title").innerText(), "连接 WebDAV");
  const save = page.getByRole("button", { name: "保存并测试" });
  assert.ok(await save.isDisabled(), "save disabled without endpoint");
  await capture("sync-server");
  await page.getByLabel("服务器地址").fill("https://dav.example.com/remote.php/dav");
  await page.getByLabel("用户名").fill("genzo");
  await page.getByLabel("密码或应用授权码").fill("app-password");
  await save.click();
  await until(async () => (await page.locator("#gz-sync-server-title").count()) === 0, "server sheet closed");

  await until(async () => !(await enableToggle.isDisabled()), "webdav toggle enabled after configure");
  await enableToggle.click();
  await page.locator(".gz-block-body .gz-toggle-row").filter({ hasText: "弹幕屏蔽词" }).click();
  await until(async () => !(await page.getByRole("button", { name: "立即同步观看记录" }).isDisabled()), "sync history button enabled");
  await until(async () => !(await page.getByRole("button", { name: "立即同步弹幕屏蔽词" }).isDisabled()), "sync danmaku button enabled");
  await page.getByRole("button", { name: "立即同步观看记录" }).click();
  await until(async () => (await page.getByText("同步观看记录待后端接入").count()) > 0, "webdav sync toast");
  await capture("webdav-configured");

  await page.locator(".gz-back").first().click();
  await until(async () => (await page.locator(".gz-sync-card").count()) === 2, "back to sync settings");
  await backToProfile();
  assert.deepEqual(errors, [], JSON.stringify(errors));
  writeFileSync(`${output}/result.json`, JSON.stringify({ badges, badgesAfter, errors }, null, 2));
  console.log("PASS: 同步备份 entry + 同步设置 / 追番同步 / 多设备同步 / 同步服务器 screens");
} finally { await browser.close(); }
