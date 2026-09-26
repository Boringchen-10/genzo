import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://asset.localhost/**", route => route.request().url().includes("missing")
    ? route.fulfill({ status: 404, body: "missing" })
    : route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#347a69"/></svg>' }));
  await page.addInitScript(() => {
    window.__calls = [];
    const files = [
      { id: "subtitle", fileName: "00.ass", mediaType: "other" },
      { id: "op", fileName: "00NCOP.mkv", mediaType: "video", parsedSpecialType: "NCOP" },
      { id: "m10", fileName: "10.mkv", mediaType: "video", parsedEpisodeStart: 10 },
      { id: "m1", fileName: "01.mkv", mediaType: "video", parsedEpisodeStart: 1 },
    ].map(file => ({ ...file, workId: "old", path: `D:/${file.fileName}`, missing: false, size: 1 }));
    const base = { type: "video", category: "anime", description: "", status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: files.length, missingCount: 0, metadataStatus: "matched", mediaFiles: files, fieldLocks: [], candidates: [], subtitleLinks: [] };
    const old = { ...base, id: "old", title: "旧作品刚更新", createdAt: "2025-01-01", updatedAt: "2026-12-01", coverPath: "C:/missing-cover.jpg", coverThumbnailPath: "C:/missing-thumb.jpg" };
    const fresh = { ...base, id: "new", title: "真正最近添加", createdAt: "2026-09-01", updatedAt: "2026-09-01", coverPath: "C:/valid-cover.jpg", coverThumbnailPath: "C:/missing-thumb.jpg" };
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      convertFileSrc: value => `http://asset.localhost/${encodeURIComponent(value)}`, transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === "get_playback_progress") return { items: [], sessions: [] };
        if (command === "launch_media") { window.__calls.push(args); return; }
        if (command === "get_work") return old;
        if (command === "list_works") return [old, fresh];
        if (command === "get_dashboard") return { totalWorks: 2, recentWorks: [old, fresh], favoriteWorks: [], lastScan: null };
        if (command.startsWith("list_")) return [];
        return null;
      },
    } });
  });
  const url = process.env.GENZO_TEST_URL || "http://127.0.0.1:4176";
  for (const [width, height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}/#/`);
    const cards = page.locator(".gnz-shelf-card");
    await cards.first().waitFor();
    assert.ok((await cards.first().innerText()).includes("真正最近添加"));
    await page.waitForFunction(() => { const image = document.querySelector(".gnz-shelf-card img"); return image?.complete && image.naturalWidth > 0; });
    assert.equal(await cards.first().locator("img").getAttribute("src"), "http://asset.localhost/C%3A%2Fvalid-cover.jpg");
    await cards.nth(1).locator(".media-placeholder").waitFor();
    assert.equal(await cards.nth(1).locator("img").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.goto(`${url}/#/library/old`);
    await page.locator(".detail-actions").getByRole("button", { name: "打开", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__calls.at(-1).mediaFileId), "m1");
    console.log(`${width}x${height}: episode one selected over subtitles/OP; created-time order; thumbnail/original fallback passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
