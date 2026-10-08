import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const namespace = `comic-prefetch-${Date.now()}`, output = `D:/DevTools/Android/Build/qa/${namespace}`;
mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
function png() {
  const width = 600, height = 900, raw = Buffer.alloc((width * 3 + 1) * height, 150);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  const chunk = (type, bytes) => { const name = Buffer.from(type), size = Buffer.alloc(4), hash = Buffer.alloc(4); size.writeUInt32BE(bytes.length); hash.writeUInt32BE(crc(Buffer.concat([name, bytes]))); return Buffer.concat([size, name, bytes, hash]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const image = png(), events = [], checks = [], count = 36;
let root, inFlight = 0, maximum = 0;
const server = createServer((request, response) => {
  const route = request.url.split("?")[0].split("/").slice(2).join("/");
  if (request.method === "POST") { response.end("{}"); return; }
  if (route === "chapter/one") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ kind: "comic", entryId: "one", title: "漫画预加载回归", offline: false, pages: Array.from({ length: count }, (_, i) => `${root}chapter/one/page/${i}`), cacheKeys: Array.from({ length: count }, (_, i) => createHash("sha256").update(`${namespace}/image/${i}`).digest("hex")), location: { pageIndex: 0, offset: 0 } })); return; }
  const index = Number(route.split("/").at(-1));
  events.push({ index, event: "start", time: Date.now() }); maximum = Math.max(maximum, ++inFlight);
  response.on("close", () => { inFlight--; events.push({ index, event: response.writableFinished ? "complete" : "cancel", time: Date.now() }); });
  setTimeout(() => { if (!response.destroyed) { response.setHeader("Content-Type", "image/png"); response.end(image); } }, 1500);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port; root = `http://127.0.0.1:${port}/${namespace}/`; cmd("reverse", `tcp:${port}`, `tcp:${port}`);
cmd("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await pause(1000);
cmd("forward", "tcp:9344", `localabstract:webview_devtools_remote_${cmd("shell", "pidof", app).trim()}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9344", { noDefaults: true }), page = browser.contexts()[0].pages()[0];
const native = (command, payload = {}) => page.evaluate(({ command, payload }) => window.__TAURI_INTERNALS__.invoke("android_native", { command, payload }), { command, payload });
const state = () => native("readerState");
const control = async (action, value = 0, settings) => native("readerControl", { sessionId: (await state()).sessionId, action, value, settings: settings ? JSON.stringify(settings) : null });
let original;
async function warmed(indices, limit = 8500) {
  const start = Date.now();
  while (indices.some(index => !events.some(e => e.index === index && e.event === "complete")) && Date.now() - start < limit) await pause(100);
  assert.ok(indices.every(index => events.some(e => e.index === index && e.event === "complete")), `prefetch completes ${indices} before they are displayed`);
}
async function displayed(index, limit) {
  const start = Date.now(); let value;
  do { await pause(50); value = await state(); } while ((!value.rendered || value.location?.pageIndex !== index) && Date.now() - start < limit);
  checks.push({ index, milliseconds: Date.now() - start, rendered: value.rendered, page: value.location?.pageIndex });
  assert.ok(value.rendered && value.location.pageIndex === index, `page ${index + 1} displays within ${limit}ms`);
}
try {
  if ((await state()).status !== "closed") await control("close");
  await native("openComicFixture", { sessionId: namespace, baseUrl: root, kind: "comic", entryId: "one" });
  for (let i = 0; i < 30 && !(await state()).settings; i++) await pause(100);
  original = (await state()).settings;
  await control("settings", 0, { mode: "page-horizontal", autoScroll: false, rtl: false });
  await displayed(0, 3000);
  await warmed([1, 2, 3, 4, 5, 6]);
  for (let index = 1; index <= 6; index++) { const time = Date.now(); await control("next"); await displayed(index, 650); await pause(Math.max(0, 650 - (Date.now() - time))); }
  const jumpTime = Date.now(); await control("seek", 20 / 35 + 0.00001); await displayed(20, 3600);
  const currentStart = events.find(e => e.index === 20 && e.event === "start")?.time;
  assert.ok(currentStart - jumpTime < 800, "visible page starts ahead of background prefetch work");
  await control("previous"); await displayed(19, 3600); await warmed([13, 14, 15, 16, 17, 18]);
  await warmed(Array.from({ length: count }, (_, i) => i), 35000);
  const end = await state(); assert.equal(end.location.pageIndex, 19, "the entire chapter warms without navigating to its end");
  assert.ok(maximum <= 4, "network concurrency stays bounded at four");
  console.log(JSON.stringify({ output, passed: true, maximum, turns: checks.slice(1, 7), currentRequestDelayMs: currentStart - jumpTime }));
} catch (error) { checks.push({ error: String(error) }); throw error; }
finally {
  writeFileSync(`${output}/result.json`, JSON.stringify({ checks, events, maximum }, null, 2));
  if ((await state()).status !== "closed") { if (original) await control("settings", 0, original); await control("close"); }
  await browser.close(); cmd("reverse", "--remove", `tcp:${port}`); await new Promise(resolve => server.close(resolve));
}
