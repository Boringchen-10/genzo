// UI regression fixture only; uses no real media files or application database.
// Run against `npm run preview -- --host 127.0.0.1 --port 4177`.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const now = new Date().toISOString();
const files = ["[ReinForce] Kiss×sis - 01 (BDRip 1920x1080).mkv", "[ReinForce] Kiss×sis - OAD 01 (BDRip 1920x1080).mkv"].map((fileName, index) => ({
  id: `media-${index}`, workId: "tv", libraryRootId: "root", path: `C:\\Anime\\Kiss×sis\\${fileName}`, fileName,
  extension: "mkv", mediaType: "video", size: 1800000000, missing: false, modifiedAt: now, createdAt: now, updatedAt: now,
  recognitionStatus: "matched", parsedTitle: "Kiss×sis", parsedSeason: null, parsedEpisode: "1", parsedEpisodeStart: 1,
  parsedEpisodeEnd: null, parsedSpecialType: index ? "OAD" : null, parsedMediaInfo: "[]", thumbnailPath: null,
}));
const candidate = {
  id: "candidate-oad", mediaFileId: "media-1", provider: "bangumi", externalId: "oad-subject", title: "亲吻姐姐 OAD",
  originalTitle: "Kiss×sis OAD", aliases: [], subjectType: "ova", year: 2008, season: null, coverUrl: null,
  confidence: 0.79, matchReasons: ["特别篇需确认"], createdAt: now,
};
const work = {
  id: "tv", title: "亲吻姐姐 TV", originalTitle: "Kiss×sis", type: "video", status: "planned", favorite: false,
  rating: null, notes: "", tags: [], coverPath: null, bannerPath: null, description: "混合季度与特别篇修复测试",
  createdAt: now, updatedAt: now, metadataStatus: "matched", metadataYear: 2010,
  mediaFiles: files, subtitleLinks: [], fieldLocks: [], candidates: [],
  metadata: { provider: "bangumi", externalId: "tv-subject", title: "亲吻姐姐 TV", fetchedAt: now },
};
const episode = {
  provider: "bangumi", externalId: "episode-1", episodeNumber: 1, sortNumber: 1, title: "Wonderful Days",
  originalTitle: null, description: "", airDate: "2010-04-05", duration: "00:23:50", fetchedAt: now, localFiles: [],
};
const browser = await chromium.launch({
  executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const output = "artifacts/screenshots/installment-split";
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ work, files, episode, candidate }) => {
      let searched = false;
      globalThis.__splitCalls = [];
      Object.defineProperty(globalThis, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value,
        invoke: async (command, args) => {
          globalThis.__splitCalls.push({ command, args });
          if (command === "get_work") return { ...work, candidates: searched ? [candidate] : [] };
          if (command === "list_external_tools") return [];
          if (command === "get_setting") return "dark";
          if (command === "get_anime_work_structure") return {
            workId: "tv", bangumiId: "tv-subject", seasons: [], staff: [], characters: [], episodes: [episode],
            unmatchedFiles: files, warnings: ["检测到不同季度或特别篇，请识别到其他作品。"],
          };
          if (command === "recognize_media_file") { searched = true; return { mediaFileId: "media-1", status: "candidate_pending", candidates: [candidate] }; }
          if (command === "confirm_match_candidate") return "oad";
          if (command === "list_match_candidates") return [candidate];
          return null;
        },
      } });
    }, { work, files, episode, candidate });
    await page.goto(`${process.env.GENZO_PREVIEW_URL || "http://127.0.0.1:4177"}/#/library/tv`);
    const row = page.locator(".unmatched-row").filter({ hasText: "OAD" });
    await row.waitFor();
    await row.scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      outsideRows: [...document.querySelectorAll(".unmatched-row")].some(row => {
        const bounds = row.getBoundingClientRect();
        return [...row.children].some(child => { const r = child.getBoundingClientRect(); return r.left < bounds.left || r.right > bounds.right; });
      }),
    }));
    assert.deepEqual(layout, { overflow: false, outsideRows: false });
    await page.screenshot({ path: `${output}/files-${width}.png` });
    await row.getByRole("button", { name: "识别到其他作品", exact: true }).click();
    await page.getByRole("button", { name: "按文件名识别" }).click();
    await page.getByRole("button", { name: "确认匹配" }).waitFor();
    await page.screenshot({ path: `${output}/recognition-${width}.png` });
    await page.getByRole("button", { name: "确认匹配" }).click();
    await page.waitForURL("**/#/library/oad");
    const confirmed = await page.evaluate(() => globalThis.__splitCalls.find(call => call.command === "confirm_match_candidate"));
    assert.equal(confirmed.args.mediaFileId, "media-1");
    assert.equal(confirmed.args.candidateId, "candidate-oad");
    assert.deepEqual(errors, []);
    console.log(`${width}x${height}: layout, recognition and target-detail navigation passed`);
    await page.close();
  }
} finally {
  await browser.close();
}
