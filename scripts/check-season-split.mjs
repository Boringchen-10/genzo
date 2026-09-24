// Isolated UI regression: mocked Tauri responses; never opens the user's database or media.
// Start Vite on 127.0.0.1:4175, then run: node scripts/check-season-split.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const now = "2026-09-24T00:00:00Z";
const root = String.raw`\\?\UNC\RaiDrive-Administrator\share\Anime\Show 1-2季`;
const files = [1, 13, 14].map(number => ({
  id: String(number), workId: "s1", libraryRootId: "root", path: `${root}\\Show [${number}].mkv`,
  fileName: `[TUDO&Ygm] Boku no Kokoro no Yabai Yatsu [${number}][Ma10p_2160p][x265_flac_ass].mkv`,
  extension: "mkv", mediaType: "video", size: 1500000000, missing: false, createdAt: now, updatedAt: now,
  recognitionStatus: "matched", parsedTitle: "我心里危险的东西", parsedSeason: null, parsedEpisode: String(number),
  parsedEpisodeStart: number, parsedEpisodeEnd: null, parsedSpecialType: null, thumbnailPath: null,
}));
const detail = {
  id: "s1", title: "我心里危险的东西 第一季", originalTitle: "僕の心のヤバイやつ", type: "video",
  description: "这是用于验证第一季保留与第二季拆分行为的隔离测试简介。", coverPath: null, bannerPath: null,
  status: "in_progress", favorite: true, rating: 9, notes: "第一季的私人笔记", tags: [], createdAt: now, updatedAt: now,
  metadataStatus: "matched", metadataYear: 2023, mediaFiles: files, mediaCount: 3, missingCount: 0,
  metadata: { provider: "bangumi", externalId: "first-season", title: "第一季", fetchedAt: now },
  fieldLocks: [], candidates: [], subtitleLinks: [], networkScore: 8.2, networkScoreProvider: "bangumi", networkRatingCount: 100,
};
const candidate = {
  id: "c", mediaFileId: "13", provider: "bangumi", externalId: "second-season", title: "我心里危险的东西 第二季",
  originalTitle: null, aliases: [], subjectType: "tv", year: 2024, season: 2, coverUrl: null,
  confidence: 0.9, matchReasons: ["由用户选择第二季"], createdAt: now,
};
const responses = {
  get_work: detail, list_external_tools: [], list_library_roots: [], list_remote_sources: [], get_setting: null,
  list_match_candidates: [candidate],
  list_recognition_group_members: { scope: "season", title: "Show", folderPath: root, members: files.slice(1), linkedWorkId: null, linkedWorkTitle: null },
  get_anime_work_structure: {
    workId: "s1", bangumiId: "first-season", seasons: [], staff: [], characters: [], warnings: [], unmatchedFiles: files.slice(1),
    episodes: [{ provider: "bangumi", externalId: "ep1", episodeNumber: 1, sortNumber: 1, episodeType: 0, title: "第一集", airDate: null, duration: null, localFiles: [files[0]] }],
  },
};
const browser = await chromium.launch({
  executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(payload => {
    window.__confirmCalls = [];
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      convertFileSrc: value => value,
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === "confirm_match_candidate") {
          window.__confirmCalls.push(args);
          return "s2";
        }
        if (command === "get_media_thumbnail") return null;
        return payload[command] ?? null;
      },
    } });
  }, responses);
  const output = path.resolve("artifacts", "screenshots");
  await mkdir(output, { recursive: true });
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:4175/#/library/s1");
    await page.getByRole("button", { name: "识别到其他作品", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "识别动漫作品" });
    await dialog.getByText("本次关联 2 / 2 个文件", { exact: false }).waitFor();
    assert.equal(await dialog.locator(".recognition-member").count(), 2);
    assert.equal(await dialog.locator(".recognition-member input:checked").count(), 2);
    await dialog.getByText("已有官方分集或手动分集关联的文件会保留在原作品", { exact: false }).waitFor();
    const overflow = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < 0 || rect.right > innerWidth || element.scrollWidth > element.clientWidth + 1
        || [...element.querySelectorAll(".recognition-member, .candidate-row, .recognition-search")]
          .some(row => row.scrollWidth > row.clientWidth + 1);
    });
    assert.equal(overflow, false, `${width}x${height}: dialog overflow`);
    await page.screenshot({ path: path.join(output, `season-split-${width}x${height}.png`) });
    // Exclude one file and verify the frontend sends only the checked file.
    await dialog.locator(".recognition-member input").nth(1).uncheck();
    await dialog.getByRole("button", { name: "确认匹配", exact: true }).click();
    await page.waitForURL("**/#/library/s2");
    const submitted = await page.evaluate(() => window.__confirmCalls.at(-1));
    assert.deepEqual(submitted.selectedMediaIds, ["13"]);
    assert.equal(submitted.groupScope, "season");
    console.log(`${width}x${height}: preserved first-season scope, checkbox submission and layout passed`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
