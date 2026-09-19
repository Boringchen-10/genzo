// Mocked UI regression: no application database or real media is accessed.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const output = "artifacts/screenshots/mounted-thumbnails";
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#367b65"/></svg>');
      const file = {
        id: "mounted-file", workId: "mounted", libraryRootId: "root", path: "\\\\?\\UNC\\server\\Anime\\01.mkv",
        fileName: "[Group] Mounted Anime [01].mkv", extension: "mkv", mediaType: "video", size: 1800000000,
        missing: false, modifiedAt: now, createdAt: now, updatedAt: now, recognitionStatus: "matched",
        parsedTitle: "Mounted Anime", parsedEpisode: "1", parsedEpisodeStart: 1, parsedMediaInfo: "[]", thumbnailPath: null,
      };
      const work = {
        id: "mounted", title: "挂载缩略图回归测试", type: "video", status: "planned", favorite: false,
        rating: null, notes: "", tags: [], coverPath: null, bannerPath: null, description: "",
        createdAt: now, updatedAt: now, metadataStatus: "matched", mediaFiles: [file], subtitleLinks: [], fieldLocks: [], candidates: [],
        metadata: { provider: "bangumi", externalId: "subject", title: "挂载缩略图回归测试", fetchedAt: now },
      };
      globalThis.__thumbnailCalls = 0;
      Object.defineProperty(globalThis, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value,
        invoke: async command => {
          if (command === "get_work") return work;
          if (command === "list_external_tools") return [];
          if (command === "get_setting") return "dark";
          if (command === "get_anime_work_structure") return {
            workId: work.id, bangumiId: "subject", seasons: [], staff: [], characters: [], warnings: [], unmatchedFiles: [],
            episodes: [{ provider: "bangumi", externalId: "episode-1", episodeNumber: 1, sortNumber: 1,
              title: "第一集", description: "", fetchedAt: now, localFiles: [file] }],
          };
          if (command === "get_media_thumbnail") return ++globalThis.__thumbnailCalls === 1 ? null : image;
          return null;
        },
      } });
    });
    await page.goto(`${process.env.GENZO_PREVIEW_URL || "http://127.0.0.1:4177"}/#/library/mounted`);
    const card = page.locator(".official-episode");
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /重试 .* 的缩略图/ }).click();
    await page.waitForFunction(() => {
      const image = document.querySelector(".episode-snapshot-visual img");
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await page.evaluate(() => globalThis.__thumbnailCalls), 2);
    assert.equal(await card.count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${width}.png` });
    console.log(`${width}x${height}: mounted episode thumbnail retry and layout passed`);
    await page.close();
  }
} finally {
  await browser.close();
}
