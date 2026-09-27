// Isolated IPC fixture. No real database or media is accessed.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
const now = "2026-09-27T00:00:00Z";
const works = ["first", "second"].map(id => ({ id, title: "同名作品", type: "video", category: "anime", originalTitle: null, description: "隔离测试简介", coverPath: null, bannerPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaFiles: [], mediaCount: 0, missingCount: 0, metadata: null, fieldLocks: [], candidates: [], subtitleLinks: [], createdAt: now, updatedAt: now }));
const history = [
  { id: "a", targetWorkId: "first", targetTitle: "同名作品", fileCount: 2, createdAt: now, undoneAt: null },
  { id: "b", targetWorkId: "second", targetTitle: "同名作品", fileCount: 3, createdAt: now, undoneAt: null },
  { id: "c", targetWorkId: "first", targetTitle: "同名作品", fileCount: 1, createdAt: now, undoneAt: now },
];
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ works, history }) => {
      window.__historyQueries = [];
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (command === "get_work") return works.find(work => work.id === args.id);
          if (command === "list_works") return works;
          if (command === "list_recognition_history") { window.__historyQueries.push(args.workId ?? null); return history.filter(item => !args.workId || item.targetWorkId === args.workId); }
          if (command === "undo_recognition") { history.find(item => item.id === args.id).undoneAt = "later"; return null; }
          if (command === "get_playback_progress") return { items: [], sessions: [] };
          if (command.startsWith("list_")) return [];
          return null;
        },
      } });
    }, { works, history });
    const base = process.env.GENZO_TEST_BASE || "http://127.0.0.1:4189";
    await page.goto(`${base}/#/library/first`);
    await page.getByRole("button", { name: "识别记录", exact: true }).click();
    let modal = page.getByRole("dialog", { name: "本作品识别记录" });
    await page.waitForFunction(() => document.querySelectorAll(".recognition-history-row").length === 2);
    assert.equal(await page.evaluate(() => window.__historyQueries.at(-1)), "first");
    assert.equal(await modal.getByRole("button", { name: "撤销", exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/screenshots/work-recognition-history-${width}.png` });
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.goto(`${base}/#/library/second`);
    await page.getByRole("button", { name: "识别记录", exact: true }).click();
    modal = page.getByRole("dialog", { name: "本作品识别记录" });
    await page.waitForFunction(() => document.querySelectorAll(".recognition-history-row").length === 1);
    assert.equal(await page.evaluate(() => window.__historyQueries.at(-1)), "second");
    await modal.getByRole("button", { name: "撤销", exact: true }).click();
    await modal.getByRole("button", { name: "确认撤销", exact: true }).click();
    await page.waitForURL("**/#/library");
    assert.equal(await page.evaluate(() => window.__historyQueries.at(-1)), "second", "post-undo refresh stays scoped");
    await page.getByRole("tab", { name: "待整理", exact: true }).click();
    await page.getByRole("button", { name: "识别记录", exact: true }).click();
    await page.getByRole("dialog", { name: "识别记录与撤销" }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".recognition-history-row").length === 3);
    assert.equal(await page.evaluate(() => window.__historyQueries.at(-1)), null);
    assert.deepEqual(errors, []);
    console.log(`${width}x${height}: work ID isolation, same-title works, scope switch, undo refresh and global inbox history passed`);
    await page.close();
  }
} finally { await browser.close(); }
