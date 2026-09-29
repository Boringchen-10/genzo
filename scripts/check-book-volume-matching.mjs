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
      window.__volumeCalls = [];
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        metadata: { currentWindow: { label: "main" } },
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command === "get_work") return work;
          if (command === "list_works") return [work];
          if (command === "list_book_entries") return [{ ...entry }];
          if (command === "get_embedded_book_metadata") return { title: "第七卷", creator: null, series: null, number: "7", description: null, isbn: null, coverPath: cover };
          if (command === "search_book_volume_candidates") return [7, 8].map(number => ({ externalId: String(number), title: `败犬女主太多了! (${number})`, coverUrl: cover, volumeNumber: number, linkedToSeries: true, stale: false }));
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
    await page.getByRole("button", { name: "识别此卷" }).click();
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
    await page.getByRole("button", { name: "清除单册匹配" }).click();
    await page.getByRole("button", { name: "识别此卷" }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}x${height}: volume candidates, mismatch guard, cover and layout passed`);
  }
} finally { await browser.close(); }
