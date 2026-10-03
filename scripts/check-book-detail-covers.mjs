// Synthetic books/images and IPC only; never opens a real book or library.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const output = "artifacts/book-detail-covers";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/qa/broken") return route.fulfill({ status: 404, body: "missing" });
      if (url.pathname.startsWith("/qa/")) return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#61776d"/><text x="10" y="90" fill="white">${url.pathname.slice(4)}</text></svg>` });
      return url.origin === base ? route.continue() : route.abort();
    });
    await page.addInitScript(() => {
      const now = "2026-10-03T00:00:00Z";
      window.isTauri = true;
      window.__bookCoverCalls = {};
      window.__bookChanged = false;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      const files = [1, 2, 3, 4].map(n => ({ id: `v${n}`, workId: "book", libraryRootId: "root", path: `C:/Books/${n}.epub`, fileName: `测试小说 ${n}.epub`, extension: "epub", mediaType: "novel", size: 1000, modifiedAt: now, missing: false, createdAt: now, updatedAt: now, recognitionStatus: "matched", parsedMediaInfo: "" }));
      const entries = files.map((file, i) => ({ id: file.id, title: `卷 ${i+1}`, fileName: file.fileName, volumeNumber: i+1, chapterNumber: null, mediaFileIds: [file.id], format: "epub", missing: false, readState: "unread", bangumiId: i < 2 ? String(i+1) : null, bangumiTitle: null, bangumiCoverPath: i === 0 ? "/qa/matched" : i === 1 ? "/qa/broken" : null }));
      const book = { id: "book", title: "卷册封面缓存测试", type: "novel", category: "novel", originalTitle: null, description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 4, missingCount: 0, createdAt: now, updatedAt: now, metadataStatus: "manually_created", metadataYear: null, mediaFiles: files, fieldLocks: [], candidates: [], subtitleLinks: [], metadata: null };
      const video = { ...book, id: "video", title: "导航切换测试", type: "video", category: "movie", mediaFiles: [] };
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" } }, convertFileSrc: path => path, transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
        if (command === "list_works") return [book, video];
        if (command === "get_work") return args.id === "video" ? video : { ...book, mediaFiles: files.map(file => file.id === "v3" && window.__bookChanged ? { ...file, size: 2000, modifiedAt: "2026-10-03T01:00:00Z" } : file) };
        if (command === "list_book_entries") return entries;
        if (command === "get_book_entry_order") return { mode: "asc", entryIds: [] };
        if (command === "get_embedded_book_metadata") {
          const id = args.mediaFileId;
          const count = window.__bookCoverCalls[id] = (window.__bookCoverCalls[id] || 0) + 1;
          if (id === "v4" && count === 1) throw Error("temporary book read failure");
          if (id === "v3") await new Promise(resolve => setTimeout(resolve, 150));
          return { title: id, creator: null, series: null, number: id.slice(1), description: null, isbn: null, coverPath: `/qa/local-${id}${id === "v3" && window.__bookChanged ? "-new" : ""}` };
        }
        if (command === "get_playback_progress") return { items: [], sessions: [] };
        if (command === "get_setting") return null;
        if (command.startsWith("list_")) return [];
        return null;
      } };
    });
    const row = n => page.locator(".book-entry").filter({ has: page.locator(".book-entry-main strong", { hasText: `卷 ${n}` }) });
    const cover = n => row(n).locator("img.book-entry-cover");
    const loaded = async (n, src) => { await row(n).scrollIntoViewIfNeeded(); return page.waitForFunction(({ n, src }) => {
      const rows = [...document.querySelectorAll(".book-entry")];
      const img = rows.find(row => row.querySelector(".book-entry-main strong")?.textContent === `卷 ${n}`)?.querySelector("img.book-entry-cover");
      return img?.getAttribute("src") === src && img.complete && img.naturalWidth > 0;
    }, { n, src }); };
    await page.goto(`${base}/#/library/book`, { waitUntil: "domcontentloaded" });
    await row(3).scrollIntoViewIfNeeded();
    await loaded(1, "/qa/matched");
    await loaded(3, "/qa/local-v3");
    const initialCalls = await page.evaluate(() => ({ ...window.__bookCoverCalls }));
    await page.getByRole("link", { name: "书架", exact: true }).click();
    await page.getByRole("link", { name: /卷册封面缓存测试/ }).first().click();
    await row(4).scrollIntoViewIfNeeded();
    await loaded(4, "/qa/local-v4");
    const repeatCalls = await page.evaluate(() => ({ ...window.__bookCoverCalls }));
    for (const id of ["v1", "v2", "v3"]) assert.equal(repeatCalls[id], initialCalls[id], `${id} must reuse completed metadata on re-entry`);
    assert.equal(repeatCalls.v4, 2, "failed metadata must be retried, not cached");
    await loaded(2, "/qa/local-v2");
    assert.equal(await page.locator('.nav-list a.active').getAttribute("data-nav-label"), "书架");
    assert.equal(await page.locator(".book-entry-cover").count(), 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    if (width === 1024) await page.screenshot({ path: `${output}/book-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "媒体库", exact: true }).click();
    await page.evaluate(() => { window.__bookChanged = true; });
    await page.getByRole("link", { name: "书架", exact: true }).click();
    await page.getByRole("link", { name: /卷册封面缓存测试/ }).first().click();
    await row(3).scrollIntoViewIfNeeded();
    await loaded(3, "/qa/local-v3-new");
    const changedCalls = await page.evaluate(() => ({ ...window.__bookCoverCalls }));
    assert.equal(changedCalls.v3, repeatCalls.v3 + 1);
    assert.equal(changedCalls.v1, repeatCalls.v1);
    assert.deepEqual(errors, []);
    console.log(`${width}x${height}: sidebar, warm covers, failed-read retry, image fallback and file-version invalidation passed`);
    await page.close();
  }
} finally { await browser.close(); }
