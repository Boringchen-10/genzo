// Isolated browser fixture. No user database, media, credentials or remote artwork.
// Start Vite on port 4175 before running.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const image = (width, height, color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><path d="M0 0L${width} ${height}M0 ${height}L${width} 0" stroke="#e4d7bd" stroke-width="12"/></svg>`)}`;
const cover = image(780, 1170, "#496b75");
const thumb = image(600, 900, "#3b656f");
const banner = image(3840, 2160, "#4b6562");
const categories = ["anime", "movie", "tv", "comic", "novel", "video"];
const labels = ["动漫", "电影", "电视剧", "漫画", "小说", "未分类视频"];
const works = categories.map((category, index) => ({
  id: String(index), title: `${labels[index]}示例作品`, originalTitle: null,
  type: ["comic", "novel"].includes(category) ? category : "video", category,
  description: "隔离验证品类标签、海报缩略图与原尺寸背景。", coverPath: cover,
  coverThumbnailPath: thumb, bannerPath: banner, status: "planned", favorite: false,
  rating: null, notes: "", tags: [], mediaCount: 12, missingCount: 0,
  metadataStatus: "matched", metadataYear: 2026, createdAt: "2026-09-25", updatedAt: "2026-09-25",
}));
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ works }) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async command => {
        if (command === "list_works") return works;
        if (command === "get_dashboard") return { totalWorks: 6, recentWorks: works, favoriteWorks: [], lastScan: null, videoCount: 4, comicCount: 1, novelCount: 1, gameCount: 0, otherCount: 0, favoriteCount: 0, missingFileCount: 0 };
        if (command.startsWith("list_")) return [];
        return null;
      },
    } });
  }, { works });
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:4175/#/library", { waitUntil: "domcontentloaded" });
    await page.locator(".type-badge").first().waitFor();
    assert.deepEqual(await page.locator(".type-badge").allTextContents(), labels);
    const poster = page.locator(".poster-frame img").first();
    assert.equal(await poster.getAttribute("src"), thumb);
    assert.equal(await poster.evaluate(node => getComputedStyle(node).filter), "none");
    await poster.dispatchEvent("error");
    await page.waitForFunction(source => document.querySelector(".poster-frame img")?.getAttribute("src") === source, cover);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/screenshots/category-library-${width}.png` });
    await page.goto("http://127.0.0.1:4175/#/", { waitUntil: "domcontentloaded" });
    await page.locator(".gnz-shelf-type").first().waitFor();
    assert.deepEqual(await page.locator(".gnz-shelf-type").allTextContents(), labels);
    const background = await page.locator(".seanime-banner-image").evaluate(node => ({ image: getComputedStyle(node).backgroundImage, filter: getComputedStyle(node).filter }));
    assert.equal(background.filter, "none");
    assert.ok(background.image.includes("3840"));
    await page.screenshot({ path: `artifacts/screenshots/category-home-${width}.png` });
    console.log(`${width}x${height}: category badges, thumbnail fallback and neutral original backdrop passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
