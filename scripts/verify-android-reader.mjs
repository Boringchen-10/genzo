import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const serial = "emulator-5554";
const app = "com.genzo.android.readerqa";
const output = "D:/DevTools/Android/Build/qa/reader-c/native";
mkdirSync(output, { recursive: true });
const pid = execFileSync(adb, ["-s", serial, "shell", "pidof", app], { encoding: "utf8" }).trim();
assert.match(pid, /^\d+$/);
execFileSync(adb, ["-s", serial, "forward", "tcp:9233", `localabstract:webview_devtools_remote_${pid}`]);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9233", { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost"));
assert.ok(page);
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload });
const info = await invoke("get_app_info");
assert.equal(info.dataDirectory, `/data/user/0/${app}`);
const works = await invoke("list_works");
assert.deepEqual(works.map(work => work.id).sort(), ["reader-fixture-comic", "reader-fixture-novel"]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    const state = await native("readerState");
    if (predicate(state)) return state;
    assert.notEqual(state.status, "error", `Reader failed: ${JSON.stringify(state)}`);
    await delay(100);
  }
  throw new Error(`Reader timeout: ${label}; ${JSON.stringify(await native("readerState"))}`);
}
const ready = () => until(state => state.status === "ready" && state.rendered, "rendered content");
const control = async (action, value = 0, settings) => {
  const state = await native("readerState");
  return native("readerControl", { sessionId: state.sessionId, action, value, settings: settings ? JSON.stringify(settings) : null });
};
function screenshot(name) {
  const focus = execFileSync(adb, ["-s", serial, "shell", "dumpsys", "window"], { encoding: "utf8" });
  assert.ok(focus.includes("com.genzo.android.ReaderActivity"), "Native reader must be the visible activity");
  const png = execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]);
  writeFileSync(`${output}/${name}.png`, png);
}
async function open(kind) {
  await invoke("open_internal_reader", { kind, pathWord: `reader-fixture-${kind}`, entryId: "one", group: kind === "comic" ? "default" : "" });
  const state = await ready(); assert.equal(state.offline, true); return state;
}
async function close() { await control("close"); await until(state => state.status === "closed", "closed activity"); await delay(350); }
const result = { package: app, dataDirectory: info.dataDirectory, pid, fixture: "generated CBZ/EPUB, no real media", cases: {} };
try {
  result.cases.comicOpen = await open("comic");
  screenshot("comic-scroll");
  for (const mode of ["page-horizontal", "page-vertical", "scroll-horizontal", "scroll-vertical"]) {
    await control("settings", 0, { mode, rtl: false }); await delay(400); await ready();
    await control("seek", .6); await delay(400); const state = await ready();
    assert.equal(state.location.pageIndex, 3, `${mode} must seek to the long page`);
    result.cases[mode] = state; screenshot(`comic-${mode}`);
  }
  await control("settings", 0, { mode: "page-horizontal", rtl: true }); await delay(400);
  await control("seek", .2); await delay(400); await control("next"); await delay(500);
  assert.equal((await ready()).location.pageIndex, 2);
  result.cases.comicRtl = await ready(); screenshot("comic-rtl");
  await delay(800); await close();
  const restored = await open("comic"); assert.equal(restored.location.pageIndex, 2); result.cases.comicRestore = restored;
  await close();
  result.cases.novelOpen = await open("novel"); await delay(700); screenshot("novel-page");
  const initial = (await ready()).location;
  await control("next"); await delay(600);
  const advanced = await ready(); assert.notDeepEqual(advanced.location, initial, "Novel page navigation must move its real locator");
  result.cases.novelNext = advanced;
  await control("settings", 0, { fontSize: 24, lineHeight: 1.9, theme: "paper" }); await delay(700); await ready(); screenshot("novel-paper");
  await control("settings", 0, { scroll: true }); await delay(700); await control("seek", .7); await delay(700);
  result.cases.novelScroll = await ready(); screenshot("novel-scroll");
  await delay(800); const beforeClose = await ready(); await close();
  const novelRestored = await open("novel");
  assert.equal(novelRestored.location.href, beforeClose.location.href);
  result.cases.novelRestore = novelRestored;
  screenshot("novel-restored");
  await close();
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, cases: Object.keys(result.cases), passed: true }));
} catch (error) {
  result.error = String(error); result.lastState = await native("readerState").catch(() => null);
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  writeFileSync(`${output}/logcat.txt`, execFileSync(adb, ["-s", serial, "logcat", "-d", "--pid", pid], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  throw error;
} finally { await browser.close(); }
