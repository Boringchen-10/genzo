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
      const root = { id: "books", path: "C:\\Books", displayName: "Books", kind: "novel", destination: "bookshelf", enabled: true, createdAt: "t", updatedAt: "t", sourceType: "local" };
      const path = "C:\\Books\\败犬女主太多了";
      const names = ["败犬女主太多了 -01.epub", "败犬女主太多了 -02.epub", "败犬女主太多了 -08.epub", "另一部作品 -01.epub"];
      const paths = [path + "\\正文\\日文\\" + names[0], path + "\\正文\\日文\\" + names[1], path + "\\第八卷\\" + names[2], "C:\\Books\\另一部作品\\" + names[3]];
      const files = names.map((name, index) => ({ id: "book-" + index, workId: null, libraryRootId: "books", path: paths[index], fileName: name, extension: "epub", mediaType: "novel", size: 100, modifiedAt: null, missing: false, createdAt: "t", updatedAt: "t", recognitionStatus: "unmatched", parsedTitle: null, parsedOriginalTitle: null, parsedSeason: null, parsedEpisode: null, parsedEpisodeStart: null, parsedEpisodeEnd: null, parsedYear: null, parsedReleaseGroup: null, parsedSpecialType: null, parsedMediaInfo: "[]", lastRecognizedAt: null, recognitionError: null }));
      const groups = [files.slice(0, 2), files.slice(2, 3), files.slice(3)].map(members => ({ title: members[0].fileName.replace(/ -\d+\.epub$/, ""), mediaType: "novel", folderPath: members[0].path.slice(0, members[0].path.lastIndexOf("\\")), mediaFileIds: members.map(file => file.id), files: members.map(file => ({ id: file.id, path: file.path, fileName: file.fileName, extension: file.extension, missing: false, volumeNumber: Number(file.fileName.match(/-(\d+)\.epub$/)[1]) })) }));
      window.__bookImportCalls = [];
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        metadata: { currentWindow: { label: "main" } },
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command === "list_works") return [];
          if (command === "list_library_roots") return [root];
          if (command === "list_unassigned_media") return files;
          if (command === "list_unassigned_media_groups") return [];
          if (command === "list_book_import_groups") return groups;
          if (command === "get_embedded_book_metadata") return { title: "卷册", creator: "作者", series: "败犬女主太多了", number: String(Number(args.mediaFileId.split("-")[1]) + 1), description: null, isbn: null, coverPath: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" };
          if (command === "create_book_work") { window.__bookImportCalls.push(args); return "created"; }
          if (command === "get_setting") return "dark";
          return [];
        },
      } });
    });
    await page.goto(base + "/#/bookshelf?tab=inbox");
    await page.locator(".book-inbox-folder").filter({ hasText: "Books" }).click();
    await page.locator(".book-inbox-folder").filter({ hasText: "败犬女主太多了" }).click();
    await page.getByRole("button", { name: "识别当前目录" }).click();
    await page.getByText("归档文件 · 3/3").waitFor();
    await page.getByText("第 1 卷（文件名）").waitFor();
    assert.equal(await page.locator(".book-import-volume-cover").count(), 3);
    await page.locator(".book-import-files label").filter({ hasText: "-08.epub" }).getByRole("checkbox").click();
    await page.getByText("归档文件 · 2/2").waitFor();
    await page.getByRole("button", { name: /归档整套/ }).click();
    await page.getByText("归档文件 · 2/2").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "新书架作品标题" }).inputValue(), "败犬女主太多了");
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.width, `${width} inbox overflow: ${JSON.stringify(layout)}`);
    if (process.env.GENZO_SCREENSHOT_DIR) {
      await mkdir(process.env.GENZO_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-inbox-${width}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "手动建立作品" }).click();
    await page.waitForFunction(() => window.__bookImportCalls.length === 1);
    const [args] = await page.evaluate(() => window.__bookImportCalls);
    assert.deepEqual(new Set(args.mediaFileIds), new Set(["book-0", "book-1"]));
    assert.equal(args.coverMediaFileId === "book-0" || args.coverMediaFileId === "book-1", true);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}x${height}: nested folder selection, per-volume covers and layout passed`);
  }
} finally { await browser.close(); }
