import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const namespace = `comic-transition-${Date.now()}`, output = `D:/DevTools/Android/Build/qa/${namespace}`;
mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
const raw = Buffer.alloc((600 * 3 + 1) * 900, 170); for (let y = 0; y < 900; y++) raw[y * 1801] = 0;
const chunk = (type, bytes) => { const name = Buffer.from(type), size = Buffer.alloc(4), hash = Buffer.alloc(4); size.writeUInt32BE(bytes.length); hash.writeUInt32BE(crc(Buffer.concat([name, bytes]))); return Buffer.concat([size, name, bytes, hash]); };
const header = Buffer.alloc(13); header.writeUInt32BE(600); header.writeUInt32BE(900, 4); header[8] = 8; header[9] = 2;
const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
const events = [], cases = [], attempts = new Map(), titles = { one: "自制第一话", two: "自制第二话", three: "自制第三话" };
let root, mode = "ready", inFlight = 0, maximum = 0;
const server = createServer((request, response) => {
  const [session, ...parts] = request.url.split("?")[0].split("/").slice(1), route = parts.join("/");
  const key = `${session}/${route}`, attempt = (attempts.get(key) || 0) + 1; attempts.set(key, attempt);
  events.push({ session, route, event: "start", method: request.method, time: Date.now() });
  if (request.method === "POST") { response.end("{}"); return; }
  const json = value => { if (!response.destroyed) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); } };
  if (route === "entries/0") { json({ total: 3, entries: Object.entries(titles).map(([id, title], order) => ({ id, title, order, count: 20 })) }); return; }
  if (parts.length === 2 && parts[0] === "chapter") {
    const id = parts[1];
    if (mode === "metadata-failure" && id === "two" && attempt === 1) { response.writeHead(503); response.end("{}"); return; }
    setTimeout(() => json({ kind: "comic", entryId: id, title: titles[id], offline: false, pages: Array.from({ length: 20 }, (_, i) => `${root}chapter/${id}/page/${i}`), cacheKeys: Array.from({ length: 20 }, (_, i) => createHash("sha256").update(`${session}/${id}/${i}`).digest("hex")), location: { pageIndex: 0, offset: 0 } }), id === "one" ? 50 : 700); return;
  }
  if (parts.length !== 4 || parts[2] !== "page") { response.writeHead(404); response.end("{}"); return; }
  maximum = Math.max(maximum, ++inFlight);
  let success = false;
  response.on("close", () => { inFlight--; events.push({ session, route, event: success && response.writableFinished ? "complete" : "cancel", time: Date.now() }); });
  if (mode === "image-failure" && parts[1] === "two" && parts[3] === "3" && attempt === 1) { response.writeHead(503); response.end(); return; }
  setTimeout(() => { if (!response.destroyed) { success = true; response.setHeader("Content-Type", "image/png"); response.end(image); } }, 1200);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port;
