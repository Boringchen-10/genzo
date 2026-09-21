// Isolated fixtures: no real library, files, or external metadata requests.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
await mkdir("artifacts/screenshots/explore-v042", { recursive: true });
try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      globalThis.__overviewCalls = [];
      const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="450"><rect width="320" height="450" fill="#367b65"/></svg>');
      Object.defineProperty(globalThis, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value,
        invoke: async (command, args) => {
          if (command === "get_explore_overview") {
            globalThis.__overviewCalls.push(args);
            await new Promise(resolve => setTimeout(resolve, args.year === 2025 ? 700 : 50));
            const items = Array.from({ length: 80 }, (_, index) => ({ provider: "bangumi", externalId: String(index + 1), title: `${args.year ?? 2026} 测试作品 ${index + 1}`, aliases: [], description: "测试资料", coverUrl: image, year: args.year ?? 2026, month: 7, subjectType: "tv", genres: ["奇幻"], score: 8, rank: index + 1, ratingCount: 100, collectionCount: 100, inLibrary: false, favorite: false, fetchedAt: "2026-09-21", stale: false, sourceKeys: ["bangumi-data"] }));
            return { year: args.year ?? 2026, month: args.month ?? 7, seasonal: items, trending: items.slice(0, 12), availableTags: ["奇幻"], sources: [], fetchedAt: "2026-09-21", stale: false };
          }
          if (command === "get_anime_ranking") return [];
          if (command === "get_setting") return null;
          return [];
        },
      } });
    });
    await page.goto(`${process.env.GENZO_PREVIEW_URL || "http://127.0.0.1:4180"}/#/explore`);
    await page.locator(".gnz-explore-card").first().waitFor();
    assert.equal(await page.evaluate(() => globalThis.__overviewCalls.length), 1);
    await page.getByRole("tab", { name: "本季", exact: true }).click();
    assert.equal(await page.locator(".gnz-explore-card").count(), 48);
    await page.getByRole("button", { name: /加载更多作品/ }).click();
    assert.equal(await page.locator(".gnz-explore-card").count(), 80);
    await page.getByLabel("按年份筛选").selectOption("2025");
    await page.getByLabel("按年份筛选").selectOption("2026");
    await page.waitForTimeout(900);
    assert.match(await page.locator(".gnz-explore-card").first().innerText(), /2026 测试作品/);
    assert.equal(await page.locator(".gnz-explore-card").count(), 48);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `artifacts/screenshots/explore-v042/${width}x${height}.png` });
    await page.close();
    console.log(`Explore pagination and stale-response protection passed: ${width}x${height}`);
  }
} finally { await browser.close(); }
