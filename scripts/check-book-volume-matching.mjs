import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const work = { id: "book", title: "败犬女主太多了", type: "novel", category: "novel", originalTitle: null, description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 1, missingCount: 0, createdAt: "t", updatedAt: "t", metadataStatus: "matched", metadataYear: null, lastRecognizedAt: null, mediaFiles: [], fieldLocks: [], candidates: [], subtitleLinks: [], metadata: null };
      const cover = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
      const entry = { id: "v7", title: "败犬女主太多了 -07", volumeNumber: 7, chapterNumber: null, mediaFileIds: ["v7"], format: "epub", missing: false, readState: "reading", bangumiId: null, bangumiTitle: null, bangumiCoverPath: null };
      const entry8 = { ...entry, id: "v8", title: "败犬女主太多了 -08", volumeNumber: 8, mediaFileIds: ["v8"], readState: "unread" };
      window.__volumeCalls = [];
      window.__removedVolumeIds = [];
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        metadata: { currentWindow: { label: "main" } },
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command === "get_work") return work;
          if (command === "list_works") return [work];
          if (command === "list_book_entries") return [entry, entry8].filter(item => !window.__removedVolumeIds.includes(item.id)).map(item => ({ ...item }));
          if (command === "save_book_entry") { [entry, entry8].find(item => item.id === args.entryId).readState = args.input.readState; return [entry, entry8].filter(item => !window.__removedVolumeIds.includes(item.id)).map(item => ({ ...item })); }
          if (command === "remove_book_entries") { window.__removedVolumeIds.push(...args.entryIds); return [entry, entry8].filter(item => !window.__removedVolumeIds.includes(item.id)).map(item => ({ ...item })); }
          if (command === "get_embedded_book_metadata") return { title: "第七卷", creator: null, series: null, number: "7", description: null, isbn: null, coverPath: cover };
          if (command === "search_book_volume_candidates") return [7, 8].map(number => ({ externalId: String(number), title: `败犬女主太多了! (${number})`, coverUrl: cover, volumeNumber: number, linkedToSeries: true, stale: false }));
          if (command === "preview_book_volume_batch") return { seriesId: "series", proposals: [entry, entry8].filter(item => !item.bangumiId).map(item => ({ entryId: item.id, entryTitle: item.title, volumeNumber: item.volumeNumber, candidate: { externalId: String(item.volumeNumber), title: `败犬女主太多了! (${item.volumeNumber})`, coverUrl: cover, volumeNumber: item.volumeNumber, linkedToSeries: true, stale: false } })), skipped: [] };
          if (command === "confirm_book_volume_batch") { window.__volumeCalls.push(args); for (const item of [entry, entry8]) { item.bangumiId = String(item.volumeNumber); item.bangumiTitle = `败犬女主太多了! (${item.volumeNumber})`; item.bangumiCoverPath = cover; } return { matched: 2, skipped: [] }; }
          if (command === "confirm_book_volume_candidate") { window.__volumeCalls.push(args); entry.bangumiId = args.externalId; entry.bangumiTitle = "败犬女主太多了! (7)"; entry.bangumiCoverPath = cover; return null; }
          if (command === "clear_book_volume_candidate") { entry.bangumiId = null; entry.bangumiTitle = null; entry.bangumiCoverPath = null; return null; }
          if (command === "get_setting") return "dark";
          if (command === "get_playback_progress") return { items: [], sessions: [] };
          if (command.startsWith("list_")) return [];
          return null;
        },
      } });
    });
    await page.goto(`${base}/#/library/book`);
    const volume7 = page.locator(".book-entry").filter({ hasText: "-07" });
    await volume7.getByRole("button", { name: /阅读中，标记为已读/ }).click();
    await volume7.getByRole("button", { name: /已读，标记为未读/ }).waitFor();
    await volume7.getByRole("button", { name: /已读，标记为未读/ }).click();
    await volume7.getByRole("button", { name: /未读，标记为已读/ }).waitFor();
    await volume7.locator("summary").click();
    if (process.env.GENZO_SCREENSHOT_DIR) {
      await mkdir(process.env.GENZO_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-actions-menu-${width}.png`), fullPage: true });
    }
    await volume7.getByRole("button", { name: "识别此卷" }).click();
    const candidates = page.locator(".book-volume-search .book-candidate");
    await candidates.first().waitFor();
    assert.equal(await candidates.count(), 2);
    assert.equal(await candidates.nth(1).getByRole("button", { name: "核对并关联" }).isDisabled(), true);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.width, `${width} detail overflow: ${JSON.stringify(layout)}`);
    if (process.env.GENZO_SCREENSHOT_DIR) {
      await mkdir(process.env.GENZO_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-volume-${width}.png`), fullPage: true });
    }
    await candidates.first().getByRole("button", { name: "核对并关联" }).click();
    await page.getByText("Bangumi 单册：败犬女主太多了! (7) · #7").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__volumeCalls.map(call => call.externalId)), ["7"]);
    await volume7.locator("summary").click();
    await volume7.getByRole("button", { name: "清除单册匹配" }).click();
    await volume7.locator("summary").click();
    await volume7.getByRole("button", { name: "识别此卷" }).waitFor();
    await volume7.locator("summary").click();
    await page.getByRole("button", { name: "批量识别卷册" }).click();
    await page.getByText("批量匹配预览 · 2 卷可关联，0 卷待核对").waitFor();
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width);
    if (process.env.GENZO_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-volume-batch-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "确认匹配 2 卷" }).click();
    await page.getByText("已匹配 2 卷；跳过 0 卷，可按需逐卷核对。").waitFor();
    await page.getByRole("button", { name: "多选" }).click();
    await page.getByRole("checkbox", { name: "选择败犬女主太多了 -07" }).check();
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width);
    if (process.env.GENZO_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-actions-select-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "删除所选" }).click();
    await page.getByText("磁盘上的原始书籍文件不会被删除、移动或修改", { exact: false }).waitFor();
    await page.getByRole("button", { name: "取消" }).last().click();
    assert.equal(await page.locator(".book-entry").count(), 2);
    await page.getByRole("button", { name: "全选" }).click();
    await page.getByRole("button", { name: "删除所选" }).click();
    await page.getByRole("button", { name: "确认移出" }).click();
    await page.getByText("这部作品还没有关联书籍文件。").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__removedVolumeIds), ["v7", "v8"]);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}x${height}: compact actions, reading toggle, matching, multi-select removal and layout passed`);
  }
} finally { await browser.close(); }
