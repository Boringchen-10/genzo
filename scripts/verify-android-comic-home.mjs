import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Public metadata and UI only; never imports works, reads chapters or changes accounts.
const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/comic-home";
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(output, { recursive: true });
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
async function until(predicate, label, tries = 120) {
  for (let i = 0; i < tries; i++) { const value = await predicate(); if (value) return value; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
const capture = async name => { await sleep(350); writeFileSync(`${output}/${name}.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 32 * 1024 * 1024 })); };
const nav = () => page.getByRole("navigation", { name: "主导航" });
const section = name => page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });

try {
  const report = {};
  await until(async () => (await nav().count()) > 0, "bottom navigation", 60);
  await page.waitForFunction(() => document.readyState === "complete" && !!window.__TAURI_INTERNALS__);

  await nav().getByRole("button", { name: "发现" }).click();
  await page.getByRole("tab", { name: "漫画" }).click();

  // Home groups driven by get_comic_explore_home.
  await until(async () => (await section("推荐").count()) > 0, "推荐 section", 120);
  report.recommended = await section("推荐").count();
  report.ranking = await section("排行榜").count();
  report.newArrivals = await section("全新上架").count();
  report.completed = await section("已完结").count();
  assert.equal(report.recommended, 1, "推荐 section present");
  assert.equal(report.ranking, 1, "排行榜 section present");
  assert.equal(report.newArrivals, 1, "全新上架 section present");
  assert.equal(report.completed, 1, "已完结 section present");

  // 排行榜 renders the three period sub-rows.
  const periods = await section("排行榜").locator(".gz-comic-period").allTextContents();
  report.periods = periods;
  assert.deepEqual(periods, ["日榜", "周榜", "月榜"], "ranking periods 日/周/月");

  // 推荐 is a horizontally scrollable rail.
  const rail = section("推荐").locator(".gz-comic-rail");
  await until(async () => (await rail.locator(".gz-comic-card").count()) > 0, "推荐 rail cards", 120);
  const railMetrics = await rail.evaluate(node => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: getComputedStyle(node).overflowX }));
  report.rail = railMetrics;
  registerRail: {
    const first = await section("推荐").locator(".gz-comic-grid, .gz-comic-rail").first().count();
    assert.ok(first >= 1, "推荐 grid/rail present");
  }

  // Each paging-capable section exposes a 更多 entry.
  report.moreRecommended = await section("推荐").getByRole("button", { name: "更多" }).count();
  report.moreRanking = await section("排行榜").getByRole("button", { name: "更多" }).count();
  report.moreNewArrivals = await section("全新上架").getByRole("button", { name: "更多" }).count();
  report.moreCompleted = await section("已完结").getByRole("button", { name: "更多" }).count();
  assert.equal(report.moreRecommended, 1, "推荐 更多 entry");
  assert.equal(report.moreRanking, 1, "排行榜 更多 entry");
  assert.equal(report.moreNewArrivals, 1, "全新上架 更多 entry");
  assert.equal(report.moreCompleted, 1, "已完结 更多 entry");

  await capture("home");

  // 排行榜 更多 opens the paginated section view with period tabs.
  await section("排行榜").getByRole("button", { name: "更多" }).click();
  await until(async () => (await page.getByRole("tab", { name: "日榜" }).count()) > 0, "ranking section view", 60);
  const grid = page.locator(".gz-comic-grid-lg");
  await until(async () => (await grid.locator(".gz-comic-card").count()) > 0, "ranking section grid", 120);
  report.sectionCards = await grid.locator(".gz-comic-card").count();
  assert.ok(report.sectionCards > 4, "section view pages beyond the home preview");
  await capture("ranking-section");

  // Switching the period re-queries the section endpoint.
  await page.getByRole("tab", { name: "月榜" }).click();
  await until(async () => (await page.locator(".gz-comic-grid-lg .gz-comic-card").count()) > 0, "月榜 grid", 120);
  report.afterPeriodSwitch = await page.locator(".gz-comic-grid-lg .gz-comic-card").count();

  assert.deepEqual(errors, []);
  const result = { date: new Date().toISOString(), serial, ...report, errors };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
