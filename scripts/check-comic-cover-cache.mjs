// Synthetic IPC/disk cache: no accounts, real library or chapter resources.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const output = "artifacts/comic-cover-cache";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
let activePage;
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 4, colorScheme: process.env.GENZO_TEST_DARK === "1" ? "dark" : "light" });
    activePage = page;
    const requests = [];
    const errors = [];
    let broken = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/qa/")) {
        requests.push(url.href);
        if (broken && url.pathname.startsWith("/qa/cache/comic-0/1/") && await page.evaluate(() => (JSON.parse(sessionStorage.getItem("qa-covers"))["comic-0"]?.version || 0) < 2)) return route.fulfill({ status: 404, body: "evicted" });
        return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#61776d"/><text x="60" y="560" font-size="48" fill="white">Cached cover</text></svg>' });
      }
      return url.origin === base ? route.continue() : route.abort();
    });
    await page.addInitScript(() => {
      window.isTauri = true;
      window.__comicCalls = [];
      window.__coverDownloads = [];
      window.__coverFail = sessionStorage.getItem("qa-ready") !== "1";
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => sessionStorage.getItem("qa-offline") !== "1" });
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      const disk = JSON.parse(sessionStorage.getItem("qa-covers") || "{}");
      const item = id => ({ pathWord: id, title: `缓存测试 ${id}`, coverUrl: `https://sm.mangafunb.fun/qa/remote/${id}.jpg`, cachedCoverPath: disk[id]?.coverPath, cachedCoverThumbnailPath: disk[id]?.thumbnailPath, authors: ["测试作者"], tags: ["日常"], summary: "封面缓存回归测试", status: "已完结", updatedAt: "2026-10-03", latestChapter: "终话", localWorkId: null, favorite: false });
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" } }, convertFileSrc: path => path, transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
        window.__comicCalls.push({ command, args });
        if (command === "list_comic_explore") return { items: Array.from({ length: 24 }, (_, i) => item(`comic-${i}`)), total: 24, page: 1, stale: false };
        if (command === "get_comic_explore_themes") return [];
        if (command === "get_comic_explore_detail") return { item: item(args.pathWord), aliases: [], chapterCount: 1, stale: false };
        if (command === "cache_comic_explore_cover") {
          if (!navigator.onLine) throw Error("offline");
          if (args.pathWord === "comic-1" && window.__coverFail) throw Error("temporary image failure");
          if (disk[args.pathWord] && !args.refresh) return disk[args.pathWord];
          await new Promise(resolve => setTimeout(resolve, 60));
          window.__coverDownloads.push(args.pathWord);
          const version = (disk[args.pathWord]?.version || 0) + 1;
          const result = { coverPath: `/qa/cache/${args.pathWord}/1/original.jpg`, thumbnailPath: `/qa/cache/${args.pathWord}/1/thumb.jpg`, version };
          disk[args.pathWord] = result;
          sessionStorage.setItem("qa-covers", JSON.stringify(disk));
          return result;
        }
        if (command.startsWith("plugin:")) return null;
        return [];
      }};
    });
    const cover = id => page.locator(".comic-explore-card").filter({ hasText: `缓存测试 ${id}` }).first().locator("img");
    await page.goto(`${base}/#/explore?type=comic`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/cache/comic-0/"]')?.naturalWidth > 0);
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/remote/comic-1.jpg"]')?.naturalWidth > 0);
    const firstCalls = await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover"));
    assert.ok(firstCalls.length > 1 && firstCalls.length < 24, "only visible/nearby covers should request caching");
    assert.equal(requests.filter(url => url.includes("/qa/remote/comic-0.jpg")).length, 0, "healthy cover must not also download through browser");
    assert.ok(await cover("comic-0").getAttribute("src"));
    await page.evaluate(() => { window.__coverFail = false; sessionStorage.setItem("qa-ready", "1"); window.dispatchEvent(new Event("online")); });
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/cache/comic-1/"]')?.naturalWidth > 0);
    assert.equal(await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover" && call.args.pathWord === "comic-1" && call.args.refresh).length), 1);
    assert.equal(await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover" && call.args.pathWord === "comic-0").length), 1, "online must not re-fetch valid covers");
    await page.getByRole("button", { name: "查看漫画 缓存测试 comic-0", exact: true }).click();
    const detail = page.locator(".comic-explore-cover.is-detail");
    await detail.locator("img").waitFor();
    await page.waitForFunction(() => document.querySelector(".comic-explore-cover.is-detail img")?.naturalWidth > 0);
    const dimensions = await detail.evaluate(element => ({ width: element.getBoundingClientRect().width * devicePixelRatio, height: element.getBoundingClientRect().height * devicePixelRatio }));
    assert.match(await detail.locator("img").getAttribute("src"), dimensions.width > 600 || dimensions.height > 900 ? /original.jpg$/ : /thumb.jpg$/);
    assert.equal(await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover" && call.args.pathWord === "comic-0").length), 1, "list/detail reuse same completed request");
    await page.getByRole("button", { name: "返回探索", exact: true }).click();
    await cover("comic-0").waitFor();
    assert.equal(await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover" && call.args.pathWord === "comic-0").length), 1);
    broken = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/remote/comic-0.jpg"]')?.naturalWidth > 0);
    const healthyBefore = await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover" && call.args.pathWord === "comic-1").length);
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/cache/comic-1/"]')?.naturalWidth > 0);
    const healthyRequests = requests.filter(url => url.includes("/qa/cache/comic-1/")).length;
    await page.getByRole("button", { name: "重试图片", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/cache/comic-0/1/"]')?.naturalWidth > 0);
    assert.equal(await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover" && call.args.pathWord === "comic-0" && call.args.refresh).length), 1);
    assert.equal(await page.evaluate(() => window.__comicCalls.filter(call => call.command === "cache_comic_explore_cover" && call.args.pathWord === "comic-1").length), healthyBefore);
    assert.equal(requests.filter(url => url.includes("/qa/cache/comic-1/")).length, healthyRequests, "retry must not reload a healthy image asset");
    await page.evaluate(() => sessionStorage.setItem("qa-offline", "1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/cache/comic-0/1/"]')?.naturalWidth > 0);
    assert.equal(await page.evaluate(() => window.__comicCalls.some(call => call.command === "cache_comic_explore_cover")), false, "offline uses cached paths without network commands");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.screenshot({ path: `${output}/offline-${width}.png` });
    await page.evaluate(() => { sessionStorage.removeItem("qa-offline"); const cache = JSON.parse(sessionStorage.getItem("qa-covers")); delete cache["comic-0"]; sessionStorage.setItem("qa-covers", JSON.stringify(cache)); });
    broken = false;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('.comic-explore-card img[src*="/qa/cache/comic-0/1/"]')?.naturalWidth > 0);
    assert.deepEqual(await page.evaluate(() => window.__coverDownloads), ["comic-0"], "only the evicted cover should download again");
    assert.deepEqual(errors, []);
    console.log(`${width}x${height} DPR4: visible-only caching, no duplicate browser download, detail/list reuse, size selection, failure recovery, corrupt-cache fallback/retry, offline/reload and eviction passed`);
    await page.close();
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png` });
    console.error(await activePage.evaluate(() => ({ url: location.hash, images: [...document.images].map(image => ({ src: image.src, complete: image.complete, width: image.naturalWidth })), calls: window.__comicCalls?.slice(-12) })));
  }
  throw error;
} finally { await browser.close(); }
