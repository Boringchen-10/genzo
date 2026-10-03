// Public documentation screenshots: synthetic IPC, original SVG covers, no user data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const output = "docs/images/v0.5.0";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const now = "2026-10-03T00:00:00Z";
    const poster = (title, color, n) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="${color}"/><circle cx="300" cy="325" r="190" fill="#ffffff" fill-opacity=".12"/><path d="M0 620L200 390L420 650L600 450V900H0Z" fill="#000000" fill-opacity=".25"/><text x="42" y="80" font-family="sans-serif" font-size="26" fill="#ffffff" opacity=".7">GENZO / DEMO ${n}</text><text x="42" y="790" font-family="sans-serif" font-size="46" fill="#ffffff">${title}</text><text x="42" y="840" font-family="sans-serif" font-size="20" fill="#ffffff" opacity=".7">原创示例封面 · 无用户数据</text></svg>`);
    const categories = ["anime", "movie", "tv", "anime", "movie", "anime", "comic", "novel", "comic", "novel", "comic"];
    const titles = ["星际旅途", "远山来信", "城市日记", "夏日回声", "海边的灯塔", "晨光序曲", "纸上星河", "旅途笔记", "林间故事", "昨日来信", "漫游画集"];
    const colors = ["#3c5968", "#6b5952", "#485f58", "#73745a", "#456271", "#5a5067"];
    const works = titles.map((title, i) => ({ id: `w${i}`, title, originalTitle: null, type: i < 6 ? "video" : categories[i], category: categories[i], description: "这是一部用于展示 Genzo 界面的示例作品。作品信息、封面和文件均为合成数据。", coverPath: poster(title, colors[i % colors.length], i + 1), bannerPath: null, status: i % 3 === 0 ? "in_progress" : "planned", favorite: i % 2 === 0, rating: i === 0 ? 8 : null, notes: "", tags: i === 10 ? ["画集"] : [], mediaCount: i < 6 ? 12 : 3, missingCount: 0, createdAt: now, updatedAt: now, metadataStatus: "manually_created", metadataYear: 2026 }));
    const files = [1, 2, 3].map(n => ({ id: `b${n}`, workId: "w6", libraryRootId: "books", path: `C:/Genzo-Demo/Books/纸上星河 第${n}卷.cbz`, fileName: `纸上星河 第${n}卷.cbz`, extension: "cbz", mediaType: "comic", size: 1000, modifiedAt: now, missing: false, createdAt: now, updatedAt: now, recognitionStatus: "matched", parsedMediaInfo: "[]" }));
    const entries = files.map((f, i) => ({ id: f.id, title: `纸上星河 · 第 ${i + 1} 卷`, fileName: f.fileName, volumeNumber: i + 1, chapterNumber: null, mediaFileIds: [f.id], format: "cbz", missing: false, readState: i === 0 ? "read" : "unread", bangumiId: null, bangumiTitle: null, bangumiCoverPath: null }));
    const roots = [{ id: "media", path: "C:/Genzo-Demo/Media", kind: "video", destination: "media", enabled: true, sourceType: "local", availability: "available", lastScannedAt: now, createdAt: now, updatedAt: now }, { id: "books", path: "C:/Genzo-Demo/Books", kind: "comic", destination: "bookshelf", enabled: true, sourceType: "local", availability: "available", lastScannedAt: now, createdAt: now, updatedAt: now }];
    localStorage.setItem("genzo-preferences", JSON.stringify({ state: { theme: "dark", libraryView: "grid" }, version: 0 }));
    window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } }, convertFileSrc: p => p, transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command === "list_works") return works;
        if (command === "get_work") return { ...works.find(w => w.id === args.id), mediaFiles: args.id === "w6" ? files : [], metadata: null, fieldLocks: [], candidates: [], subtitleLinks: [], networkScore: null };
        if (command === "list_book_entries") return entries;
        if (command === "get_book_entry_order") return { mode: "asc", entryIds: [] };
        if (command === "get_embedded_book_metadata") return { title: "纸上星河", number: args.mediaFileId.slice(1), creator: "示例作者", coverPath: works[6].coverPath };
        if (command === "list_library_roots") return roots;
        if (command === "get_playback_progress") return { items: [], sessions: [] };
        if (command === "get_dashboard") return { totalWorks: works.length, videoCount: 6, comicCount: 3, novelCount: 2, gameCount: 0, otherCount: 0, favoriteCount: 6, missingFileCount: 0, recentWorks: works, favoriteWorks: works.filter(w => w.favorite), lastScan: null };
        if (command === "get_app_info") return { version: "0.5.0", dataDirectory: "示例数据目录", databasePath: "示例数据库", coverCachePath: "示例缓存" };
        if (command === "get_setting" || command.startsWith("plugin:")) return null;
        if (command.startsWith("list_")) return [];
        return null;
      },
    };
  });
  for (const [name, route, selector] of [["media-library", "library", ".work-card"], ["bookshelf", "bookshelf", ".gnz-shelf-card"], ["book-detail", "bookshelf/w6", ".book-entry"], ["resources", "sources", ".root-row"]]) {
    await page.goto(`${base}/?screenshot=${name}#/${route}`, { waitUntil: "domcontentloaded" });
    await page.locator(selector).first().waitFor();
    await page.waitForFunction(() => [...document.images].every(img => img.complete));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.screenshot({ path: `${output}/${name}.png` });
    console.log(`Captured ${name} using synthetic data`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
