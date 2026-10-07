import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Public metadata and UI only; never imports works, reads chapters or changes accounts.
const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/daily-rail";
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
async function until(predicate, label, tries = 100) {
  for (let i = 0; i < tries; i++) { const value = await predicate(); if (value) return value; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
const capture = async name => { await sleep(350); writeFileSync(`${output}/${name}.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 32 * 1024 * 1024 })); };
const nav = () => page.getByRole("navigation", { name: "主导航" });
async function invoke(command, args = {}) {
  return await page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}

try {
  const report = {};
  await until(async () => (await nav().count()) > 0, "bottom navigation", 60);
  await page.waitForFunction(() => document.readyState === "complete" && !!window.__TAURI_INTERNALS__);

  await nav().getByRole("button", { name: "发现" }).click();
  await until(async () => (await page.getByRole("heading", { name: "每日更新", exact: true }).count()) > 0, "每日更新 heading", 100);

  const daily = page.locator("section").filter({ has: page.getByRole("heading", { name: "每日更新", exact: true }) });
  const hot = page.locator("section").filter({ has: page.getByRole("heading", { name: "热门番组", exact: true }) });
  assert.equal(await daily.count(), 1, "one 每日更新 section");
  assert.equal(await hot.count(), 1, "one 热门番组 section");
  assert.equal(await page.getByRole("heading", { name: "当季番组", exact: true }).count(), 0, "当季番组 section removed");

  // 时间表 entry lives in the 每日更新 header and opens the schedule view.
  const scheduleEntry = daily.getByRole("button", { name: "时间表" });
  await until(async () => (await scheduleEntry.count()) === 1, "时间表 entry");
  report.hasScheduleEntry = true;

  // 每日更新 renders a horizontally scrollable cover rail above 热门番组.
  const rail = daily.locator(".gz-cover-rail");
  await until(async () => (await rail.locator(".gz-cover").count()) > 0, "daily cover rail", 100);
  const ids = await rail.locator("[data-explore-cover-id]").evaluateAll(nodes => nodes.map(node => node.dataset.exploreCoverId));
  const railMetrics = await rail.evaluate(node => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: getComputedStyle(node).overflowX }));
  report.dailyCovers = ids.length;
  report.rail = railMetrics;
  assert.equal(railMetrics.overflowX, "auto", "daily rail scrolls horizontally");

  // Daily covers must match today's weekday from the weekly calendar feed.
  const calendar = await invoke("get_weekly_calendar");
  const today = await page.evaluate(() => new Date().getDay() === 0 ? 7 : new Date().getDay());
  const todays = calendar.days.find(day => day.weekday === today)?.items ?? [];
  assert.deepEqual(ids, todays.map(item => item.externalId), "daily rail mirrors today's broadcast feed");
  report.today = today;
  report.todayItems = todays.length;

  // DOM order: 每日更新 above 热门番组.
  const order = await page.evaluate(() => {
    const sections = [...document.querySelectorAll("section")];
    const top = text => sections.find(node => node.querySelector("h2")?.textContent === text)?.getBoundingClientRect().top ?? null;
    return { daily: top("每日更新"), hot: top("热门番组") };
  });
  assert.ok(order.daily != null && order.hot != null && order.daily < order.hot, "每日更新 sits above 热门番组");
  report.order = order;

  await capture("feed");

  // Tapping 时间表 navigates to the schedule view, which no longer exposes 当季番组.
  await scheduleEntry.click();
  await until(async () => (await page.getByRole("heading", { name: "放送时间表", exact: true }).count()) > 0, "schedule view", 60);
  assert.equal(await page.getByRole("heading", { name: "当季番组", exact: true }).count(), 0, "no 当季番组 in schedule view");
  await capture("schedule");

  assert.deepEqual(errors, []);
  const result = { date: new Date().toISOString(), serial, today, todayItems: todays.length, dailyCovers: ids.length, rail: railMetrics, order, hasScheduleEntry: true, errors };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
