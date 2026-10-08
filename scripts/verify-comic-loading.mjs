import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const namespace = `comic-loading-${Date.now()}`, output = `D:/DevTools/Android/Build/qa/${namespace}`;
mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let b = 0; b < 8; b++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
function png(index) {
  const width = 600, height = 400, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = y * (width * 3 + 1) + 1 + x * 3; raw[p] = 40 + index * 5; raw[p + 1] = 100 + (Math.floor(y / 40) % 2) * 70; raw[p + 2] = 180; }
  const chunk = (type, bytes) => { const name = Buffer.from(type), size = Buffer.alloc(4), hash = Buffer.alloc(4); size.writeUInt32BE(bytes.length); hash.writeUInt32BE(crc(Buffer.concat([name, bytes]))); return Buffer.concat([size, name, bytes, hash]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const images = Array.from({ length: 36 }, (_, i) => png(i)), events = [], checks = [];
let root;
const server = createServer((request, response) => {
  const route = request.url.split("?")[0].split("/").slice(2).join("/");
  if (request.method === "POST") { response.end("{}"); return; }
  if (route === "chapter/one") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ kind: "comic", entryId: "one", title: "36页延迟加载回归", offline: false, pages: images.map((_, i) => `${root}chapter/one/page/${i}`), cacheKeys: images.map((_, i) => createHash("sha256").update(`${namespace}/image/${i}`).digest("hex")), location: { pageIndex: 0, offset: 0 } })); return; }
  const index = Number(route.split("/").at(-1));
  events.push({ index, event: "start", time: Date.now() });
  response.on("close", () => events.push({ index, event: response.writableFinished ? "complete" : "cancel", time: Date.now() }));
  setTimeout(() => { if (!response.destroyed) { response.setHeader("Content-Type", "image/png"); response.end(images[index]); } }, 1500);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port; root = `http://127.0.0.1:${port}/${namespace}/`;
cmd("reverse", `tcp:${port}`, `tcp:${port}`);
cmd("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await pause(1000);
cmd("forward", "tcp:9344", `localabstract:webview_devtools_remote_${cmd("shell", "pidof", app).trim()}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9344", { noDefaults: true }), page = browser.contexts()[0].pages()[0];
const native = (command, payload = {}) => page.evaluate(({ command, payload }) => window.__TAURI_INTERNALS__.invoke("android_native", { command, payload }), { command, payload });
const state = () => native("readerState");
const control = async (action, value = 0, settings) => native("readerControl", { sessionId: (await state()).sessionId, action, value, settings: settings ? JSON.stringify(settings) : null });
let original;
try {
  if ((await state()).status !== "closed") await control("close");
  await native("openComicFixture", { sessionId: namespace, baseUrl: root, kind: "comic", entryId: "one" });
  for (let i = 0; i < 30 && !(await state()).settings; i++) await pause(100);
  original = (await state()).settings;
  await control("settings", 0, { mode: "scroll-vertical", gap: 0, autoScroll: false });
  await pause(1800);
  // Short images expose more than the fixed ±2 cancellation window at once.
  for (let i = 0; i < 5; i++) { cmd("shell", "input", "swipe", "636", "2250", "636", "650", "180"); await pause(90); }
  for (let i = 0; i < 3; i++) { cmd("shell", "input", "swipe", "636", "650", "636", "2250", "180"); await pause(90); }
  await pause(5000); checks.push({ case: "fling-and-return", state: await state() });
  for (const index of [9, 18, 27, 33, 18, 9, 0]) {
    await control("seek", index / 35 + 0.00001);
    const started = Date.now(); let value;
    do { await pause(100); value = await state(); } while ((!value.rendered || value.visiblePages?.some(p => p.rendered === false)) && Date.now() - started < 7000);
    checks.push({ case: `page-${index + 1}`, milliseconds: Date.now() - started, state: value });
  }
  const visited = new Set();
  for (let step = 0; step < 45; step++) {
    const started = Date.now(); let value;
    do { await pause(100); value = await state(); } while ((!value.rendered || value.visiblePages?.some(p => p.rendered === false)) && Date.now() - started < 7000);
    for (const item of value.visiblePages ?? []) visited.add(item.index);
    checks.push({ case: `continuous-${step}`, milliseconds: Date.now() - started, state: value });
    if (visited.has(35)) break;
    cmd("shell", "input", "swipe", "636", "1800", "636", "850", "450");
  }
  const stuck = checks.filter(check => !check.state.rendered || check.state.visiblePages?.some(p => p.rendered === false));
  writeFileSync(`${output}/result.json`, JSON.stringify({ checks, events, visited: [...visited], stuck: stuck.length }, null, 2));
  console.log(JSON.stringify({ output, stuck: stuck.map(c => c.case), checks: checks.map(c => ({ case: c.case, milliseconds: c.milliseconds, rendered: c.state.rendered })) }));
  assert.equal(stuck.length, 0, "visible pages must settle after flinging and revisiting");
  assert.equal(visited.size, 36, "continuous swipes must display every page of the chapter");
} finally {
  if ((await state()).status !== "closed") { if (original) await control("settings", 0, original); await control("close"); }
  await browser.close(); cmd("reverse", "--remove", `tcp:${port}`); await new Promise(resolve => server.close(resolve));
}
