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
      const roots = [
        { id: "media", path: "C:\\Media", kind: "auto", destination: "media", enabled: true, createdAt: "t", updatedAt: "t", sourceType: "local" },
        { id: "books", path: "C:\\Books", kind: "comic", destination: "bookshelf", enabled: true, createdAt: "t", updatedAt: "t", sourceType: "local" },
      ];
      const file = (id, rootId, name, type) => ({ id, workId: null, libraryRootId: rootId, path: `C:\\${rootId === "books" ? "Books" : "Media"}\\${name}`, fileName: name, extension: name.split(".").pop(), mediaType: type, size: 100, modifiedAt: null, missing: false, createdAt: "t", updatedAt: "t", recognitionStatus: "unmatched", parsedTitle: null, parsedOriginalTitle: null, parsedSeason: null, parsedEpisode: null, parsedEpisodeStart: null, parsedEpisodeEnd: null, parsedYear: null, parsedReleaseGroup: null, parsedSpecialType: null, parsedMediaInfo: "[]", lastRecognizedAt: null, recognitionError: null });
      const files = [file("video", "media", "Show.mkv", "video"), file("book", "books", "Book.cbz", "comic")];
      const groups = files.map(file => ({ key: file.id, title: file.fileName.split(".")[0], folderPath: null, mediaType: file.mediaType, fileCount: 1, missingCount: 0, totalSize: 100, recognitionStatus: "unmatched", representative: file }));
      const work = (id, title, type) => ({ id, title, type, originalTitle: null, description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 1, missingCount: 0, createdAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z", metadataStatus: "manually_created", metadataYear: null, lastRecognizedAt: null });
      const works = [work("film", "Movie", "video"), work("comic", "Comic", "comic")];
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command === "list_works") return works;
          if (command === "list_library_roots") return roots;
          if (command === "list_unassigned_media_groups") return groups.map(group => ({ ...group, destination: roots.find(root => root.id === group.representative.libraryRootId).destination }));
          if (command === "list_unassigned_media") return files.filter(file => !args.destination || roots.find(root => root.id === file.libraryRootId).destination === args.destination);
          if (command === "set_root_destination") { roots.find(root => root.id === args.id).destination = args.destination; return null; }
          if (["list_scan_jobs", "list_scan_tasks", "list_remote_sources", "list_remote_cache"].includes(command)) return [];
          if (command === "get_setting") return "dark";
          return null;
        },
      } });
    });
    const noOverflow = async label => {
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert.ok(layout.scrollWidth <= layout.width, `${width} ${label} overflow: ${JSON.stringify(layout)}`);
    };
    await page.goto(`${base}/#/sources`);
    await page.getByRole("combobox", { name: "C:\\Books的归属" }).selectOption("media");
    await noOverflow("resources");
    await page.getByRole("link", { name: "媒体库" }).click();
    await page.getByRole("tab", { name: /待整理/ }).click();
    await page.locator(".inbox-folder-link").filter({ hasText: "Books" }).first().click();
    await page.getByText("Book.cbz").first().waitFor();
    await noOverflow("media inbox");
    await page.getByRole("link", { name: "书架" }).click();
    await page.getByRole("tab", { name: /待整理/ }).click();
    const detailedShelf = await page.locator(".gnz-bookshelf-page").count() > 0;
    if (detailedShelf) await page.getByText("0 个待整理阅读物组").waitFor();
    else await page.getByText("没有待整理的阅读文件").waitFor();
    await page.getByRole("link", { name: "资源库" }).click();
    await page.getByRole("combobox", { name: "C:\\Books的归属" }).selectOption("bookshelf");
    await page.getByRole("link", { name: "书架" }).click();
    await page.getByRole("tab", { name: /待整理/ }).click();
    if (detailedShelf) await page.getByText("1 个待整理阅读物组").waitFor();
    else await page.getByText("Book.cbz").first().waitFor();
    await noOverflow("bookshelf inbox");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}x${height}: directory routing and separate inboxes passed`);
  }
} finally { await browser.close(); }
