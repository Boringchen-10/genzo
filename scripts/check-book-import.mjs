import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const root = { id: "books", path: "C:\\Books", kind: "comic", destination: "bookshelf", enabled: true, createdAt: "t", updatedAt: "t", sourceType: "local" };
      const files = ["01.cbz", "02.cbz"].map((name, index) => ({ id: "book-" + index, workId: null, libraryRootId: "books", path: "C:\\Books\\Series\\" + name, fileName: name, extension: "cbz", mediaType: "comic", size: 100, modifiedAt: null, missing: false, createdAt: "t", updatedAt: "t", recognitionStatus: "unmatched", parsedTitle: null, parsedOriginalTitle: null, parsedSeason: null, parsedEpisode: null, parsedEpisodeStart: null, parsedEpisodeEnd: null, parsedYear: null, parsedReleaseGroup: null, parsedSpecialType: null, parsedMediaInfo: "[]", lastRecognizedAt: null, recognitionError: null }));
      const group = { title: "Series", mediaType: "comic", folderPath: "C:\\Books\\Series", mediaFileIds: files.map(file => file.id), files: files.map(file => ({ id: file.id, path: file.path, fileName: file.fileName, extension: file.extension, missing: false })) };
      const unassigned = { key: "series", title: "Series", folderPath: "C:\\Books\\Series", mediaType: "comic", destination: "bookshelf", fileCount: 2, missingCount: 0, totalSize: 200, recognitionStatus: "unmatched", representative: files[0] };
      window.__bookImportCalls = [];
      window.isTauri = true;
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        metadata: { currentWindow: { label: "main" } },
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command === "list_works") return [];
          if (command === "list_library_roots") return [root];
          if (command === "list_unassigned_media_groups") return [unassigned];
          if (command === "list_book_import_groups") return [group];
          if (command === "get_embedded_book_metadata") return { title: "第一卷", creator: "作者", series: "本地系列", number: "1", description: null, isbn: null, coverPath: null };
          if (command === "search_book_import_candidates") return [{ externalId: "42", title: "网络系列", originalTitle: "Original Series", summary: "", coverUrl: null, category: "comic", series: true, confidence: 0.88, stale: false }];
          if (command === "create_book_work") { window.__bookImportCalls.push(args); return "created"; }
          if (command === "list_book_entries") return [];
          if (["list_scan_jobs", "list_scan_tasks", "list_remote_sources", "list_remote_cache"].includes(command)) return [];
          if (command === "get_setting") return "dark";
          return null;
        },
      } });
    });
    await page.goto(base + "/#/bookshelf?tab=inbox");
    if (await page.locator(".gnz-bookshelf-page").count()) {
      await page.locator(".inbox-folder-link").filter({ hasText: "Books" }).click();
      await page.locator(".inbox-folder-link").filter({ hasText: "Series" }).click();
    }
    await page.getByRole("button", { name: "识别并整理" }).click();
    await page.locator("#book-import[open]").waitFor();
    await page.getByText("本地系列").waitFor();
    await page.getByRole("checkbox").nth(1).uncheck();
    await page.getByRole("button", { name: "用作作品标题" }).click();
    assert.equal(await page.getByRole("textbox", { name: "新书架作品标题" }).inputValue(), "本地系列");
    await page.getByRole("button", { name: "搜索候选" }).click();
    await page.getByText("网络系列").waitFor();
    await page.getByRole("radio", { name: /网络系列/ }).check();
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.width, `${width} book import overflow: ${JSON.stringify(layout)}`);
    if (process.env.GENZO_SCREENSHOT_DIR) {
      await mkdir(process.env.GENZO_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-import-${width}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "确认匹配并建立" }).click();
    await page.waitForFunction(() => window.__bookImportCalls.length === 1);
    const [args] = await page.evaluate(() => window.__bookImportCalls);
    assert.deepEqual(args.mediaFileIds, ["book-0"]);
    assert.equal(args.title, "本地系列");
    assert.equal(args.externalId, "42");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}x${height}: book import preview, selection, match and layout passed`);
  }
} finally { await browser.close(); }
