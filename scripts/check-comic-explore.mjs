// Production UI with synthetic metadata/IPC. No accounts, user library or real media.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const output = "artifacts/comic-explore";
await mkdir(output, { recursive: true });
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
assert.match(config.app.security.csp, /https:\/\/\*\.mangafunb\.fun/);
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
let activePage;
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: process.env.GENZO_TEST_DARK === "1" ? "dark" : "light" });
    activePage = page;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/qa/missing") return route.fulfill({ status: 404, body: "missing" });
      if (url.pathname.startsWith("/qa/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#61776d"/><text x="20" y="140" fill="white">Comic metadata</text></svg>' });
      return url.origin === base ? route.continue() : route.abort();
    });
    await page.addInitScript(() => {
      const now = "2026-10-03T00:00:00Z";
      window.isTauri = true;
      window.__comicCalls = [];
      window.__comicFailure = false;
      window.__comicExpandFailure = false;
      window.__comicExpandDelay = false;
      window.__comicDetailFailure = false;
      window.__comicSaveFailure = true;
      window.__comicSaved = false;
      window.__comicStale = false;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      const item = id => ({ pathWord: id, title: id === "short" ? "测试短篇漫画" : `长标题漫画与番外 ${id} 这是一段用于检查换行的作品名`, coverUrl: id === "comic-2" ? "/qa/missing" : "/qa/cover", authors: ["测试作者"], tags: ["日常"], summary: "短篇作品简介。\n第二段简介。", status: "已完结", updatedAt: "2026-10-03", latestChapter: "终话", localWorkId: id === "short" && window.__comicSaved ? "comic-book" : null, favorite: id === "short" && window.__comicSaved });
      const work = () => ({ id: "comic-book", title: "测试短篇漫画", type: "comic", category: "comic", originalTitle: null, description: "短篇作品简介。", coverPath: "/qa/cover", status: "planned", favorite: true, rating: null, notes: "个人阅读记录", tags: ["日常"], mediaCount: 0, missingCount: 0, createdAt: now, updatedAt: now, metadataStatus: "matched", metadataYear: null, mediaFiles: [], fieldLocks: [], candidates: [], subtitleLinks: [], metadata: { provider: "copymanga", externalId: "short", title: "测试短篇漫画", originalTitle: null, year: null, coverUrl: "/qa/cover", fetchedAt: now } });
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" } }, convertFileSrc: path => path, transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
        window.__comicCalls.push({ command, args });
        if (command === "list_comic_explore") {
          if (window.__comicFailure) throw Error("来源暂时不可用");
          const input = args.input;
          if (input.page > 1 && window.__comicExpandFailure) throw Error("展开失败，请重试");
          if (input.page > 1 && window.__comicExpandDelay) await new Promise(resolve => setTimeout(resolve, 800));
          if (input.query === "慢查询") await new Promise(resolve => setTimeout(resolve, 800));
          return { items: input.query ? [item(input.query === "慢查询" ? "old" : "short")] : Array.from({ length: Math.min(24, 60 - (input.page - 1) * 24) }, (_, i) => item(`comic-${(input.page-1)*24+i}`)), total: input.query ? 1 : 60, page: input.page, stale: window.__comicStale };
        }
        if (command === "get_comic_explore_themes") return [{ name: "日常", pathWord: "richang" }, { name: "冒险", pathWord: "maoxian" }];
        if (command === "get_comic_explore_detail") {
          if (window.__comicDetailFailure) throw Error("没有有效作品资料");
          return { item: item(args.pathWord), aliases: ["Test one shot"], chapterCount: 1, stale: window.__comicStale };
        }
        if (command === "save_comic_explore_work") {
          if (window.__comicSaveFailure) { window.__comicSaveFailure = false; throw Error("本次加入失败，请重试"); }
          window.__comicSaved = true; return "comic-book";
        }
        if (command === "get_work") return work();
        if (command === "list_works") return window.__comicSaved ? [work()] : [];
        if (command === "get_book_entry_order") return { mode: "asc", entryIds: [] };
        if (command === "get_playback_progress") return { items: [], sessions: [] };
        if (command === "search_book_candidates") return [{ externalId: "123", title: "测试短篇漫画", originalTitle: null, summary: "Bangumi 候选简介", coverUrl: "/qa/cover", category: "comic", series: false, confidence: 1, stale: false }];
        if (command === "get_app_info") return { name: "Genzo", version: "0.4.4", dataDirectory: "qa", databasePath: "qa" };
        if (command === "get_explore_overview") return { year: 2026, month: 10, seasonal: [], trending: [], availableTags: [], sources: [{ key: "bangumi", label: "Bangumi", available: true, stale: false, fetchedAt: now, warning: null }], fetchedAt: now, stale: false };
        if (command.startsWith("plugin:")) return null;
        return [];
      }};
    });
    await page.goto(`${base}/#/explore?type=comic`, { waitUntil: "domcontentloaded" });
    const cards = page.locator(".comic-explore-card");
    await cards.first().waitFor();
    assert.equal(await cards.count(), 24);
    assert.equal(await page.getByRole("tab", { name: "漫画", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.evaluate(() => window.__comicCalls.some(call => call.command === "get_explore_overview")), false);
    await page.getByLabel("漫画目录").selectOption("finish");
    await page.getByLabel("漫画题材").selectOption("richang");
    await page.getByLabel("漫画排序").selectOption("updated");
    await page.waitForFunction(() => window.__comicCalls.some(call => call.command === "list_comic_explore" && call.args.input.sort === "updated"));
    const more = page.getByRole("button", { name: /展开更多作品/ });
    assert.equal(await page.getByRole("button", { name: /上一页|下一页/ }).count(), 0);
    await page.evaluate(() => { window.__comicExpandFailure = true; });
    await more.click();
    await page.getByText("展开失败，请重试", { exact: true }).waitFor();
    assert.equal(await cards.count(), 24);
    await page.evaluate(() => { window.__comicExpandFailure = false; });
    await page.getByRole("button", { name: "重试展开", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".comic-explore-card").length === 48);
    assert.match(await cards.first().innerText(), /comic-0/);
    assert.match(await cards.nth(24).innerText(), /comic-24/);
    assert.doesNotMatch(await page.url(), /page=/);
    await cards.nth(24).scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    const scroll = await page.locator(".main-content").evaluate(element => element.scrollTop);
    await page.evaluate(value => { window.__comicExpectedScroll = value; }, scroll);
    await cards.nth(24).click();
    const detailView = page.locator(".comic-explore-detail-page");
    await detailView.getByText("1 话", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await cards.count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.screenshot({ path: `${output}/detail-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "返回探索", exact: true }).click();
    await detailView.waitFor({ state: "hidden" });
    assert.equal(await cards.count(), 48);
    assert.equal(await page.getByLabel("漫画目录").inputValue(), "finish");
    assert.equal(await page.getByLabel("漫画题材").inputValue(), "richang");
    await page.waitForFunction(expected => Math.abs(document.querySelector(".main-content").scrollTop - expected) < 3, scroll);
    await page.goForward();
    await detailView.getByText("1 话", { exact: true }).waitFor();
    await page.goBack();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 48);
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll(".comic-explore-card").length === 60);
    assert.equal(await more.count(), 0);
    await page.screenshot({ path: `${output}/expanded-${width}.png`, fullPage: true });
    // A late expansion cannot append into another filter's list.
    await page.getByLabel("漫画题材").selectOption("maoxian");
    await page.waitForFunction(() => document.querySelectorAll(".comic-explore-card").length === 24);
    await page.evaluate(() => { window.__comicExpandDelay = true; });
    await more.click();
    await page.getByLabel("漫画题材").selectOption("richang");
    await page.waitForFunction(() => document.querySelectorAll(".comic-explore-card").length === 60);
    await page.waitForTimeout(950);
    assert.equal(await cards.count(), 60);
    await page.evaluate(() => { window.__comicExpandDelay = false; });
    // Reversed network completion must not put the old query back on screen.
    await page.getByLabel("搜索漫画作品").fill("慢查询");
    await page.getByLabel("搜索漫画作品").press("Enter");
    await page.getByLabel("搜索漫画作品").fill("短篇 & 猫");
    await page.getByLabel("搜索漫画作品").press("Enter");
    await page.getByRole("button", { name: "查看漫画 测试短篇漫画", exact: true }).waitFor();
    await page.waitForTimeout(950);
    assert.equal(await cards.count(), 1);
    assert.equal(await page.getByLabel("漫画题材").isDisabled(), true);
    assert.equal(await page.getByLabel("漫画目录").inputValue(), "");
    await page.evaluate(() => { window.__comicDetailFailure = true; });
    await cards.first().click();
    await detailView.getByText("没有有效作品资料", { exact: true }).waitFor();
    await page.evaluate(() => { window.__comicDetailFailure = false; });
    await detailView.getByRole("button", { name: "重试", exact: true }).click();
    await detailView.getByRole("button", { name: "收藏到书架", exact: true }).click();
    await detailView.getByText("本次加入失败，请重试", { exact: true }).waitFor();
    await detailView.getByRole("button", { name: "收藏到书架", exact: true }).click();
    await detailView.getByRole("link", { name: "打开书架详情", exact: true }).click();
    await page.getByRole("heading", { name: "测试短篇漫画", exact: true }).waitFor();
    assert.match(await page.url(), /bookshelf\/comic-book/);
    assert.equal(await page.locator(".nav-list a.active").getAttribute("data-nav-label"), "书架");
    await page.getByRole("button", { name: "搜索候选", exact: true }).click();
    await page.getByText("Bangumi 候选简介", { exact: true }).waitFor();
    await page.getByRole("link", { name: "查看来源资料", exact: true }).click();
    await detailView.getByRole("link", { name: "打开书架详情", exact: true }).waitFor();
    await page.getByRole("button", { name: "返回探索", exact: true }).click();
    await page.getByRole("heading", { name: "测试短篇漫画", exact: true }).waitFor();
    assert.match(await page.url(), /bookshelf\/comic-book/);
    assert.equal(await page.evaluate(() => window.__comicCalls.filter(call => call.command === "save_comic_explore_work").length), 2);
    await page.goBack();
    await detailView.getByRole("link", { name: "打开书架详情", exact: true }).waitFor();
    await page.goBack();
    await detailView.waitFor({ state: "hidden" });
    assert.match(await page.url(), /q=/);
    await page.goBack();
    await page.goBack();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 60);
    await page.goForward();
    await page.goForward();
    await page.getByRole("button", { name: "查看漫画 测试短篇漫画", exact: true }).waitFor();
    await page.evaluate(() => { window.__comicFailure = true; });
    await page.getByRole("button", { name: "刷新漫画探索", exact: true }).click();
    await page.getByText("来源暂时不可用", { exact: true }).waitFor();
    assert.equal(await cards.count(), 1);
    await page.evaluate(() => { window.__comicFailure = false; window.__comicStale = true; });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByText("来源暂时不可用，当前显示上次缓存的资料。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清除漫画搜索", exact: true }).click();
    await cards.nth(2).locator(".comic-cover-placeholder").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/list-${width}.png`, fullPage: true });
    await page.getByRole("tab", { name: "动漫", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "动漫");
    await page.getByRole("tab", { name: "推荐", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "推荐");
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "动漫");
    await page.getByRole("tab", { name: "漫画", exact: true }).click();
    await cards.first().waitFor();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "动漫");
    await page.goto(`${base}/?qa=direct#/explore?type=comic&comic=short`, { waitUntil: "domcontentloaded" });
    await detailView.getByRole("heading", { name: "测试短篇漫画", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__comicCalls.some(call => call.command === "list_comic_explore")), false);
    await page.evaluate(() => { window.__comicFailure = true; });
    await page.getByRole("button", { name: "返回探索", exact: true }).click();
    await page.getByText("来源暂时不可用", { exact: true }).waitFor();
    assert.doesNotMatch(await page.url(), /comic=short/);
    await page.evaluate(() => { window.__comicFailure = false; });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 24);
    assert.deepEqual(errors, []);
    console.log(`${width}x${height}: filters, append/retry/end, detail page, expanded-list/scroll back, filter/query races, metadata/save retry, shelf/Bangumi entry, cached data, missing cover and comic/anime browser back passed`);
    await page.close();
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    console.error(await activePage.evaluate(() => ({ url: location.hash, cards: document.querySelectorAll(".comic-explore-card").length, scroll: document.querySelector(".main-content").scrollTop, expectedScroll: window.__comicExpectedScroll, text: document.body.innerText.slice(-900), calls: window.__comicCalls.slice(-12) })));
  }
  throw error;
} finally { await browser.close(); }
