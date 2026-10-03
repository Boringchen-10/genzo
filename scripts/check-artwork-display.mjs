// Production-page fixture: synthetic artwork/IPC only, no real media or account.
// Start `vite preview --port 4187 --strictPort` before running.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const output = "artifacts/artwork-display";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  for (const dpr of [1, 2, 3]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    let failOriginal = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/qa/")) {
        if (url.pathname === "/qa/poster-original" && failOriginal) return route.fulfill({ status: 404, body: "missing" });
        const poster = url.pathname.includes("poster");
        const small = url.pathname.includes("thumb");
        const [w, h] = poster ? (small ? [600, 750] : [1200, 1500]) : [1920, 1080];
        return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${poster ? '#446a7c' : '#446c50'}"/><rect x="8" y="8" width="${w-16}" height="${h-16}" fill="none" stroke="white" stroke-width="8"/><text x="30" y="70" fill="white" font-size="45">${poster ? 'POSTER — TOP EDGE' : 'LANDSCAPE'}</text><text x="30" y="${h-30}" fill="white" font-size="45">BOTTOM EDGE</text></svg>` });
      }
      return url.origin === base ? route.continue() : route.abort();
    });
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const cover = "C:/Genzo/covers/art-v2-qa-cover.jpg";
      const works = ["film", "no-banner"].map(id => ({ id, title: id === "film" ? "海报与横图隔离验证" : "没有横图的作品", originalTitle: null, type: "video", category: "movie", description: "图片比例和高 DPI 显示测试。", coverPath: cover, coverThumbnailPath: "C:/Genzo/covers/art-v2-qa-cover-thumb.jpg", bannerPath: id === "film" ? "/qa/backdrop" : null, status: "planned", favorite: false, rating: null, notes: "", tags: [], mediaCount: 1, missingCount: 0, metadataStatus: "matched", metadataYear: 2026, createdAt: now, updatedAt: now }));
      window.__artworkCalls = [];
      window.__TAURI_INTERNALS__ = {
        convertFileSrc: path => path === cover ? "/qa/poster-original" : path.includes("-thumb.jpg") ? "/qa/poster-thumb" : path,
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args) => {
          window.__artworkCalls.push({ command, args });
          if (command === "list_works") return works;
          if (command === "get_work") {
            const work = works.find(w => w.id === args.id);
            return { ...work, fieldLocks: ["coverPath"], candidates: [], subtitleLinks: [], metadata: { provider: "tmdb", externalId: "movie/42", title: work.title }, mediaFiles: [{ id: work.id + "-file", workId: work.id, libraryRootId: "r", path: "C:/Video/film.mkv", fileName: "film.mkv", extension: "mkv", mediaType: "video", size: 1000, missing: false, thumbnailPath: null, recognitionStatus: "matched", createdAt: now, updatedAt: now, parsedMediaInfo: "" }] };
          }
          if (command === "get_anime_work_structure") return { workId: args.workId, bangumiId: null, episodes: [], seasons: [], staff: [], characters: [], warnings: [], unmatchedFiles: [] };
          if (command === "get_media_thumbnail") return args.mediaFileId === "film-file" ? "/qa/frame" : null;
          if (command === "get_playback_progress") return { items: [], sessions: [] };
          if (command === "get_dashboard") return { totalWorks: 2, recentWorks: works, favoriteWorks: [], lastScan: null, videoCount: 2, comicCount: 0, novelCount: 0, gameCount: 0, otherCount: 0, favoriteCount: 0, missingFileCount: 0 };
          if (command === "get_setting") return null;
          if (command.startsWith("list_")) return [];
          return null;
        },
      };
    });
    for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/#/library`, { waitUntil: "domcontentloaded" });
      const poster = page.locator(".poster-frame img").first();
      await poster.waitFor();
      assert.equal(await poster.evaluate(img => getComputedStyle(img).objectFit), "contain");
      const frame = await page.locator(".poster-frame").first().boundingBox();
      assert.ok(Math.abs(frame.width / frame.height - 2 / 3) < .005);
      await page.goto(`${base}/#/library/film`, { waitUntil: "domcontentloaded" });
      const detail = page.locator(".detail-cover img");
      await detail.waitFor();
      const box = await page.locator(".detail-cover .media-visual").boundingBox();
      const expected = box.width * dpr > 600 || box.height * dpr > 900 ? "/qa/poster-original" : "/qa/poster-thumb";
      await page.waitForFunction(src => document.querySelector(".detail-cover img")?.getAttribute("src") === src, expected);
      const fileImage = page.locator(".detail-file-visual img");
      await page.locator(".detail-file-visual").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector(".detail-file-visual img")?.getAttribute("src") === "/qa/frame");
      assert.equal(await fileImage.evaluate(img => getComputedStyle(img).objectFit), "contain");
      assert.ok((await page.locator(".detail-page").getAttribute("style")).includes("/qa/backdrop"));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      if (dpr === 3 && width === 1024) {
        await page.locator(".detail-cover").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/detail-${width}-dpr${dpr}.png` });
        failOriginal = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.querySelector(".detail-cover img")?.getAttribute("src") === "/qa/poster-thumb");
        failOriginal = false;
        await page.getByRole("button", { name: "重试图片", exact: true }).click();
        await page.waitForFunction(() => document.querySelector(".detail-cover img")?.getAttribute("src") === "/qa/poster-original");
      }
      await page.goto(`${base}/#/library/no-banner`, { waitUntil: "domcontentloaded" });
      await page.locator(".detail-cover img").waitFor();
      assert.equal((await page.locator(".detail-page").getAttribute("style")) || "", "");
      await page.locator(".detail-file-visual").scrollIntoViewIfNeeded();
      await page.locator(".detail-file-visual .media-placeholder").waitFor();
      assert.equal(await page.locator(".detail-file-visual img").count(), 0);
      console.log(`${width}x${height} DPR ${dpr}: poster ratio/source, landscape frame, missing artwork and overflow passed`);
    }
    if (dpr === 3) {
      await page.goto(`${base}/#/library`, { waitUntil: "domcontentloaded" });
      const visual = page.locator(".poster-frame .media-visual").first();
      await visual.waitFor();
      await visual.evaluate(node => { node.style.width = "240px"; node.style.height = "360px"; });
      await page.waitForFunction(() => document.querySelector(".poster-frame img")?.getAttribute("src") === "/qa/poster-original");
      await visual.evaluate(node => { node.style.width = "100px"; node.style.height = "150px"; });
      await page.waitForFunction(() => document.querySelector(".poster-frame img")?.getAttribute("src") === "/qa/poster-thumb");
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
