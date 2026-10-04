// Synthetic IPC and artwork only. Start a production preview before running.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4192";
const output = "artifacts/rating-perspective";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/qa/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#46495d"/><circle cx="600" cy="300" r="220" fill="#73738c"/><path d="M0 800L800 400V1200H0Z" fill="#666e78"/></svg>' });
      return url.origin === base ? route.continue() : route.abort();
    });
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const mode = new URLSearchParams(location.search).get("rating") || "votes";
      const counts = [2, 0, 1, 5, 8, 20, 40, 70, 38, 16];
      const work = { id: "rating-work", title: "评分透视界面验证", originalTitle: "Synthetic rating fixture", type: mode === "book" ? "comic" : "video", category: mode === "book" ? "comic" : "anime", description: "这是一段用于核对左右布局的作品简介。简介与标签保留在左侧一半，右侧以实际票数展示一至十分的评分分布。较长的说明沿用现有展开入口，避免挤压章节与文件。", coverPath: "/qa/cover", bannerPath: "/qa/backdrop", status: "planned", favorite: true, rating: 9, notes: "保留已有个人数据", tags: ["日常", "剧情", "原创"], mediaCount: 0, missingCount: 0, metadataStatus: "matched", metadataYear: 2026, createdAt: now, updatedAt: now, lastRecognizedAt: now };
      window.__ratingCalls = [];
      window.__TAURI_INTERNALS__ = {
        convertFileSrc: path => path, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args) => {
          window.__ratingCalls.push({ command, args });
          if (command === "list_works") return [work];
          if (command === "get_work") return { ...work, fieldLocks: [], candidates: [], subtitleLinks: [], metadata: { provider: "bangumi", externalId: "123", title: work.title }, mediaFiles: [], networkScore: mode === "missing" ? null : mode === "zero" ? 0 : 7.5, networkScoreProvider: mode === "tmdb" ? "tmdb" : mode === "missing" ? null : "bangumi", networkRatingCount: mode === "zero" ? 0 : mode === "missing" ? null : 200, ...(mode === "legacy" || mode === "tmdb" || mode === "missing" ? {} : { networkRatingDistribution: mode === "zero" ? Array(10).fill(0) : mode === "invalid" ? [1, 2] : counts }) };
          if (command === "get_anime_work_structure") return { workId: work.id, bangumiId: "123", episodes: [], seasons: [], staff: [], characters: [], warnings: [], unmatchedFiles: [] };
          if (command === "get_playback_progress") return { items: [], sessions: [] };
          if (command === "get_book_entries") return [];
          if (command === "get_book_entry_order") return { direction: "asc", entryIds: [] };
          if (command === "get_setting") return null;
          if (command.startsWith("list_")) return [];
          return null;
        },
      };
    });
    const open = async (mode = "votes") => {
      await page.goto(`${base}/?rating=${mode}#/${mode === "book" ? "bookshelf" : "library"}/rating-work`, { waitUntil: "domcontentloaded" });
      await page.locator(".rating-perspective").waitFor();
      await page.locator(".rating-perspective").scrollIntoViewIfNeeded();
      await page.waitForFunction(dark => document.documentElement.classList.contains("dark") === dark, theme === "dark");
    };
    for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await open();
      assert.equal(await page.locator(".rating-perspective-bucket").count(), 10);
      assert.deepEqual(await page.locator(".rating-perspective-tick").allTextContents(), Array.from({ length: 10 }, (_, i) => String(i + 1)));
      const left = await page.locator(".detail-toprow-left").boundingBox();
      const right = await page.locator(".rating-perspective").boundingBox();
      assert.ok(Math.abs(left.width - right.width) < 1, "synopsis and rating occupy equal columns");
      assert.ok(right.x > left.x + left.width, "rating stays to the right of the synopsis");
      const bars = await page.locator(".rating-perspective-bar").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
      assert.equal(bars[1], 0, "zero votes must not show a bar");
      assert.equal(bars[7], 140, "largest bucket uses the full chart height");
      assert.ok(Math.abs(bars[6] / bars[7] - 40 / 70) < .001, "bar heights follow actual vote counts");
      assert.match(await page.locator(".rating-perspective-summary").innerText(), /7\.5\s+Bangumi/);
      assert.equal(await page.locator(".rating-perspective-count").innerText(), "200 人评价");
      assert.equal(await page.getByRole("radiogroup", { name: "我的评分" }).count(), 0);
      assert.equal(await page.locator(".reader-star").count(), 0);
      const bucket = page.getByRole("img", { name: "7 分：40 人，占 20.0%", exact: true });
      await bucket.hover();
      assert.equal(await bucket.locator(".rating-perspective-tooltip").evaluate(node => getComputedStyle(node).opacity), "1");
      await page.mouse.move(0, 0);
      await bucket.focus();
      assert.equal(await bucket.locator(".rating-perspective-tooltip").evaluate(node => getComputedStyle(node).opacity), "1");
      await bucket.evaluate(node => node.blur());
      for (const index of [0, 9]) {
        const item = page.locator(".rating-perspective-bucket").nth(index);
        await item.hover();
        const tooltip = await item.locator(".rating-perspective-tooltip").boundingBox();
        assert.ok(tooltip.x >= 0 && tooltip.x + tooltip.width <= width, "edge tooltips remain inside the viewport");
      }
      await page.mouse.move(0, 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await page.locator(".detail-toprow").screenshot({ path: `${output}/${theme}-${width}.png` });
      console.log(`${theme} ${width}x${height}: vote counts, tooltip, equal columns and overflow passed`);
    }
    for (const mode of ["legacy", "tmdb", "missing", "invalid"]) {
      await open(mode);
      assert.equal(await page.locator(".rating-perspective-bar").count(), 0);
      assert.equal(await page.locator(".rating-perspective-empty p").innerText(), "暂无评分分布");
      if (mode === "legacy") assert.match(await page.locator(".rating-perspective-summary").innerText(), /7\.5\s+Bangumi/);
      if (mode === "tmdb") assert.match(await page.locator(".rating-perspective-empty").innerText(), /当前来源未提供/);
      if (mode === "missing") assert.match(await page.locator(".rating-perspective-summary").innerText(), /暂无评分/);
    }
    await open("zero");
    assert.equal(await page.locator(".rating-perspective-bucket").count(), 10);
    assert.ok((await page.locator(".rating-perspective-bar").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).every(height => height === 0));
    assert.equal(await page.locator(".rating-perspective-count").innerText(), "尚无人评分");
    await open("book");
    assert.equal(await page.locator(".rating-perspective-bucket").count(), 10);
    assert.equal(await page.evaluate(() => window.__ratingCalls.some(call => ["update_work", "set_work_field_lock", "delete_work"].includes(call.command))), false, "viewing the rating must not change personal data");
    assert.deepEqual(errors, []);
    console.log(`${theme}: old caches, unsupported sources, no votes and bookshelf passed`);
    await context.close();
  }
} finally { await browser.close(); }
