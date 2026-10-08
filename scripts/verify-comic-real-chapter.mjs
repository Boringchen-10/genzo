import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const output = `D:/DevTools/Android/Build/qa/comic-real-chapter-${Date.now()}`;
mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
cmd("forward", "tcp:9344", `localabstract:webview_devtools_remote_${cmd("shell", "pidof", app).trim()}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9344", { noDefaults: true }), page = browser.contexts()[0].pages()[0];
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload });
const state = () => native("readerState");
const control = async (action, value = 0, settings) => native("readerControl", { sessionId: (await state()).sessionId, action, value, settings: settings ? JSON.stringify(settings) : null });
const args = { kind: "comic", pathWord: "modujingbingdenuli", entryId: "52615840-10a4-11e9-b68d-00163e0ca5bd", group: "default" };
const result = { cases: [], visited: [] }; let original;
async function settle(name) {
  const started = Date.now(); let value;
  do { await page.waitForTimeout(100); value = await state(); } while ((!value.rendered || !value.visiblePages?.length || value.visiblePages.some(p => !p.rendered)) && Date.now() - started < 35000);
  result.cases.push({ name, milliseconds: Date.now() - started, state: value });
  assert.ok(value.rendered && value.visiblePages.every(p => p.rendered), `${name}: real visible images decode`);
  return value;
}
try {
  const start = Date.now(), chapter = await invoke("get_book_online_content", args);
  result.chapter = { title: chapter.title, pages: chapter.pages.length, metadataMs: Date.now() - start };
  if ((await state()).status !== "closed") await control("close");
  await invoke("open_internal_reader", args);
  await settle("open"); original = (await state()).settings;
  await control("settings", 0, { mode: "scroll-vertical", autoScroll: false, gap: 0 });
  for (const index of [9, 19, 29, 39, 49, 59, 29, 9, 0]) {
    await control("seek", index / (chapter.pages.length - 1) + 0.00001); await settle(`seek-${index + 1}`);
  }
  const visited = new Set();
  for (let step = 0; step < chapter.pages.length * 2; step++) {
    const value = await settle(`continuous-${step}`);
    value.visiblePages.forEach(p => visited.add(p.index));
    if (visited.has(chapter.pages.length - 1)) break;
    cmd("shell", "input", "swipe", "636", "2150", "636", "700", "420");
  }
  result.visited = [...visited].sort((a, b) => a - b);
  assert.equal(visited.size, chapter.pages.length, "continuous reading displays the entire real chapter");
  for (let i = 0; i < 5; i++) cmd("shell", "input", "swipe", "636", "700", "636", "2150", "150");
  await settle("fast-return");
  writeFileSync(`${output}/phone.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  console.log(JSON.stringify({ output, pages: chapter.pages.length, visited: visited.size, maximumMs: Math.max(...result.cases.map(c => c.milliseconds)), jumps: result.cases.filter(c => c.name.startsWith("seek")).map(c => ({ name: c.name, ms: c.milliseconds })) }));
} catch (error) { result.error = String(error); throw error; }
finally {
  if (original && (await state()).status !== "closed") await control("settings", 0, original);
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); await browser.close();
}
