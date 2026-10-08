import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const output = `D:/DevTools/Android/Build/qa/comic-real-transition-${Date.now()}`; mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
cmd("forward", "tcp:9344", `localabstract:webview_devtools_remote_${cmd("shell", "pidof", app).trim()}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9344", { noDefaults: true }), page = browser.contexts()[0].pages()[0];
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload }), state = () => native("readerState");
const control = async (action, value = 0) => native("readerControl", { sessionId: (await state()).sessionId, action, value });
const base = { kind: "comic", pathWord: "modujingbingdenuli", group: "default" }, currentId = "c2d8f146-17b6-11e9-bfa4-00163e0ca5bd", nextId = "c83952b8-1d2c-11e9-8ff6-00163e0ca5bd";
const result = {};
const cache = () => new Set(cmd("shell", "run-as", app, "ls", "cache/reader-network-images").trim().split(/\s+/));
async function rendered(id, limit = 25000) { const start = Date.now(); let value; do { await page.waitForTimeout(50); value = await state(); } while ((value.entryId !== id || !value.rendered || !value.visiblePages?.every(p => p.rendered)) && Date.now() - start < limit); assert.ok(value.entryId === id && value.rendered); return value; }
try {
  const next = await invoke("get_book_online_content", { ...base, entryId: nextId });
  const keys = next.pages.slice(0, 6).map(url => createHash("sha256").update(url).digest("hex")), before = cache();
  result.cachedBefore = keys.filter(key => before.has(key)).length;
  const archives = await invoke("list_cached_book_content", { kind: base.kind, pathWord: base.pathWord, entryIds: [nextId] });
  result.nextOffline = archives.some(entry => entry.entryId === nextId);
  if ((await state()).status !== "closed") await control("close");
  await invoke("open_internal_reader", { ...base, entryId: currentId }); await rendered(currentId);
  await control("seek", 0); await rendered(currentId);
  await control("seek", 43 / 51 + .00001); await rendered(currentId);
  const start = Date.now(); let files;
  do { files = cache(); if (result.nextOffline || keys.every(key => files.has(key))) break; await page.waitForTimeout(300); } while (Date.now() - start < 60000);
  result.preparationWaitMs = Date.now() - start;
  assert.ok(result.nextOffline || keys.every(key => files.has(key)), "next opening images are on disk while still reading the current chapter");
  assert.equal((await state()).entryId, currentId);
  await page.waitForTimeout(700);
  assert.equal((await invoke("get_reading_resume", { kind: base.kind, pathWord: base.pathWord })).entryId, currentId, "warmup does not change the latest reading chapter");
  const transition = Date.now(); await control("chapter-next"); const nextState = await rendered(nextId, 1800);
  result.transitionMs = Date.now() - transition; result.nextState = nextState;
  assert.equal(nextState.location.pageIndex, 0);
  writeFileSync(`${output}/phone.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  console.log(JSON.stringify({ output, cachedBefore: result.cachedBefore, nextOffline: result.nextOffline, preparationWaitMs: result.preparationWaitMs, transitionMs: result.transitionMs }));
} catch (error) { result.error = String(error); throw error; }
finally { writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); await browser.close(); }
