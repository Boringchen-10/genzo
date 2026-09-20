// Isolated fixtures only: never reads or modifies real media or the app database.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = "artifacts/screenshots/media-association";
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const root = { id: "root", path: "\\\\Server\\Share\\Anime", displayName: "挂载媒体源", kind: "video", enabled: true, createdAt: now, updatedAt: now, sourceType: "mounted" };
      let files = ["Season 2\\01.mkv", "Season 2\\02.mkv", "字幕备份\\01.ass", "Fonts.zip"].map((name, index) => ({
        id: `m${index}`, workId: null, libraryRootId: "root", path: `\\\\?\\UNC\\SERVER\\SHARE\\Anime\\${name}`, fileName: name.split("\\").at(-1),
        extension: name.split(".").at(-1), mediaType: index < 2 ? "video" : index === 2 ? "other" : "comic", size: 1200,
        missing: false, recognitionStatus: "unmatched", parsedMediaInfo: "[]", createdAt: now, updatedAt: now,
      }));
      const work = { id: "existing", title: "已收藏的第二季", type: "video", status: "completed", notes: "原有笔记", tags: [], favorite: true, rating: 8, createdAt: now, updatedAt: now, mediaCount: 0, missingCount: 0, metadataStatus: "unmatched", subtitleLinks: [], fieldLocks: [], candidates: [] };
      globalThis.__attachCalls = [];
      globalThis.__failAttach = false;
      Object.defineProperty(globalThis, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value,
        invoke: async (command, args) => {
          if (command === "list_works") return [work];
          if (command === "list_library_roots") return [root];
          if (command === "list_unassigned_media") return files;
          if (command === "list_unassigned_media_groups") return files.map(file => ({ key: file.id, title: file.fileName, folderPath: null, mediaType: file.mediaType, fileCount: 1, missingCount: 0, totalSize: file.size, recognitionStatus: "unmatched", representative: file }));
          if (command === "get_work") return { ...work, mediaFiles: [] };
          if (command === "list_external_tools") return [];
          if (command === "get_setting") return null;
          if (command === "attach_media_files") {
            if (globalThis.__failAttach) { globalThis.__failAttach = false; throw new Error("模拟关联失败"); }
            globalThis.__attachCalls.push(args);
            files = files.filter(file => !args.mediaFileIds.includes(file.id));
            return null;
          }
          return null;
        },
      } });
    });
    const base = process.env.GENZO_PREVIEW_URL || "http://127.0.0.1:4180";
    await page.goto(`${base}/#/library?tab=inbox`);
    await page.locator(".inbox-folder").filter({ hasText: "挂载媒体源" }).click();
    assert.equal(await page.locator(".inbox-folder").filter({ hasText: "Fonts.zip" }).count(), 0);
    await page.locator(".inbox-folder").filter({ hasText: "season 2" }).click();
    await page.getByRole("button", { name: "关联已有作品", exact: true }).click();
    await page.getByPlaceholder("搜索媒体库中的作品").fill("已收藏");
    await page.getByRole("button", { name: "关联到此作品" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const calls = await page.evaluate(() => globalThis.__attachCalls);
    assert.deepEqual(calls, [{ workId: "existing", mediaFileIds: ["m0", "m1"] }]);
    await page.waitForFunction(() => document.querySelectorAll(".inbox-file").length === 0);
    await page.goto(`${base}/#/library/existing`);
    await page.getByRole("button", { name: "关联文件", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "关联媒体文件" });
    await dialog.getByRole("button", { name: /挂载媒体源/ }).click();
    assert.equal(await dialog.getByText("01.ass", { exact: true }).count(), 0);
    await page.screenshot({ path: `${output}/folders-${width}.png` });
    await dialog.getByRole("checkbox", { name: "选择目录 字幕备份" }).check();
    await dialog.getByRole("button", { name: /字幕备份/ }).click();
    assert.equal(await dialog.getByRole("checkbox", { name: "选择文件 01.ass" }).isChecked(), true);
    await page.evaluate(() => { globalThis.__failAttach = true; });
    await dialog.getByRole("button", { name: "关联所选文件" }).click();
    await page.getByText("模拟关联失败", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("checkbox", { name: "选择文件 01.ass" }).isChecked(), true);
    await page.screenshot({ path: `${output}/${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
    await dialog.getByRole("button", { name: "关联所选文件" }).click();
    await page.waitForFunction(() => globalThis.__attachCalls.length === 2);
    assert.deepEqual((await page.evaluate(() => globalThis.__attachCalls))[1], { workId: "existing", mediaFileIds: ["m2"] });
    assert.deepEqual(errors, []);
    console.log(`${width}x${height}: existing-work association, directory browsing, selection and failure retry passed`);
    await page.close();
  }
} finally { await browser.close(); }
