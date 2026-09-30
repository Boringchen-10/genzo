import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

// Run only against a separately built QA identifier, never the user's library.
// Build with a TAURI_CONFIG override: identifier com.genzo.desktop.book-drag-qa-<unique>,
// devUrl http://127.0.0.1:4187, additionalBrowserArgs --remote-debugging-port=9225,
// and dragDropEnabled false. Start the preview and that executable before this check.
const browser = await chromium.connectOverCDP(process.env.GENZO_CDP_URL || "http://127.0.0.1:9225");
const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith("http://127.0.0.1:4187"));
assert.ok(page, "No isolated Genzo WebView2 test window found");
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
try {
  const info = await invoke("get_app_info");
  assert.match(path.basename(info.dataDirectory), /^com\.genzo\.desktop\.book-drag-qa-[a-z0-9-]+$/);
  const fixtureRoot = path.resolve("artifacts", "book-drag-qa", `books-${Date.now()}`);
  await mkdir(fixtureRoot, { recursive: true });
  for (const number of [1, 2, 3]) await writeFile(path.join(fixtureRoot, `拖拽回归 第${number}卷.txt`), "Generated book drag fixture.\n");
  const root = await invoke("add_library_root", { input: { path: fixtureRoot, kind: "novel", enabled: true, destination: "bookshelf" } });
  await invoke("scan_library_root", { id: root.id });
  const groups = await invoke("list_book_import_groups");
  const ids = groups.flatMap(group => group.files).filter(file => path.dirname(file.path) === fixtureRoot).map(file => file.id);
  assert.equal(ids.length, 3);
  const workId = await invoke("create_book_work", { title: "拖拽回归", mediaType: "novel", mediaFileIds: ids, externalId: null, coverMediaFileId: null });
  const entries = await invoke("list_book_entries", { workId });
  const originalData = entries.map(entry => [entry.id, entry.mediaFileIds, entry.readState, entry.volumeNumber, entry.bangumiId]);
  const first = entries[0];
  const second = entries[1];
  const third = entries[2];
  const row = entry => page.locator(".book-entry").filter({ has: page.locator(".book-entry-main strong", { hasText: entry.title }) });
  const handle = entry => row(entry).getByRole("button", { name: `拖动调整${entry.title}的位置`, exact: true });
  const order = () => page.locator(".book-entry-main strong").allTextContents();
  // A CDP viewport override does not reliably resize an existing WebView2 host.
  // Exercise its actual desktop size; the browser regression covers three sizes.
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  {
    await invoke("save_book_entry_order", { workId, mode: "asc", entryIds: null });
    await page.goto(`http://127.0.0.1:4187/#/library/${workId}`);
    await handle(first).waitFor();
    await page.evaluate(() => {
      window.__dragEvents = [];
      for (const type of ["dragstart", "dragover", "drop", "dragend"]) document.addEventListener(type, event => window.__dragEvents.push(event.type));
    });
    await handle(first).dragTo(row(third));
    await page.getByText("自定义顺序", { exact: true }).waitFor({ timeout: 10000 });
    assert.deepEqual(await order(), [second.title, third.title, first.title]);
    assert.ok((await page.evaluate(() => window.__dragEvents)).includes("drop"));
    assert.deepEqual((await invoke("get_book_entry_order", { workId })).entryIds, [second.id, third.id, first.id]);
    await page.reload();
    await page.getByText("自定义顺序", { exact: true }).waitFor();
    assert.deepEqual(await order(), [second.title, third.title, first.title]);
    await handle(first).dragTo(row(second));
    await page.waitForFunction(title => document.querySelector(".book-entry-main strong")?.textContent === title, first.title);
    assert.deepEqual(await order(), [first.title, second.title, third.title]);
    assert.deepEqual((await invoke("list_book_entries", { workId })).map(entry => [entry.id, entry.mediaFileIds, entry.readState, entry.volumeNumber, entry.bangumiId]), originalData);
    const layout = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.viewport, `WebView2 overflow: ${JSON.stringify(layout)}`);
    console.log(`${viewport.width}x${viewport.height}: WebView2 CDP drag up/down and SQLite persistence passed`);
  }
} finally {
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await browser.close();
}