cmd("reverse", `tcp:${port}`, `tcp:${port}`); cmd("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await pause(1000);
cmd("forward", "tcp:9344", `localabstract:webview_devtools_remote_${cmd("shell", "pidof", app).trim()}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9344", { noDefaults: true }), page = browser.contexts()[0].pages()[0];
const native = (command, payload = {}) => page.evaluate(({ command, payload }) => window.__TAURI_INTERNALS__.invoke("android_native", { command, payload }), { command, payload });
const state = () => native("readerState");
const control = async (action, value = 0, settings) => native("readerControl", { sessionId: (await state()).sessionId, action, value, settings: settings ? JSON.stringify(settings) : null });
let original, session;
const started = route => events.filter(e => e.session === session && e.route === route && e.event === "start" && e.method === "GET");
const completed = route => events.some(e => e.session === session && e.route === route && e.event === "complete");
async function until(predicate, label, limit = 12000) { const time = Date.now(); do { if (await predicate()) return Date.now() - time; await pause(50); } while (Date.now() - time < limit); throw Error(label); }
async function displayed(id, index, limit = 5000) { return until(async () => { const s = await state(); return s.entryId === id && s.rendered && (index == null || s.location.pageIndex === index); }, `display ${id}:${index}`, limit); }
async function open(scenario) {
  if ((await state()).status !== "closed") await control("close");
  mode = scenario; session = `${namespace}-${scenario}`; root = `http://127.0.0.1:${port}/${session}/`;
  await native("openComicFixture", { sessionId: session, baseUrl: root, kind: "comic", entryId: "one" }); await displayed("one", 0);
  original ??= (await state()).settings;
  await control("settings", 0, { mode: "page-horizontal", autoScroll: false, continuous: true, rtl: false }); await displayed("one", 0);
}
try {
  await open("ready"); await pause(300); assert.equal(started("chapter/two").length, 0);
  await control("seek", 13 / 19 + .00001); await displayed("one", 13); assert.equal(started("chapter/two").length, 0);
  await control("seek", 14 / 19 + .00001); await displayed("one", 14);
  await until(() => Array.from({ length: 6 }, (_, i) => completed(`chapter/two/page/${i}`)).every(Boolean), "next opening pages warm");
  assert.equal(started("chapter/two").length, 1);
  assert.equal(events.some(e => e.session === session && e.route === "chapter/two/progress"), false);
  assert.equal(started("chapter/three").length, 0);
  assert.equal(events.some(e => e.session === session && /^chapter\/two\/page\/(?:[6-9]|1\d)$/.test(e.route)), false);
  await control("seek", 1); await displayed("one", 19); const time = Date.now(); await control("next"); await displayed("two", 0, 1000);
  cases.push({ name: "prepared-auto-transition", milliseconds: Date.now() - time });
  assert.equal(started("chapter/two").length, 1); assert.equal(started("chapter/two/page/0").length, 1);
  await control("chapter-previous"); await displayed("one", 19); const before = started("chapter/two").length; await pause(500); assert.equal(started("chapter/two").length, before, "backward reading does not start another next-chapter warmup");
  await control("catalogue"); cmd("shell", "uiautomator", "dump", "/data/local/tmp/genzo-transition.xml");
  const xml = cmd("shell", "cat", "/data/local/tmp/genzo-transition.xml"), node = xml.match(/<node[^>]*text="自制第三话"[^>]*>/)?.[0]; assert.ok(node);
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number); cmd("shell", "input", "tap", String(Math.floor((bounds[0] + bounds[2]) / 2)), String(Math.floor((bounds[1] + bounds[3]) / 2)));
  await displayed("three", 0); cases.push({ name: "previous-and-manual-chapter", passed: true });

  await open("inflight"); await control("seek", 14 / 19 + .00001);
  await until(() => started("chapter/two/page/0").length > 0 && !completed("chapter/two/page/0"), "prefetch starts before crossing");
  await control("chapter-next"); await displayed("two", 0); assert.equal(started("chapter/two/page/0").length, 1, "in-flight opening image is reused"); cases.push({ name: "inflight-reuse", passed: true });

  await open("metadata-failure"); await control("seek", 14 / 19 + .00001); await until(() => started("chapter/two").length === 1, "failed metadata attempted"); await pause(300);
  assert.equal((await state()).entryId, "one"); await control("chapter-next"); await displayed("two", 0); assert.equal(started("chapter/two").length, 2); cases.push({ name: "metadata-failure-recovery", passed: true });

  await open("image-failure"); await control("seek", 14 / 19 + .00001);
  await until(() => started("chapter/two/page/3").length > 0 && completed("chapter/two/page/5"), "other opening images survive one failure");
  assert.equal((await state()).entryId, "one"); await control("chapter-next"); await displayed("two", 0); await control("seek", 3 / 19 + .00001); await displayed("two", 3); assert.equal(started("chapter/two/page/3").length, 2); cases.push({ name: "image-failure-recovery", passed: true });

  await open("cancel"); await control("seek", 14 / 19 + .00001); await until(() => started("chapter/two/page/0").length > 0, "warm before exiting");
  await control("close"); const closed = Date.now(); await pause(500);
  assert.equal(events.some(e => e.session === session && e.route.startsWith("chapter/two/page/") && e.event === "start" && e.time > closed + 100), false);
  assert.ok(maximum <= 4); cases.push({ name: "exit-cancels-prefetch", passed: true });
  console.log(JSON.stringify({ output, maximum, cases }));
} catch (error) { cases.push({ error: String(error), state: await state().catch(() => null) }); throw error; }
finally {
  if ((await state()).status !== "closed") { if (original) await control("settings", 0, original); await control("close"); }
  // Restore shared reader preferences even when the final cancellation case closed the activity.
  if (original && (await state()).status === "closed") { await open("restore"); await control("settings", 0, original); await control("close"); }
  writeFileSync(`${output}/result.json`, JSON.stringify({ cases, events, maximum }, null, 2));
  await browser.close(); cmd("reverse", "--remove", `tcp:${port}`); await new Promise(resolve => server.close(resolve));
}
