// Isolated UI fixture: never opens a real player or modifies a real library.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
const files = [1, 7, 12].map(n => ({ id: `m${n}`, workId: "w", fileName: `测试视频.S01E${String(n).padStart(2, "0")}.mkv`, path: `D:/fixture/${n}.mkv`, mediaType: "video", extension: "mkv", size: 1024, missing: false }));
const work = { id: "w", title: "续播测试作品", type: "video", category: "anime", description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 3, missingCount: 0, metadataStatus: "matched", mediaFiles: files, fieldLocks: [], candidates: [], subtitleLinks: [] };
const items = files.map((f, i) => ({ mediaFileId: f.id, workId: "w", fileName: f.fileName, title: work.title, toolId: "pot", positionMs: i === 1 ? 720000 : 120000, durationMs: 1440000, completed: false, missing: false, updatedAt: `2026-09-${i === 1 ? "26" : "25"}T12:00:00Z` }));
const structure = { workId: "w", bangumiId: "1", seasons: [], unmatchedFiles: [], staff: [], characters: [], warnings: [], episodes: files.map((f, i) => ({ provider: "bangumi", externalId: String(i), episodeNumber: [1,7,12][i], sortNumber: i, episodeType: 0, title: "测试分集", originalTitle: null, description: "", airDate: null, duration: "24:00", localFiles: [f] })) };
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ work, items, structure }) => {
    window.__calls = [];
    window.__mode = "saved";
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === "get_playback_progress") {
          if (window.__mode === "error") throw "模拟失败";
          return { items: window.__mode === "empty" ? [] : items, sessions: [] };
        }
        if (["resume_playback", "launch_media"].includes(command)) { window.__calls.push({ command, ...args }); return; }
        if (command === "get_work") return work;
        if (command === "get_anime_work_structure") return structure;
        if (command === "list_works") return [work];
        if (command === "get_dashboard") return { totalWorks: 1, recentWorks: [work], favoriteWorks: [], lastScan: null };
        if (command.startsWith("list_")) return [];
        return null;
      },
    } });
  }, { work, items, structure });
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${process.env.GENZO_TEST_URL || "http://127.0.0.1:4176"}/#/library/w`);
    const main = page.locator(".detail-actions").getByRole("button", { name: "继续观看", exact: true });
    await main.click();
    assert.equal(await page.locator(".playback-history-row").count(), 1);
    assert.ok((await page.locator(".playback-history-row").innerText()).includes("S01E07"));
    assert.ok((await page.locator(".playback-history").boundingBox()).height < 115);
    assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), { command: "resume_playback", mediaFileId: "m7", restart: false });
    const episode = page.locator(".official-episode").filter({ hasText: "第 7 集" });
    const bar = episode.getByRole("progressbar");
    assert.equal(await bar.getAttribute("aria-valuenow"), "50");
    const geometry = await bar.evaluate(el => { const b = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return { bottom: Math.abs(b.bottom-p.bottom), width: b.width, height: b.height }; });
    assert.ok(geometry.bottom < 2 && geometry.width > 100 && geometry.height === 4);
    await episode.getByRole("button", { name: "继续观看", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__calls.at(-1).mediaFileId), "m7");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await episode.screenshot({ path: `artifacts/screenshots/episode-progress-${width}.png` });
    await page.goto(`${process.env.GENZO_TEST_URL || "http://127.0.0.1:4176"}/#/`);
    await page.locator(".gnz-home-actions").getByRole("button", { name: "继续观看", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__calls.at(-1).mediaFileId), "m7");
    console.log(`${width}x${height}: home/detail resume episode 7, episode progress 50%, layout passed`);
  }
  await page.goto(`${process.env.GENZO_TEST_URL || "http://127.0.0.1:4176"}/#/library/w`);
  await page.locator(".detail-actions").getByRole("button", { name: "继续观看", exact: true }).waitFor();
  await page.evaluate(() => { window.__mode = "error"; window.dispatchEvent(new Event("focus")); });
  await page.getByText("观看记录读取失败：模拟失败", { exact: true }).waitFor();
  await page.locator(".detail-actions").getByRole("button", { name: "继续观看", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__calls.at(-1).mediaFileId), "m7");
  await page.evaluate(() => { window.__mode = "empty"; window.dispatchEvent(new Event("focus")); });
  await page.locator(".detail-actions").getByRole("button", { name: "打开", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__calls.at(-1).mediaFileId), "m1");
  assert.equal(await page.locator(".episode-playback-progress").count(), 0);
  assert.deepEqual(errors, []);
  console.log("failed refresh preserves episode 7; genuinely empty history starts first episode without fake progress");
} finally { await browser.close(); }
