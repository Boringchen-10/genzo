import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const port = process.env.GENZO_PREVIEW_PORT ?? "9228";
const output = `D:/DevTools/Android/Build/qa/novel-resume-${Date.now()}`;
mkdirSync(output, { recursive: true });
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 }));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
const page = browser.contexts()[0].pages().find(value => value.url().includes("tauri.localhost"));
page.setDefaultTimeout(20000);
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, label, tries = 200) {
  for (let index = 0; index < tries; index++) { const value = await read(); if (predicate(value)) return value; await delay(100); }
  throw new Error(label);
}
const state = () => native("readerState");
const control = async (action, value = 0) => native("readerControl", { sessionId: (await state()).sessionId, action, value });
const pillStyle = node => { const css = getComputedStyle(node), rect = node.getBoundingClientRect(); return { position: css.position, background: css.backgroundColor, color: css.color, borderRadius: css.borderRadius, left: Math.round(rect.left), right: Math.round(rect.right), bottom: Math.round(rect.bottom), icon: !!node.querySelector("svg") }; };
const result = { serial, output, cases: {} };
try {
  assert.equal(await page.evaluate(() => window.__GENZO_FRONTEND_PREVIEW__), true);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "发现", exact: true }).click();
  await page.getByRole("button", { name: "返回发现", exact: true }).click().catch(() => {});
  await page.waitForTimeout(600);
  await page.getByRole("tab", { name: "轻小说", exact: true }).click({ timeout: 15000 });
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索轻小说" }).fill("无职");
  await page.getByRole("searchbox", { name: "搜索轻小说" }).press("Enter");
  await page.waitForTimeout(3000);
  const ids = await page.locator("[data-explore-cover-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-explore-cover-id")));
  result.novelCandidates = ids;
  let pathWord = null, pill = null;
  for (const id of ids) {
    await page.locator(`[data-explore-cover-id="${id}"]`).click();
    const chapters = page.locator(".gz-online-chapters [data-chapter-id]");
    const reached = await chapters.first().waitFor({ timeout: 9000 }).then(() => true, () => false);
    if (reached) { pathWord = id; break; }
    await page.getByRole("button", { name: "返回发现", exact: true }).click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  assert.ok(pathWord, "no novel with chapters");
  result.pathWord = pathWord;
  pill = page.locator(".gz-reading-resume");
  result.hiddenWithoutRecord = (await pill.count()) === 0;
  await shot("before-record");
  if (!(await pill.count())) {
    await page.locator(".gz-online-chapters [data-chapter-id]").first().click();
    const opened = await until(state, value => value.rendered, "novel reader rendered");
    result.opened = { entryId: opened.entryId, kind: opened.kind };
    await control("seek", .3); await delay(900);
    await control("next"); await delay(700);
    await control("close");
    await until(state, value => value.status === "closed", "native returned");
    await pill.first().waitFor({ timeout: 20000 });
  }
  const novel = await pill.evaluate(pillStyle);
  result.novel = novel;
  assert.equal(novel.position, "fixed");
  assert.ok(novel.icon, "pill shows play icon");
  result.cases.visibleWithRecord = true;
  await shot("novel-record");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  assert.equal(await pill.count(), 0);
  result.cases.selectionHidden = true;
  await page.getByRole("button", { name: "取消", exact: true }).first().click();
  await pill.waitFor();
  await page.getByRole("button", { name: "返回发现", exact: true }).click();
  await page.getByRole("tab", { name: "漫画", exact: true }).click();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索漫画" }).fill("魔都");
  await page.getByRole("searchbox", { name: "搜索漫画" }).press("Enter");
  await page.locator('[data-explore-cover-id="modujingbingdenuli"]').click();
  await page.locator(".gz-online-chapters [data-chapter-id]").first().waitFor();
  const comicPill = page.locator(".gz-reading-resume");
  await comicPill.waitFor({ timeout: 20000 });
  result.comic = await comicPill.evaluate(pillStyle);
  for (const key of ["position", "background", "color", "borderRadius", "icon"]) assert.equal(result.comic[key], novel[key], `comic ${key} matches novel`);
  result.cases.matchesComic = true;
  await shot("comic-record");
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, passed: true, novel, comic: result.comic, cases: result.cases }));
} catch (error) {
  result.error = String(error); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error;
} finally {
  await browser.close();
}
