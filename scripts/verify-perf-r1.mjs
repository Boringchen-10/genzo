import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/perf-r1";
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
async function until(predicate, label, tries = 100) {
  for (let i = 0; i < tries; i++) { const value = await predicate(); if (value) return value; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
const capture = async name => { await sleep(350); writeFileSync(`${output}/${name}.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"])); };
const nav = () => page.getByRole("navigation", { name: "主导航" });
const hash = () => page.evaluate(() => location.hash);
const noTrans = () => page.evaluate(() => !document.documentElement.dataset.trans);

try {
  const report = {};

  // Wait for the app shell.
  await until(async () => (await nav().count()) > 0, "bottom navigation", 60);

  // Go to the media library grid.
  await nav().getByRole("button", { name: "媒体库" }).click();
  await until(async () => (await hash()) === "#/library", "library route");
  const cards = await until(async () => (await page.locator(".gz-card").count()) || 0, "library cards", 60).catch(() => 0);
  report.cards = cards;

  // 1. CSS perf layer actually applied.
  if (cards > 0) {
    report.cardContain = await page.locator(".gz-card").first().evaluate(el => getComputedStyle(el).contentVisibility);
    report.posterContain = await page.locator(".gz-card .gz-poster").first().evaluate(el => getComputedStyle(el).contain);
    report.posterImg = await page.locator(".gz-card .gz-poster img").first().evaluate(img => ({ loading: img.loading, decoding: img.decoding, draggable: img.draggable }));
    assert.equal(report.cardContain, "auto", "content-visibility on grid cards");
    assert.match(report.posterContain, /paint/, "contain:paint on poster");
    assert.equal(report.posterImg.loading, "lazy");
    assert.equal(report.posterImg.decoding, "async");
    assert.equal(report.posterImg.draggable, false);
  }
  await capture("library");

  // 2. Filter/search still recomputes (memo wired correctly).
  if (cards > 0) {
    await page.locator(".gz-shelf-bar button[aria-label='搜索媒体库']").click();
    await page.locator(".gz-search input").fill("zzz-no-match-zzz");
    await until(async () => (await page.locator(".gz-card").count()) === 0, "search narrows to zero");
    report.searchNarrowedTo = 0;
    await page.locator(".gz-search input").fill("");
    await until(async () => (await page.locator(".gz-card").count()) === cards, "search cleared restores");
    report.searchRestoredTo = await page.locator(".gz-card").count();
    await page.locator(".gz-shelf-bar button[aria-label='关闭搜索']").click().catch(() => {});
  }

  // 3. Tab switches: timing + no stuck transition state.
  const routes = [["首页", "home"], ["媒体库", "library"], ["书架", "bookshelf"], ["发现", "explore"], ["我的", "profile"]];
  const timings = [];
  for (const [label, route] of routes) {
    const started = Date.now();
    await nav().getByRole("button", { name: label }).click();
    await until(async () => (await hash()) === `#/${route}`, `route ${route}`);
    timings.push({ route, ms: Date.now() - started });
  }
  report.tabSwitchMs = timings;
  await until(noTrans, "transition state cleared");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.trans ?? null), null, "data-trans cleaned up");

  // 4. Home sections render (homeSectionsData memo) or the empty hero.
  await nav().getByRole("button", { name: "首页" }).click();
  await until(async () => (await page.locator(".gz-section, .gz-hero").count()) > 0, "home rendered");
  report.homeSections = await page.locator(".gz-section-head h2").allTextContents();
  await capture("home");

  // 5. Shared-element morph into detail.
  await nav().getByRole("button", { name: "媒体库" }).click();
  await until(async () => (await page.locator(".gz-card").count()) > 0, "media present", 60);
  await page.locator(".gz-card").first().click();
  await until(async () => (await page.locator(".gz-detail-head").count()) > 0, "detail head", 60);
  await until(noTrans, "morph state cleared");
  assert.ok(await page.locator(".gz-detail-head .gz-poster").count() > 0, "detail header cover rendered");
  report.detailOpened = true;
  await capture("detail");

  // 6. Back to library via the sub-page back button.
  await page.locator(".gz-back").first().click();
  await until(async () => (await page.locator(".gz-card").count()) > 0, "back to library");

  assert.deepEqual(errors, [], JSON.stringify(errors));
  console.log("PASS");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
