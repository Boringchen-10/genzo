// Isolated IPC fixture only: no real sources, credentials or media files.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem("genzo-preferences", JSON.stringify({ state: { theme }, version: 0 })), width === 1920 ? "dark" : "light");
    await page.addInitScript(() => {
      const rootPath = "\\\\?\\UNC\\RaiDrive-Administrator\\cloud\\动漫\\这是一个用于检查长目录显示的文件夹\\第一季和第二季";
      const now = new Date().toISOString();
      const roots = [{ id: "local", path: rootPath, kind: "video", enabled: true, sourceType: "mounted", availability: "online", lastScannedAt: now, createdAt: now, updatedAt: now }];
      window.__scanCalls = [];
      const base = { rootId: "local", rootPath, currentDirectory: `${rootPath}\\第二季`, visitedDirectories: 8, pendingDirectories: 4, discovered: 137, processed: 0, reused: 0, errors: [], failedDirectories: [], retry: false };
      window.__scanTasks = [
        { ...base, id: "walking", stage: "scanning" },
        { ...base, id: "indexing", stage: "indexing", processed: 30, reused: 20 },
        { ...base, id: "failed", rootId: "remote", rootPath: "webdav://remote", stage: "completed", discovered: 12, processed: 12, errors: ["WebDAV /dav/bad/ 返回 HTTP 503"], failedDirectories: ["/dav/bad/"] },
      ];
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: path => path, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (command === "list_library_roots") return roots;
          if (command === "list_scan_tasks") return structuredClone(window.__scanTasks);
          if (command === "cancel_scan_task") {
            window.__scanCalls.push({ command, args });
            window.__scanTasks.find(task => task.id === args.id).stage = "cancelled";
            return;
          }
          if (command === "retry_scan_task") {
            window.__scanCalls.push({ command, args });
            window.__scanTasks.unshift({ ...base, id: "retry", stage: "queued", retry: true, rootId: "remote", rootPath: "webdav://remote" });
            return new Promise(resolve => { window.__finishRetry = () => {
              window.__scanTasks.find(task => task.id === "retry").stage = "completed";
              window.__scanTasks.find(task => task.id === "failed").failedDirectories = [];
              resolve({ errors: [] });
            }; });
          }
          if (command === "list_remote_cache") return [];
          if (command.startsWith("list_")) return [];
          return null;
        },
      } });
    });
    const base = process.env.GENZO_TEST_BASE || "http://127.0.0.1:4191";
    await page.goto(`${base}/#/library?tab=sources`);
    const panel = page.getByRole("region", { name: "扫描任务" });
    await panel.getByText("扫描文件", { exact: true }).waitFor();
    assert.match(await panel.textContent(), /发现 137/);
    assert.equal(await panel.getByRole("progressbar", { name: "索引进度" }).getAttribute("value"), "30");
    await page.evaluate(() => { window.__scanTasks.find(task => task.id === "indexing").processed = 60; });
    await page.waitForFunction(() => document.querySelector('.scan-task progress')?.value === 60);
    const walking = panel.locator("article").filter({ hasText: "扫描文件" });
    await walking.getByRole("button", { name: "取消扫描", exact: true }).click();
    await panel.getByText("已取消", { exact: true }).waitFor();
    await panel.getByText(/本轮索引未提交/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__scanCalls[0]), { command: "cancel_scan_task", args: { id: "walking" } });
    await panel.getByRole("button", { name: "重试失败目录（1）", exact: true }).click();
    await panel.getByText("失败目录重试 · 等待扫描", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__scanCalls[1]), { command: "retry_scan_task", args: { id: "failed" } });
    await page.evaluate(() => { window.__finishRetry(); });
    await panel.getByText("失败目录重试 · 扫描完成", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "媒体库", exact: true }).click();
    await page.getByRole("tab", { name: "媒体源", exact: true }).click();
    await panel.getByText("已取消", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const overlap = await panel.locator("button").evaluateAll(buttons => buttons.some(button => {
      const rect = button.getBoundingClientRect();
      return rect.left < 0 || rect.right > innerWidth;
    }));
    assert.equal(overlap, false);
    await page.screenshot({ path: `artifacts/screenshots/scan-tasks-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`${width}x${height}: live progress, cancel, failed-directory retry, remount and layout passed`);
    await page.close();
  }
} finally { await browser.close(); }
