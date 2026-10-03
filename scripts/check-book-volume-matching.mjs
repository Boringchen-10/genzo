import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
// Browser drag tests cannot detect WebView2's native Windows interception.
for (const file of ["tauri.conf.json", "tauri.e2e.conf.json"]) {
  const config = JSON.parse(await readFile(new URL(`../src-tauri/${file}`, import.meta.url), "utf8"));
  assert.equal(config.app.windows[0].dragDropEnabled, false, `${file} must allow HTML5 drag on Windows`);
}
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(theme => {
      localStorage.setItem("genzo-preferences", JSON.stringify({ state: { theme }, version: 0 }));
      const work = { id: "book", title: "败犬女主太多了", type: "novel", category: "novel", originalTitle: null, description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 1, missingCount: 0, createdAt: "t", updatedAt: "t", metadataStatus: "matched", metadataYear: null, lastRecognizedAt: null, mediaFiles: [], fieldLocks: [], candidates: [], subtitleLinks: [], metadata: null };
      const cover = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="136"><rect width="96" height="136" fill="#77754a"/><text x="48" y="77" text-anchor="middle" fill="white" font-size="32">卷</text></svg>');
      const entry = { id: "v7", title: "败犬女主太多了 -07", fileName: "败犬女主太多了！ 07 (雨森たきび) (Z-Library).epub", volumeNumber: 7, chapterNumber: null, mediaFileIds: ["v7"], format: "epub", missing: false, readState: "reading", bangumiId: null, bangumiTitle: null, bangumiCoverPath: null };
      const entry8 = { ...entry, id: "v8", title: "败犬女主太多了 -08", fileName: "败犬女主太多了！ 08 (雨森たきび) (Z-Library).epub", volumeNumber: 8, mediaFileIds: ["v8"], readState: "unread" };
      window.__volumeCalls = [];
      window.__readCalls = [];
      window.__batchScopes = [];
      window.__removedVolumeIds = [];
      window.__bookOrder = JSON.parse(sessionStorage.getItem("bookOrder") || '{"mode":"asc","entryIds":[]}');
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        metadata: { currentWindow: { label: "main" } },
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command === "get_work") return work;
          if (command === "list_works") return [work];
          if (command === "list_book_entries") return [entry, entry8].filter(item => !window.__removedVolumeIds.includes(item.id)).map(item => ({ ...item }));
          if (command === "get_book_entry_order") return { ...window.__bookOrder };
          if (command === "save_book_entry_order") { window.__bookOrder = { mode: args.mode, entryIds: args.entryIds ?? window.__bookOrder.entryIds }; sessionStorage.setItem("bookOrder", JSON.stringify(window.__bookOrder)); return { ...window.__bookOrder }; }
          if (command === "save_book_entry") { [entry, entry8].find(item => item.id === args.entryId).readState = args.input.readState; return [entry, entry8].filter(item => !window.__removedVolumeIds.includes(item.id)).map(item => ({ ...item })); }
          if (command === "save_book_read_state") { window.__readCalls.push(args); if (window.__failReadState) throw new Error("保存失败，请重试"); for (const item of [entry, entry8]) if (args.entryIds.includes(item.id)) item.readState = args.readState; return [entry, entry8].filter(item => !window.__removedVolumeIds.includes(item.id)).map(item => ({ ...item })); }
          if (command === "remove_book_entries") { window.__removedVolumeIds.push(...args.entryIds); return [entry, entry8].filter(item => !window.__removedVolumeIds.includes(item.id)).map(item => ({ ...item })); }
          if (command === "get_embedded_book_metadata") return { title: "第七卷", creator: null, series: null, number: "7", description: null, isbn: null, coverPath: cover };
          if (command === "search_book_volume_candidates") return [7, 8].map(number => ({ externalId: String(number), title: `败犬女主太多了! (${number})`, coverUrl: cover, volumeNumber: number, linkedToSeries: true, stale: false }));
          if (command === "preview_book_volume_batch") { window.__batchScopes.push(args.entryIds); const scope = [entry, entry8].filter(item => !args.entryIds || args.entryIds.includes(item.id)); return { seriesId: "series", proposals: scope.filter(item => !item.bangumiId).map(item => ({ entryId: item.id, entryTitle: item.title, volumeNumber: item.volumeNumber, candidate: { externalId: String(item.volumeNumber), title: `败犬女主太多了! (${item.volumeNumber})`, coverUrl: item.id === "v8" ? null : cover, volumeNumber: item.volumeNumber, linkedToSeries: true, stale: false } })), skipped: scope.filter(item => item.bangumiId).map(item => ({ entryId: item.id, entryTitle: item.title, reason: "已有单册匹配，保持不变" })) }; }
          if (command === "confirm_book_volume_batch") { window.__volumeCalls.push(args); for (const item of [entry, entry8]) { if (!args.selections.some(selected => selected.entryId === item.id)) continue; item.bangumiId = String(item.volumeNumber); item.bangumiTitle = `败犬女主太多了! (${item.volumeNumber})`; item.bangumiCoverPath = cover; } return { matched: args.selections.length, skipped: [] }; }
          if (command === "confirm_book_volume_candidate") { window.__volumeCalls.push(args); entry.bangumiId = args.externalId; entry.bangumiTitle = "败犬女主太多了! (7)"; entry.bangumiCoverPath = cover; return null; }
          if (command === "clear_book_volume_candidate") { entry.bangumiId = null; entry.bangumiTitle = null; entry.bangumiCoverPath = null; return null; }
          if (command === "get_setting") return "dark";
          if (command === "get_playback_progress") return { items: [], sessions: [] };
          if (command.startsWith("list_")) return [];
          return null;
        },
      } });
    }, process.env.GENZO_TEST_THEME || "light");
    await page.goto(`${base}/#/library/book`);
    const order = () => page.locator(".book-entry-main strong").allTextContents();
    const ascending = () => page.getByRole("button", { name: "当前顺序，切换为倒序" });
    const descending = () => page.getByRole("button", { name: "当前倒序，切换为顺序" });
    await ascending().waitFor();
    assert.equal(await page.locator(".book-order-controls button").count(), 1);
    assert.equal(await ascending().textContent(), "顺序");
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-07", "-08"]);
    await ascending().click();
    await descending().waitFor();
    assert.equal(await descending().textContent(), "倒序");
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-08", "-07"]);
    await page.reload();
    await descending().waitFor();
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-08", "-07"]);
    await page.locator(".book-entry").filter({ hasText: "-07" }).getByRole("button", { name: /拖动调整/ }).dragTo(page.locator(".book-entry").filter({ hasText: "-08" }));
    await page.getByText("自定义顺序").waitFor();
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-07", "-08"]);
    assert.equal(await descending().count(), 1, "dragging in descending order must retain its direction");
    assert.deepEqual(await page.evaluate(() => window.__bookOrder.entryIds), ["v8", "v7"]);
    if (process.env.GENZO_SCREENSHOT_DIR) {
      await mkdir(process.env.GENZO_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-order-${width}.png`), fullPage: true });
    }
    await page.reload();
    await page.getByText("自定义顺序").waitFor();
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-07", "-08"]);
    await descending().click();
    await ascending().waitFor();
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-08", "-07"], "ascending must retain the saved manual base order");
    await page.reload();
    await ascending().waitFor();
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-08", "-07"]);
    await ascending().click();
    await descending().waitFor();
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-07", "-08"]);
    await descending().click();
    await ascending().waitFor();
    assert.deepEqual((await order()).map(value => value.slice(-3)), ["-08", "-07"]);
    assert.deepEqual(await page.evaluate(() => window.__bookOrder.entryIds), ["v8", "v7"], "toggling must not overwrite the manual order");
    await page.locator(".book-entry").filter({ hasText: "-08" }).getByRole("button", { name: /拖动调整/ }).press("ArrowDown");
    await page.waitForFunction(() => document.querySelector(".book-entry-main strong")?.textContent?.endsWith("-07"));
    const volume7 = page.locator(".book-entry").filter({ hasText: "-07" });
    assert.equal(await page.locator('.book-entry input[type="checkbox"]').count(), 0);
    assert.equal(await page.locator(".book-read-toggle").count(), 0);
    assert.equal(await volume7.getByRole("button", { name: /阅读中，标记为已读/ }).isVisible(), false);
    if (process.env.GENZO_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-actions-normal-${width}.png`), fullPage: true });
    await volume7.locator("summary").click();
    await volume7.getByRole("button", { name: /阅读中，标记为已读/ }).click();
    await volume7.locator('button[aria-label*="已读，标记为未读"]').waitFor({ state: "attached" });
    assert.equal(await volume7.locator("details").getAttribute("open"), null);
    await volume7.locator("summary").click();
    await volume7.getByRole("button", { name: /已读，标记为未读/ }).click();
    await volume7.locator('button[aria-label*="未读，标记为已读"]').waitFor({ state: "attached" });
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
    await page.getByRole("button", { name: "多选" }).click();
    assert.equal(await page.locator('.book-entry input[type="checkbox"]').count(), 2);
    assert.equal(await page.locator(".book-entry-drag").count(), 0);
    assert.equal(await page.getByRole("button", { name: "标记所选为已读" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "识别所选" }).isDisabled(), true);
    await page.getByRole("checkbox", { name: "选择败犬女主太多了 -07" }).check();
    await page.getByRole("button", { name: "标记所选为已读" }).click();
    await page.getByText("已将 1 卷标记为已读").waitFor();
    assert.equal(await page.locator('.book-entry button[aria-label*="已读，标记为未读"]').count(), 1);
    assert.deepEqual(await page.evaluate(() => window.__readCalls.at(-1).entryIds), ["v7"]);
    await page.evaluate(() => { window.__failReadState = true; });
    await page.getByRole("button", { name: "标记所选为未读" }).click();
    await page.getByText("保存失败，请重试").waitFor();
    assert.equal(await volume7.locator('button[aria-label*="已读，标记为未读"]').count(), 1);
    assert.equal(await page.getByRole("checkbox", { name: "选择败犬女主太多了 -07" }).isChecked(), true);
    await page.evaluate(() => { window.__failReadState = false; });
    await page.getByRole("button", { name: "标记所选为未读" }).click();
    await page.getByText("已将 1 卷标记为未读").waitFor();
    await page.getByRole("checkbox", { name: "选择败犬女主太多了 -08" }).check();
    await page.getByRole("button", { name: "标记所选为已读" }).click();
    await page.getByText("已将 2 卷标记为已读").waitFor();
    assert.equal(await page.locator('.book-entry button[aria-label*="已读，标记为未读"]').count(), 2);
    await page.getByRole("button", { name: "标记所选为未读" }).click();
    await page.getByText("已将 2 卷标记为未读").waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await page.locator('.book-entry input[type="checkbox"]').count(), 0);
    assert.equal(await page.locator(".book-read-toggle").count(), 0);
    assert.equal(await page.locator(".book-entry-drag").count(), 2);
    await page.getByRole("button", { name: "批量识别卷册" }).click();
    await page.getByText("批量匹配预览 · 2 卷可关联，0 卷待核对").waitFor();
    await page.locator(".book-volume-batch").scrollIntoViewIfNeeded();
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width);
    if (process.env.GENZO_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.GENZO_SCREENSHOT_DIR, `book-volume-batch-${width}.png`), fullPage: true });
    assert.equal(await page.locator("img.book-volume-review-cover").count(), 1);
    await page.locator(".book-volume-review").getByText("暂无封面").waitFor();
    await page.locator(".book-volume-batch").getByRole("button", { name: "取消全选" }).click();
    assert.equal(await page.getByRole("button", { name: "确认匹配 0 卷" }).isDisabled(), true);
    await page.getByRole("button", { name: "全选可关联" }).click();
    await page.getByRole("checkbox", { name: "匹配败犬女主太多了 -08" }).uncheck();
    await page.getByRole("button", { name: "确认匹配 1 卷" }).click();
    await page.getByText("已匹配 1 卷；跳过 0 卷，可按需逐卷核对。").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__volumeCalls.at(-1).selections), [{ entryId: "v7", externalId: "7" }]);
    assert.equal(await page.getByText("Bangumi 单册：败犬女主太多了! (8) · #8").count(), 0);
    await page.getByRole("button", { name: "多选" }).click();
    await page.getByText("已选 0 卷", { exact: true }).waitFor();
    assert.equal(await page.locator('.book-entry input[type="checkbox"]:checked').count(), 0);
    await page.getByRole("checkbox", { name: "选择败犬女主太多了 -08" }).check();
    await page.getByRole("button", { name: "识别所选" }).click();
    await page.getByText("批量匹配预览 · 1 卷可关联，0 卷待核对").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__batchScopes.at(-1)), ["v8"]);
    assert.equal(await page.locator(".book-volume-review").count(), 1);
    await page.getByRole("button", { name: "确认匹配 1 卷" }).click();
    await page.getByText("Bangumi 单册：败犬女主太多了! (8) · #8").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__volumeCalls.at(-1).selections), [{ entryId: "v8", externalId: "8" }]);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "批量识别卷册" }).click();
    await page.getByText("批量匹配预览 · 0 卷可关联，2 卷待核对").waitFor();
    assert.equal(await page.locator(".book-volume-review.skipped").count(), 2);
    assert.equal(await page.getByRole("button", { name: "确认匹配 0 卷" }).isDisabled(), true);
    await page.locator(".book-volume-batch").getByRole("button", { name: "取消", exact: true }).click();
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
    console.log(`${width}x${height}: sorting, batch read/retry, selected matching, cover review and removal passed`);
  }
} finally { await browser.close(); }
