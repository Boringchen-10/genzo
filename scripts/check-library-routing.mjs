import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const root = { id: "root", path: "C:\\Resources", kind: "auto", enabled: true, createdAt: "t", updatedAt: "t", sourceType: "local" };
      const file = (id, name, type) => ({ id, workId: null, libraryRootId: "root", path: `C:\\Resources\\${name}`, fileName: name, extension: name.split(".").pop(), mediaType: type, size: 100, modifiedAt: null, missing: false, createdAt: "t", updatedAt: "t", recognitionStatus: "unmatched", parsedTitle: null, parsedOriginalTitle: null, parsedSeason: null, parsedEpisode: null, parsedEpisodeStart: null, parsedEpisodeEnd: null, parsedYear: null, parsedReleaseGroup: null, parsedSpecialType: null, parsedMediaInfo: "[]", lastRecognizedAt: null, recognitionError: null });
      const files = [file("video", "Show.mkv", "video"), file("book", "Book.cbz", "comic")];
      const groups = [
        { key: "video", destination: "media", title: "Show", folderPath: null, mediaType: "video", fileCount: 1, missingCount: 0, totalSize: 100, recognitionStatus: "unmatched", representative: files[0] },
        { key: "book", destination: "bookshelf", title: "Book", folderPath: null, mediaType: "comic", fileCount: 1, missingCount: 0, totalSize: 100, recognitionStatus: "unmatched", representative: files[1] },
      ];
      const work = (id, title, type) => ({ id, title, type, originalTitle: null, description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 1, missingCount: 0, createdAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z", metadataStatus: "manually_created", metadataYear: null, lastRecognizedAt: null });
      const works = [work("film", "Movie", "video"), work("comic", "Comic", "comic")];
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command === "list_works") return works;
          if (command === "list_library_roots") return [root];
          if (command === "list_unassigned_media_groups") return groups;
          if (command === "list_unassigned_media") return files.filter(file => !args.destination || groups.find(group => group.representative.id === file.id)?.destination === args.destination);
          if (command === "set_resource_group_destination") { groups.find(group => group.representative.id === args.mediaFileId).destination = args.destination; return null; }
          if (command === "list_book_import_groups") return groups.filter(group => group.destination === "bookshelf" && group.mediaType === "comic").map(group => ({ title: group.title, mediaType: "comic", folderPath: null, mediaFileIds: [group.representative.id] }));
          if (["list_scan_jobs", "list_scan_tasks", "list_remote_sources", "list_remote_cache"].includes(command)) return [];
          if (command === "get_setting") return "dark";
          return null;
        },
      } });
    });
    await page.goto(`${base}/#/resources`);
    await page.getByRole("heading", { name: "扫描文件分流" }).waitFor();
    await page.evaluate(() => { window.isTauri = true; });
    await page.getByRole("button", { name: "刷新列表" }).click();
    await page.getByRole("combobox", { name: "Book的待整理去向" }).selectOption("media");
    await page.getByRole("link", { name: "媒体库" }).click();
    await page.getByRole("tab", { name: /待整理/ }).click();
    await page.locator(".inbox-folder-link").first().click();
    await page.getByText("Book.cbz").first().waitFor();
    await page.getByRole("link", { name: "书架" }).click();
    await page.getByRole("tab", { name: /待整理/ }).click();
    await page.getByText("没有待整理的阅读文件").waitFor();
    await page.getByRole("link", { name: "资源库" }).click();
    await page.getByRole("combobox", { name: "Book的待整理去向" }).selectOption("bookshelf");
    await page.getByRole("link", { name: "书架" }).click();
    await page.getByRole("tab", { name: /待整理/ }).click();
    await page.getByText("Book.cbz").first().waitFor();
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.width, `${width} overflow: ${JSON.stringify(layout)}`);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}x${height}: resource routing, media inbox, bookshelf inbox passed`);
  }
} finally { await browser.close(); }
