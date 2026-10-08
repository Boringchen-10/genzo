import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.readerqa";
const output = `D:/DevTools/Android/Build/qa/anime-covers-${Date.now()}`;
mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
cmd("forward", "tcp:9344", `localabstract:webview_devtools_remote_${cmd("shell", "pidof", app).trim()}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9344", { noDefaults: true }), page = browser.contexts()[0].pages()[0];
const requests = [], result = { cases: [], requests };
page.on("request", request => { if (request.resourceType() === "image") requests.push(request.url()); });
const visible = () => page.evaluate(() => [...document.querySelectorAll(".gz-explore-poster")].filter(e => { const b = e.getBoundingClientRect(); return b.top < innerHeight - 80 && b.bottom > 100 && b.left < innerWidth && b.right > 0; }).map(e => { const i = e.querySelector("img"); return { id: e.dataset.exploreCoverId, src: i?.src, loaded: !!i?.complete && i.naturalWidth > 0 }; }));
async function settle(name, limit = 25000) {
  const start = Date.now(); let items;
  do { await page.waitForTimeout(100); items = await visible(); } while ((!items.length || items.some(i => !i.loaded)) && Date.now() - start < limit);
  result.cases.push({ name, milliseconds: Date.now() - start, items });
  assert.ok(items.length >= 3 && items.every(i => i.loaded), `${name}: every visible poster decodes`);
  assert.ok(items.every(i => i.src.startsWith("http://asset.localhost/")), "posters use native disk cache");
}
try {
  await page.evaluate(() => { location.hash = "#/explore"; });
  await page.waitForTimeout(500);
  await page.getByRole("tab", { name: "动漫", exact: true }).click();
  await settle("initial");
  for (let i = 0; i < 4; i++) cmd("shell", "input", "swipe", "636", "2100", "636", "700", "180");
  await settle("fling-down");
  for (let i = 0; i < 4; i++) cmd("shell", "input", "swipe", "636", "2100", "636", "700", "180");
  await settle("fling-further");
  for (let i = 0; i < 10; i++) cmd("shell", "input", "swipe", "636", "700", "636", "2100", "180");
  await settle("fling-back");
  assert.equal(requests.some(url => url.startsWith("https://lain.bgm.tv/")), false, "WebView must not bypass native Bangumi transport");
  writeFileSync(`${output}/phone.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  console.log(JSON.stringify({ output, cases: result.cases.map(c => ({ name: c.name, milliseconds: c.milliseconds, decoded: c.items.length })) }));
} catch (error) { result.error = String(error); throw error; }
finally { writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); await browser.close(); }
