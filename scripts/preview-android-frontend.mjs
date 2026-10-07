import { execFileSync } from "node:child_process";
import { readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

// Debug-only preview: evaluate rebuilt React assets in the installed emulator WebView.
// Native code and application data remain those of the installed APK.
const serial = "emulator-5554";
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const directory = resolve(process.argv[2] ?? "D:/DevTools/Android/Build/frontend-preview");
const pid = execFileSync(adb, ["-s", serial, "shell", "pidof", "com.genzo.android"], { encoding: "utf8" }).trim();
execFileSync(adb, ["-s", serial, "forward", "tcp:9228", `localabstract:webview_devtools_remote_${pid}`]);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9228", { noDefaults: true });
const page = browser.contexts()[0].pages()[0];
const origin = new URL(page.url()).origin;
if (origin !== "http://tauri.localhost" && origin !== "https://tauri.localhost") throw new Error("Expected the installed Genzo WebView");
const session = await page.context().newCDPSession(page);
const modulePattern = /<script\b[^>]*type="module"[^>]*src="[^"]+"[^>]*><\/script>/g;
const stylePattern = /<link\b[^>]*rel="stylesheet"[^>]*>/g;
async function update() {
  const current = readFileSync(resolve(directory, "index.html"), "utf8");
  const modules = current.match(modulePattern);
  const styles = current.match(stylePattern);
  if (modules?.length !== 1 || !styles?.length) throw new Error("Preview requires one bundled JavaScript entry");
  const javascript = readFileSync(resolve(directory, `.${modules[0].match(/src="([^"]+)"/)[1]}`), "utf8");
  const html = current.replace(modulePattern, "").replace(stylePattern, tag => `<style>${readFileSync(resolve(directory, `.${tag.match(/href="([^"]+)"/)[1]}`), "utf8")}</style>`);
  const hash = new URL(page.url()).hash;
  await page.goto(`${origin}/${hash}`, { waitUntil: "commit" });
  await session.send("Page.stopLoading");
  // Only this debug session bypasses CSP for the workspace bundle; app permissions stay intact.
  await session.send("Page.setBypassCSP", { enabled: true });
  const { frameTree } = await session.send("Page.getFrameTree");
  await session.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  await page.evaluate(code => { window.__GENZO_FRONTEND_PREVIEW__ = true; new Function(code)(); }, javascript);
  await page.getByRole("navigation", { name: "主导航" }).waitFor({ timeout: 15000 });
}
await update();
const count = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_works").then(works => works.length));
console.log(`模拟器前端预览就绪：${count} 个作品；仅替换 React 资源，没有构建或安装 APK。`);
let modified = statSync(resolve(directory, "index.html")).mtimeMs;
let timer;
const watcher = watch(directory, () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const next = statSync(resolve(directory, "index.html")).mtimeMs;
    if (next === modified) return;
    modified = next;
    try { await update(); console.log("前端重建完成，模拟器已刷新。"); }
    catch (error) { console.error(error); }
  }, 600);
});
async function close() { watcher.close(); clearTimeout(timer); await browser.close(); process.exit(0); }
process.on("SIGINT", close);
process.on("SIGTERM", close);
await new Promise(() => {});
