import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const port = process.env.GENZO_PREVIEW_PORT ?? "9228";
const output = `D:/DevTools/Android/Build/qa/novel-comments-${Date.now()}`;
mkdirSync(output, { recursive: true });
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 }));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
const page = browser.contexts()[0].pages().find(value => value.url().includes("tauri.localhost"));
page.setDefaultTimeout(20000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { serial, output, cases: {} };

async function openNovelWithChapters() {
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
  for (const id of ids) {
    await page.locator(`[data-explore-cover-id="${id}"]`).click();
    const reached = await page.locator(".gz-online-chapters [data-chapter-id]").first().waitFor({ timeout: 9000 }).then(() => true, () => false);
    if (reached) return id;
    await page.getByRole("button", { name: "返回发现", exact: true }).click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  return null;
}

try {
  assert.equal(await page.evaluate(() => window.__GENZO_FRONTEND_PREVIEW__), true);
  const pathWord = await openNovelWithChapters();
  assert.ok(pathWord, "no novel with chapters");
  result.pathWord = pathWord;

  result.inlineSectionGone = (await page.locator("#gz-book-comments").count()) === 0;
  assert.ok(result.inlineSectionGone, "inline novel comments section should be removed");

  await page.locator(".gz-book-actions").getByRole("button", { name: "评论", exact: true }).click();
  const dialog = page.locator(".gz-comments-dialog");
  await page.locator(".gz-comments-dialog[open]").waitFor({ timeout: 10000 });
  result.cases.novelPanelOpens = true;

  const title = await page.locator("#gz-comments-title").innerText();
  const meta = await page.locator(".gz-comments-dialog[open] header .gz-meta").first().innerText();
  result.title = title; result.meta = meta;
  assert.equal(title, "轻小说评论");
  assert.match(meta, /轻小说/);

  const timeline = [];
  for (let i = 0; i < 12; i++) { await delay(500); timeline.push(await dialog.evaluate(node => ({ open: node.hasAttribute("open"), connected: node.isConnected })).catch(() => ({ gone: true }))); }
  result.timeline = timeline;
  const body = await page.locator(".gz-comments-dialog").innerText().catch(() => "");
  result.state = /还没有来源评论/.test(body) ? "empty" : /读取失败|网络/.test(body) ? "error" : /条回复|展开全文/.test(body) ? "loaded" : "unknown";
  result.bodyHead = body.split("\n").slice(0, 6);
  await shot("novel-comments");

  await page.locator(".gz-comments-dialog[open]").getByRole("button", { name: "关闭评论" }).click();
  await page.locator(".gz-comments-dialog[open]").waitFor({ state: "detached", timeout: 5000 });

  await page.getByRole("button", { name: "返回发现", exact: true }).click();
  await page.getByRole("tab", { name: "漫画", exact: true }).click();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索漫画" }).fill("魔都");
  await page.getByRole("searchbox", { name: "搜索漫画" }).press("Enter");
  await page.locator('[data-explore-cover-id="modujingbingdenuli"]').click();
  await page.locator(".gz-online-chapters [data-chapter-id]").first().waitFor();
  await page.locator(".gz-book-actions").getByRole("button", { name: "评论", exact: true }).click();
  await page.locator(".gz-comments-dialog[open]").waitFor();
  const comicTitle = await page.locator("#gz-comments-title").innerText();
  result.comicTitle = comicTitle;
  assert.equal(comicTitle, "漫画评论");
  result.cases.comicStillManga = true;
  await shot("comic-comments");

  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, passed: true, pathWord, title, state: result.state, comicTitle, cases: result.cases }));
} catch (error) {
  result.error = String(error); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error;
} finally {
  await browser.close();
}
