// Isolated Tauri responses; no real library or player launched by this UI check.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
const file = { id: "m", workId: "w", path: "D:\\fixture.mkv", fileName: "用于验证长文件名与续播入口的测试视频.S02E03.2160p.mkv", extension: "mkv", mediaType: "video", size: 1, missing: false };
const work = { id: "w", title: "测试作品", type: "video", category: "tv", description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 1, missingCount: 0, metadataStatus: "unmatched", mediaFiles: [file], fieldLocks: [], candidates: [], subtitleLinks: [] };
const item = { mediaFileId: "m", workId: "w", title: work.title, fileName: file.fileName, toolId: "pot", positionMs: 723000, durationMs: 1440000, completed: false, missing: false, updatedAt: "2026-09-25T08:00:00Z" };
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(({ work, item }) => {
    window.__playbackCalls = [];
    window.__playbackMode = "record";
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === "get_playback_progress") {
          if (window.__playbackMode === "error") throw "测试读取失败";
          return { items: [item], sessions: window.__playbackMode === "active" ? [{ mediaFileId: "m", status: "tracking", message: "正在记录 PotPlayer 进度" }] : [] };
        }
        if (command === "resume_playback") { window.__playbackCalls.push(args); return; }
        if (command === "get_work") return work;
        if (command === "list_works") return [work];
        if (command === "get_dashboard") return { totalWorks: 1, recentWorks: [work], favoriteWorks: [], lastScan: null, videoCount: 1, comicCount: 0, novelCount: 0, gameCount: 0, otherCount: 0, favoriteCount: 0, missingFileCount: 0 };
        if (command.startsWith("list_")) return [];
        return null;
      },
    } });
  }, { work, item });
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({ width, height });
    for (const route of ["/", "/library/w"]) {
      await page.goto(`http://127.0.0.1:4175/#${route}`, { waitUntil: "domcontentloaded" });
      const panel = page.getByRole("region", { name: "观看记录" });
      await panel.getByRole("button", { name: "继续观看", exact: true }).waitFor();
      assert.ok((await panel.innerText()).includes("12:03 / 24:00"));
      await panel.getByRole("button", { name: "继续观看", exact: true }).click();
      await page.waitForFunction(() => window.__playbackCalls.length > 0);
      assert.deepEqual(await page.evaluate(() => window.__playbackCalls.at(-1)), { mediaFileId: "m", restart: false });
      await panel.getByRole("button", { name: "从头播放", exact: true }).click();
      await page.waitForFunction(() => window.__playbackCalls.at(-1).restart);
      assert.deepEqual(await page.evaluate(() => window.__playbackCalls.at(-1)), { mediaFileId: "m", restart: true });
      assert.equal(await panel.evaluate(n => n.scrollWidth > n.clientWidth + 1), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if (route === "/") {
        const geometry = await page.evaluate(() => {
          const strip = document.querySelector(".gnz-home-switcher");
          const poster = strip?.querySelector(".gnz-switcher-thumb");
          const title = document.querySelector(".seanime-banner-title");
          return { poster: poster?.getBoundingClientRect().width ?? 0, strip: strip?.getBoundingClientRect().width ?? 0, titleRight: title?.getBoundingClientRect().right ?? 0, stripLeft: strip?.getBoundingClientRect().left ?? 0 };
        });
        assert.ok(geometry.poster >= 112, `hero poster should be enlarged: ${width}x${height}, ${geometry.poster}px`);
        assert.ok(geometry.titleRight <= geometry.stripLeft + 1, `title and poster strip overlap at ${width}x${height}`);
        await page.screenshot({ path: `artifacts/screenshots/home-hero-posters-${width}.png` });
      }
      await panel.screenshot({ path: `artifacts/screenshots/playback-${route === "/" ? "home" : "detail"}-${width}.png` });
    }
    console.log(`${width}x${height}: resume/restart, saved time and layout passed`);
  }
  await page.evaluate(() => { window.__playbackMode = "active"; window.dispatchEvent(new Event("focus")); });
  await page.getByRole("button", { name: "记录中", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "记录中", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.__playbackMode = "error"; window.dispatchEvent(new Event("focus")); });
  await page.getByText("观看记录读取失败：测试读取失败", { exact: true }).waitFor();
  assert.ok(await page.getByRole("progressbar").count());
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
