import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { build } from "vite";

const output = "D:/DevTools/Android/Build/qa/comic-detail-20261007";
mkdirSync(output, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9228", { noDefaults: true });
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const chapters = page.locator(".gz-online-chapters");
const chapterIds = () => chapters.locator("[data-chapter-id]").evaluateAll(nodes => nodes.map(node => node.dataset.chapterId));
async function snapshot() {
  const works = (await invoke("list_works")).map(({ id, status, rating, favorite }) => ({ id, status, rating, favorite })).sort((a, b) => a.id.localeCompare(b.id));
  return { count: works.length, hash: createHash("sha256").update(JSON.stringify(works)).digest("hex") };
}
try {
  assert.equal(await page.evaluate(() => window.__GENZO_FRONTEND_PREVIEW__), true);
  const before = await snapshot();
  const works = await invoke("list_works");
  const work = works.find(item => item.title === "魔都精兵的奴隸");
  assert.ok(work);
  await page.evaluate(id => { location.hash = `#/detail/${id}`; }, work.id);
  await chapters.locator("[data-chapter-id]").first().waitFor();
  await chapters.getByRole("tab", { name: /单行本\s*\(20\)/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "个人记录", exact: true }).count(), 0);
  assert.ok(!(await page.locator("body").innerText()).includes("0 个文件"));
  assert.equal(await page.locator(".gz-chapter-download").count(), 0);
  const paragraph = page.locator(".gz-book-description p");
  const collapsed = await paragraph.evaluate(node => ({ height: node.clientHeight, line: parseFloat(getComputedStyle(node).lineHeight) }));
  assert.ok(Math.abs(collapsed.height - collapsed.line * 3) < 2);
  await page.getByRole("button", { name: "展开简介", exact: true }).click();
  assert.ok(await paragraph.evaluate(node => node.clientHeight) > collapsed.height);
  await page.getByRole("button", { name: "收起简介", exact: true }).click();
  assert.equal(await paragraph.evaluate(node => node.clientHeight), collapsed.height);
  const source = await invoke("get_book_reading_source", { workId: work.id });
  const first = await invoke("get_book_source_entries", { ...source, group: "default", offset: 0, refresh: false });
  assert.equal(first.total, 214);
  assert.deepEqual(await chapterIds(), first.entries.map(entry => entry.id));
  await chapters.getByRole("button", { name: "章节第 3 页" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".gz-online-chapters [data-chapter-id]").length === 14);
  const last = await invoke("get_book_source_entries", { ...source, group: "default", offset: 200, refresh: false });
  assert.deepEqual(await chapterIds(), last.entries.map(entry => entry.id));
  await chapters.getByRole("button", { name: "当前顺序，切换倒序" }).click();
  const latest = await invoke("get_book_source_entries", { ...source, group: "default", offset: 114, refresh: false });
  await page.waitForFunction(id => document.querySelector(".gz-online-chapters [data-chapter-id]")?.dataset.chapterId === id, latest.entries.at(-1).id);
  assert.deepEqual(await chapterIds(), latest.entries.map(entry => entry.id).reverse());
  await chapters.getByRole("tab", { name: /单行本/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".gz-online-chapters [data-chapter-id]").length === 20);
  await chapters.getByRole("tab", { name: /其它汉化版/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".gz-online-chapters [data-chapter-id]").length === 1);
  await chapters.getByRole("tab", { name: /默认/ }).click();
  await chapters.getByRole("button", { name: "当前倒序，切换顺序" }).click();
  await page.waitForFunction(id => document.querySelector(".gz-online-chapters [data-chapter-id]")?.dataset.chapterId === id, first.entries[0].id);
  await page.getByRole("button", { name: "下载", exact: true }).click();
  for (let index = 0; index < 3; index++) await chapters.locator("[data-chapter-id]").nth(index).click();
  await chapters.getByRole("button", { name: "下载 3 话", exact: true }).waitFor();
  assert.equal(await chapters.locator('[aria-pressed="true"]').count(), 3);
  await page.screenshot({ path: `${output}/selection.png` });

  // These three sample chapters were already cached in the preceding actual UI check.
  const cached = await invoke("list_cached_book_content", { ...source, entryIds: first.entries.slice(0, 3).map(entry => entry.id) });
  assert.equal(cached.length, 3);
  await chapters.getByRole("button", { name: "下载 3 话", exact: true }).click();
  await page.getByRole("button", { name: "下载", exact: true }).waitFor();
  await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, emptyOutDir: false, lib: { entry: "scripts/fixtures/online-chapters.tsx", name: "ChapterFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
  await page.evaluate(() => {
    const frame = document.createElement("iframe"); frame.id = "qa-chapters";
    frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:99999;background:#101719;border:0";
    frame.srcdoc = '<html><body><div id="root"></div></body></html>'; document.body.append(frame);
  });
  const frame = await page.locator("#qa-chapters").contentFrame();
  await frame.locator("#root").waitFor({ state: "attached" });
  await frame.locator("body").evaluate((body, javascript) => { body.ownerDocument.defaultView.Function(javascript)(); }, readFileSync(`${output}/fixture/fixture.js`, "utf8"));
  for (let index = 0; index < 3; index++) await frame.locator("[data-chapter-id]").nth(index).click();
  await frame.getByRole("button", { name: "下载 3 话", exact: true }).click();
  await frame.getByRole("button", { name: "下载 2 话", exact: true }).waitFor();
  assert.equal(await frame.locator('[aria-pressed="true"]').count(), 2);
  assert.match(await frame.locator('p[role="status"]').innerText(), /失败.*保留选择/);
  await frame.getByRole("button", { name: "允许重试", exact: true }).click();
  await frame.getByRole("button", { name: "下载 2 话", exact: true }).click();
  await frame.locator('p[role="status"]').filter({ hasText: "已下载 2 话" }).waitFor();
  assert.equal(await frame.locator("output").innerText(), "qa-1,qa-2,qa-2,qa-3");
  await page.locator("#qa-chapters").evaluate(node => node.remove());

  // Real discovery navigation and shared cover animation, including a scrolled card.
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "发现", exact: true }).click();
  await page.getByRole("tab", { name: "漫画", exact: true }).click();
  await page.locator("[data-explore-cover-id]").first().waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__qaTransitions = [];
    const original = Document.prototype.startViewTransition.bind(document);
    document.startViewTransition = callback => {
      const record = { type: document.documentElement.dataset.trans, ready: false, error: null };
      window.__qaTransitions.push(record);
      const transition = original(callback);
      transition.ready.then(() => { record.ready = true; }, error => { record.error = String(error); });
      return transition;
    };
  });
  const card = page.locator(`[data-explore-cover-id="${source.pathWord}"]`).first().locator("..");
  await card.scrollIntoViewIfNeeded();
  const scrollBefore = await page.locator(".gz-scroll").evaluate(node => node.scrollTop);
  const expectedDetail = await invoke("get_comic_explore_detail", { pathWord: source.pathWord, refresh: false });
  await card.click();
  await page.locator(".gz-subject-title").filter({ hasText: "魔都精兵的奴隸" }).waitFor();
  await page.waitForTimeout(550);
  assert.equal(await page.locator(".gz-scroll").evaluate(node => node.scrollTop), 0);
  await chapters.locator("[data-chapter-id]").first().waitFor();
  await page.waitForFunction(summary => document.querySelector(".gz-book-description p")?.textContent === summary, expectedDetail.item.summary);
  const details = await page.locator(".gz-subject-stats").innerText();
  for (const label of [...expectedDetail.item.authors, ...expectedDetail.item.tags, expectedDetail.item.status]) assert.ok(details.includes(label));
  await page.getByRole("button", { name: "返回发现", exact: true }).click();
  await page.locator("[data-explore-cover-id]").first().waitFor();
  await page.waitForTimeout(550);
  assert.ok(Math.abs(await page.locator(".gz-scroll").evaluate(node => node.scrollTop) - scrollBefore) < 2);
  const transitions = await page.evaluate(() => window.__qaTransitions);
  assert.ok(transitions.filter(record => record.type === "morph" && record.ready && !record.error).length >= 2, JSON.stringify(transitions));
  await card.click();
  await chapters.locator("[data-chapter-id]").first().waitFor();
  await page.waitForFunction(summary => document.querySelector(".gz-book-description p")?.textContent === summary, expectedDetail.item.summary);
  await page.waitForTimeout(550);
  const layouts = [];
  const session = await page.context().newCDPSession(page);
  for (const width of [360, 412, 915]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width, height: width === 915 ? 412 : 915, deviceScaleFactor: 1, mobile: true });
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(layout.width, layout.scrollWidth); layouts.push(layout);
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.screenshot({ path: `${output}/detail.png` });
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(errors, []);
  const result = { date: new Date().toISOString(), preview: true, workCount: before.count, groups: [214, 20, 1], descriptionLines: 3, defaultPages: 3, globalDescending: true, cachedChapters: cached.length, downloadFailureFixture: true, cachedDetailPreserved: true, transitions, layouts, personalRecordsPreserved: true, errors };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  await page.evaluate(() => { document.getElementById("qa-chapters")?.remove(); delete document.startViewTransition; delete window.__qaTransitions; }).catch(() => {});
  await browser.close();
}
