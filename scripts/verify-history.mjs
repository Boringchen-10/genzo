import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/history-r11";
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
    } catch { /* WebView socket not ready yet */ }
    await connection?.close();
    await sleep(250);
  }
  throw new Error("Emulator WebView did not become ready");
}
let browser = await connect();
let page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) { const value = await predicate(); if (value) return value; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
const nav = title => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: title, exact: true }).click();
const capture = name => writeFileSync(`${output}/${name}.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"]));
try {
  await nav("我的");
  await page.locator(".gz-profile-page").waitFor();
  // Account row (未登录) removed, menu copy trimmed.
  assert.equal(await page.locator(".gz-account-row").count(), 0, "account row removed");
  assert.equal(await page.getByRole("button", { name: "AI 配置" }).count(), 0, "AI 配置 removed");
  assert.equal(await page.getByRole("button", { name: "继续阅读漫画" }).count(), 0, "继续阅读漫画 removed");
  const statLabels = await page.locator(".gz-profile-stat span").allInnerTexts();
  assert.deepEqual(statLabels, ["看过作品", "观看时间"], JSON.stringify(statLabels));
  capture("profile");

  await page.locator(".gz-quick-card").filter({ hasText: "浏览记录" }).click();
  await page.locator(".gz-history-title").waitFor();
  assert.equal(await page.locator(".gz-history-title").innerText(), "浏览记录");
  const chips = await page.locator(".gz-history-tabs .gz-chip").allInnerTexts();
  assert.deepEqual(chips.map(text => text.trim()), ["全部", "动漫", "电影", "电视剧", "漫画", "小说", "未分类"], JSON.stringify(chips));
  assert.equal(await page.getByLabel("搜索浏览记录").count(), 1);
  const rows = await page.locator(".gz-history-row").count();
  const groups = await page.locator(".gz-history-group").count();
  const empty = await page.getByText("还没有观看记录").count();
  console.log(`history rows=${rows} groups=${groups} empty=${empty}`);
  capture("history");

  if (rows > 0) {
    await page.getByRole("button", { name: "管理历史记录" }).click();
    await page.locator(".gz-history-done").waitFor();
    assert.ok(await page.locator(".gz-history-del").count() > 0, "delete buttons in manage mode");
    assert.equal(await page.locator(".gz-history-play").count(), 0, "play buttons hidden in manage mode");
    await page.getByRole("button", { name: "清除全部记录" }).click();
    await page.locator("#gz-confirm-title").waitFor();
    assert.equal(await page.locator("#gz-confirm-title").innerText(), "清除全部观看记录？");
    capture("history-confirm");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await until(async () => (await page.locator("#gz-confirm-title").count()) === 0, "confirm dismissed");
    await page.locator(".gz-history-done").click();
    await until(async () => (await page.locator(".gz-history-done").count()) === 0, "exit manage mode");
    // Item action sheet.
    await page.locator(".gz-history-more").first().click();
    await page.locator(".gz-sheet-title").first().waitFor();
    assert.ok(await page.getByText("移除观看记录").count() > 0);
    await page.keyboard.press("Escape");
    await until(async () => (await page.locator(".gz-sheet-title").count()) === 0, "action sheet dismissed");
  }

  await page.locator(".gz-back").first().click();
  await until(async () => (await page.locator(".gz-profile-page").count()) > 0, "back to profile");
  await page.getByRole("button", { name: "阅读统计" }).click();
  await until(async () => (await page.locator(".gz-stats-tiles").count()) > 0, "reading-stats page rendered");
  await sleep(300);
  const stats = await page.evaluate(() => ({
    tiles: [...document.querySelectorAll(".gz-stats-tile")].map(tile => ({ label: tile.querySelector("span")?.textContent?.trim(), h: tile.getBoundingClientRect().height })),
    cards: [...document.querySelectorAll(".gz-stats-card-head h2")].map(head => head.textContent?.trim()),
    heat: document.querySelectorAll(".gz-heat").length,
  }));
  const tileLabels = stats.tiles.map(tile => tile.label);
  const cardHeads = stats.cards;
  assert.equal(stats.tiles.length, 3, "stats tile count");
  assert.deepEqual(tileLabels, ["漫画", "章节", "页数"], JSON.stringify(tileLabels));
  assert.ok(stats.tiles.every(tile => tile.h > 0), "stats tiles have layout");
  assert.deepEqual(cardHeads, ["常看类型", "阅读活跃度"], JSON.stringify(cardHeads));
  assert.equal(stats.heat, 26 * 7, "heatmap cells");
  capture("reading-stats");

  await page.evaluate(() => document.querySelector(".gz-stats-fab")?.click());
  await until(async () => (await page.locator(".gz-choice-row").count()) === 2, "stats settings rendered");
  assert.equal(await page.locator(".gz-toggle-draggable").count(), 3);
  await page.evaluate(() => document.querySelector(".gz-toggle-draggable")?.click());
  capture("reading-stats-settings");

  await page.evaluate(() => document.querySelector(".gz-back")?.click());
  await until(async () => (await page.locator(".gz-stats-note").count()) > 0, "back to reading-stats");
  await sleep(300);
  assert.deepEqual(errors, [], JSON.stringify(errors));
  writeFileSync(`${output}/result.json`, JSON.stringify({ rows, groups, chips, statLabels, tileLabels, cardHeads, errors }, null, 2));
  console.log("PASS: 浏览记录 + 阅读统计 pages, manage/clear confirm, profile copy trims");
} finally { await browser.close(); }
