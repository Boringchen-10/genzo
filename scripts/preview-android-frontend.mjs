import { execFile } from "node:child_process";
import { readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

// Debug-only preview: evaluate rebuilt React assets in the installed WebView.
// Native code and application data remain those of the installed APK.
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}
const serial = option("--serial", "emulator-5554");
const app = option("--app", serial.startsWith("emulator-") ? "com.genzo.android" : "com.genzo.android.readerqa");
const port = Number(option("--port", "9228"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local preview port");
if (!["com.genzo.android", "com.genzo.android.readerqa"].includes(app)) throw new Error("Expected a Genzo package");
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const directory = resolve(option("--dir", args[0] && !args[0].startsWith("--") ? args[0] : "D:/DevTools/Android/Build/frontend-preview"));
const run = promisify(execFile);
const command = async (...values) => (await run(adb, ["-s", serial, ...values], { encoding: "utf8", timeout: 5000 })).stdout.trim();
let browser, page, session, pid, modified = 0, busy = false, stopping = false, lastError = "";
const modulePattern = /<script\b[^>]*type="module"[^>]*src="[^"]+"[^>]*><\/script>/g;
const stylePattern = /<link\b[^>]*rel="stylesheet"[^>]*>/g;
async function update() {
  const current = readFileSync(resolve(directory, "index.html"), "utf8");
  const modules = current.match(modulePattern);
  const styles = current.match(stylePattern);
  if (modules?.length !== 1 || !styles?.length) throw new Error("Preview requires one bundled JavaScript entry");
  const javascript = readFileSync(resolve(directory, `.${modules[0].match(/src="([^"]+)"/)[1]}`), "utf8");
  const html = current.replace(modulePattern, "").replace(stylePattern, tag => `<style>${readFileSync(resolve(directory, `.${tag.match(/href="([^"]+)"/)[1]}`), "utf8")}</style>`);
  const origin = new URL(page.url()).origin;
  if (origin !== "http://tauri.localhost" && origin !== "https://tauri.localhost") throw new Error("Expected the installed Genzo WebView");
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
async function refresh() {
  if (busy || stopping) return;
  busy = true;
  try {
    const currentPid = await command("shell", "pidof", app);
    if (!/^\d+$/.test(currentPid)) throw new Error(`请打开 ${app}（${serial}）`);
    // Preserve the native reader/player while it is foreground; refresh after returning.
    const activity = await command("shell", "dumpsys", "activity", "activities");
    const resumed = activity.split("\n").find(line => /topResumedActivity=|mResumedActivity:/.test(line));
    if (!resumed?.includes(`${app}/.MainActivity`) && !resumed?.includes(`${app}/com.genzo.android.MainActivity`)) return;
    const reconnect = pid !== currentPid || !browser?.isConnected() || page?.isClosed();
    if (reconnect) {
      await browser?.close().catch(() => {});
      await command("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${currentPid}`);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true, timeout: 5000 });
      page = browser.contexts()[0].pages().find(value => /https?:\/\/tauri\.localhost/.test(value.url()));
      if (!page) throw new Error("Genzo 调试 WebView 尚未就绪");
      session = await page.context().newCDPSession(page);
      const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_app_info"));
      if (info.dataDirectory !== `/data/user/0/${app}`) throw new Error("Unexpected app data directory");
      pid = currentPid;
    }
    const next = statSync(resolve(directory, "index.html")).mtimeMs;
    if (!reconnect && next === modified) return;
    await update();
    modified = next;
    console.log(`前端预览已${reconnect ? "连接" : "刷新"}：${serial} / ${app} / PID ${pid}；使用该包自己的数据。`);
    lastError = "";
  } catch (error) {
    const message = String(error);
    if (message !== lastError) console.error(message);
    lastError = message;
  } finally { busy = false; }
}
// Polling reconnects after an app restart or USB reconnect; watch speeds up rebuilds.
const poll = setInterval(() => { void refresh(); }, 2000);
let timer;
const watcher = watch(directory, () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 600); });
async function close() {
  stopping = true; watcher.close(); clearInterval(poll); clearTimeout(timer);
  if (browser?.isConnected() && !page?.isClosed()) {
    await session.send("Page.setBypassCSP", { enabled: false }).catch(() => {});
    await page.reload({ waitUntil: "commit", timeout: 5000 }).catch(() => {});
  }
  await browser?.close().catch(() => {});
  await command("forward", "--remove", `tcp:${port}`).catch(() => {});
  console.log("预览已停止，WebView 已恢复包内资源；应用数据保留。");
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
await refresh();
await new Promise(() => {});
