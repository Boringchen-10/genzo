import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

// Requires the independent QA app and the USB frontend preview, never the normal app.
const serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const directory = "D:/DevTools/Android/Build/frontend-device-preview";
const output = `D:/DevTools/Android/Build/qa/device-preview-${Date.now()}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]));
let browser = await chromium.connectOverCDP("http://127.0.0.1:9345", { noDefaults: true });
let page = browser.contexts()[0].pages().find(value => value.url().includes("tauri.localhost"));
page.setDefaultTimeout(20000);
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, label) {
  for (let index = 0; index < 150; index++) { const value = await read(); if (predicate(value)) return value; await delay(100); }
  throw new Error(label);
}
const state = () => native("readerState");
const control = async (action, value = 0) => native("readerControl", { sessionId: (await state()).sessionId, action, value });
const source = { kind: "comic", pathWord: "modujingbingdenuli" };
const resume = () => invoke("get_reading_resume", source);
const digest = async () => createHash("sha256").update(JSON.stringify((await invoke("list_works")).map(({ id, status, favorite, rating }) => ({ id, status, favorite, rating })).sort((a,b) => a.id.localeCompare(b.id)))).digest("hex");
const indexPath = resolve(directory, "index.html");
const cssPath = resolve(directory, `.${readFileSync(indexPath, "utf8").match(/href="([^"]+\.css)"/)[1]}`);
const originalCss = readFileSync(cssPath);
function rebuildMarker(css) { writeFileSync(cssPath, css); const now = new Date(); utimesSync(indexPath, now, now); }
const result = { serial, app, output, cases: {}, layouts: [] };
let cssChanged = false;
try {
  assert.equal((await invoke("get_app_info")).dataDirectory, `/data/user/0/${app}`);
  assert.equal(await page.evaluate(() => window.__GENZO_FRONTEND_PREVIEW__), true);
  const before = await digest();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "发现", exact: true }).click();
  await page.getByRole("tab", { name: "漫画", exact: true }).click();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索漫画" }).fill("魔都");
  await page.getByRole("searchbox", { name: "搜索漫画" }).press("Enter");
  await page.getByText("魔都的星塵", { exact: true }).click();
  await page.locator(".gz-online-chapters [data-chapter-id]").first().waitFor();
  const missingBook = await page.locator("[data-explore-detail-cover]").getAttribute("data-explore-detail-cover").catch(() => null);
  result.noRecordBook = missingBook;
  assert.equal(await page.locator(".gz-reading-resume").count(), 0);
  result.cases.noRecordHidden = true;
  shot("no-record");
  await page.getByRole("button", { name: "返回发现", exact: true }).click();
  await page.locator('[data-explore-cover-id="modujingbingdenuli"]').click();
  await page.locator(".gz-online-chapters [data-chapter-id]").first().waitFor();
  const button = page.locator(".gz-reading-resume");
  await button.waitFor();
  const saved = await resume(); assert.ok(saved);
  const entries = await invoke("get_book_source_entries", { ...source, group: saved.group, offset: 0, refresh: false });
  const entry = entries.entries.find(value => value.id === saved.entryId);
  assert.equal((await button.innerText()).trim(), entry?.title ?? "继续阅读");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  assert.equal(await button.count(), 0);
  await page.getByRole("button", { name: "取消", exact: true }).first().click();
  await button.waitFor(); result.cases.selectionHidden = true;
  await button.click();
  const opened = await until(state, value => value.rendered, "resume reader rendered");
  assert.equal(opened.entryId, saved.entryId);
  await control("seek", .35);
  await delay(800);
  const advanced = await state();
  await control("close"); await until(state, value => value.status === "closed", "native returned");
  await until(resume, value => value.updatedAt !== saved.updatedAt, "saved progress event");
  await button.click();
  const restored = await until(state, value => value.rendered, "resume restored");
  assert.equal(restored.entryId, advanced.entryId);
  assert.equal(restored.location.pageIndex, advanced.location.pageIndex);
  assert.ok(Math.abs((restored.location.offset ?? 0) - (advanced.location.offset ?? 0)) < .01);
  assert.deepEqual(restored.settings, opened.settings);
  await control("close"); await until(state, value => value.status === "closed", "close reader");
  result.cases.nativeResumeAndEvent = true;
  result.qaReadingRecordUpdated = { entryId: advanced.entryId, location: advanced.location };
  const session = await page.context().newCDPSession(page);
  const originalTheme = await page.locator(".android-app").getAttribute("data-theme");
  for (const width of [360, 412, 915]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width, height: width === 915 ? 412 : 915, deviceScaleFactor: 1, mobile: true });
    for (const theme of ["light", "dark"]) {
      await page.locator(".android-app").evaluate((node, value) => node.dataset.theme = value, theme);
      const layout = await button.evaluate(node => { const rect = node.getBoundingClientRect(), nav = document.querySelector(".gz-tabbar").getBoundingClientRect(), css = getComputedStyle(node); return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right, bottom: rect.bottom, navTop: nav.top, background: css.backgroundColor, color: css.color }; });
      assert.equal(layout.width, layout.scrollWidth); assert.ok(layout.left >= 0 && layout.right <= width); assert.ok(layout.bottom <= layout.navTop);
      result.layouts.push({ theme, ...layout });
      if (width === 412) await page.screenshot({ path: `${output}/${theme}.png` });
    }
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.locator(".android-app").evaluate((node, value) => node.dataset.theme = value, originalTheme);
  cssChanged = true;
  rebuildMarker(Buffer.concat([originalCss, Buffer.from("\n.android-app .gz-tabbar{background:rgb(255,0,255)!important}\n")]));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".gz-tabbar")).backgroundColor === "rgb(255, 0, 255)", { timeout: 20000 });
  shot("temporary-color"); result.cases.deviceCssReload = true;
  rebuildMarker(originalCss);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".gz-tabbar")).backgroundColor !== "rgb(255, 0, 255)", { timeout: 20000 });
  cssChanged = false; shot("color-restored");
  const pidBefore = command("shell", "pidof", app).trim();
  await browser.close(); browser = null;
  command("shell", "am", "force-stop", app);
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`);
  await delay(5000);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9345", { noDefaults: true });
  page = browser.contexts()[0].pages().find(value => value.url().includes("tauri.localhost"));
  await page.waitForFunction(() => window.__GENZO_FRONTEND_PREVIEW__ === true);
  assert.notEqual(command("shell", "pidof", app).trim(), pidBefore);
  assert.equal((await invoke("get_app_info")).dataDirectory, `/data/user/0/${app}`);
  assert.equal(await digest(), before);
  result.cases.restartReconnect = true; result.cases.workRecordsPreserved = true;
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, passed: true, cases: result.cases }));
} catch (error) {
  result.error = String(error); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error;
} finally {
  if (cssChanged) rebuildMarker(originalCss);
  await browser?.close();
}
