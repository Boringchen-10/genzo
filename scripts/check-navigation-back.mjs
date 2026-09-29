import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4189";
const createdAt = new Date().toISOString();
const makeWork = (id, title, type) => ({
  id, title, type, category: type, originalTitle: null, description: "", coverPath: null,
  status: "planned", favorite: true, rating: null, notes: "", tags: [], mediaCount: 1,
  missingCount: 0, createdAt, updatedAt: createdAt, metadataStatus: "manually_created",
  metadataYear: null, lastRecognizedAt: null, mediaFiles: [], fieldLocks: [], candidates: [],
  subtitleLinks: [], metadata: null,
});
const works = [makeWork("book", "暑假的测试作品", "novel"), makeWork("video", "测试动画", "video")];
const browser = await chromium.launch({
  executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});

async function newPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(works => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command === "list_works") return works;
        if (command === "get_work") return works.find(work => work.id === args.id);
        if (command === "get_dashboard") return { totalWorks: works.length, recentWorks: works, favoriteWorks: works, lastScan: null, videoCount: 1, comicCount: 0, novelCount: 1, gameCount: 0, otherCount: 0, favoriteCount: 2, missingFileCount: 0 };
        if (command === "get_playback_progress") return { items: [], sessions: [] };
        if (command === "get_explore_overview") return { trending: [] };
        if (command === "get_setting") return "dark";
        if (command.startsWith("list_")) return [];
        return null;
      },
    } });
  }, works);
  return { page, errors };
}

async function assertRoute(page, hash) {
  await page.waitForFunction(expected => location.hash === expected, hash);
  assert.equal(new URL(page.url()).hash, hash);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, `${hash} has horizontal overflow`);
}

try {
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const { page, errors } = await newPage(width, height);
    try {
      await page.goto(`${base}/#/library`);
      await page.getByRole("link", { name: "书架", exact: true }).click();
      await page.getByRole("link", { name: /暑假的测试作品/ }).first().waitFor();
      const scope = page.locator('.scope-tabs[aria-label="书架范围"]');
      if (await scope.count()) {
        await scope.getByRole("button", { name: "最近添加" }).click();
        await page.waitForFunction(() => location.hash.includes("scope=recent"));
      }
      const origin = new URL(page.url()).hash;
      await page.getByRole("link", { name: /暑假的测试作品/ }).first().click();
      await page.getByRole("button", { name: "返回上一页" }).click();
      await assertRoute(page, origin);
      if (await scope.count()) {
        await page.waitForFunction(() => document.querySelector('.scope-tabs[aria-label="书架范围"] button.active')?.textContent?.includes("最近添加"));
      }

      await page.getByRole("link", { name: /暑假的测试作品/ }).first().click();
      const client = await page.context().newCDPSession(page);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "back", x: 500, y: 200, clickCount: 1 });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "back", x: 500, y: 200, clickCount: 1 });
      await assertRoute(page, origin);

      await page.getByRole("link", { name: "收藏", exact: true }).click();
      await page.getByRole("link", { name: /测试动画/ }).first().click();
      await page.getByRole("button", { name: "返回上一页" }).click();
      await assertRoute(page, "#/favorites");

      await page.getByRole("link", { name: "媒体库", exact: true }).click();
      await page.getByRole("link", { name: /测试动画/ }).first().waitFor();
      const libraryScope = page.locator('.scope-tabs[aria-label="媒体库范围"]');
      await libraryScope.getByRole("button", { name: "最近添加" }).click();
      await page.waitForFunction(() => location.hash.includes("scope=recent"));
      const libraryOrigin = new URL(page.url()).hash;
      await page.getByRole("link", { name: /测试动画/ }).first().click();
      await page.getByRole("button", { name: "返回上一页" }).click();
      await assertRoute(page, libraryOrigin);
      await page.waitForFunction(() => document.querySelector('.scope-tabs[aria-label="媒体库范围"] button.active')?.textContent?.includes("最近添加"));

      await page.getByRole("tab", { name: /待整理/ }).click();
      await page.waitForFunction(() => location.hash.includes("tab=inbox"));
      const inboxOrigin = new URL(page.url()).hash;
      await page.goto(`${base}/#/library/video`);
      await page.goBack();
      await assertRoute(page, inboxOrigin);
      assert.deepEqual(errors, []);
      console.log(`${width}x${height}: detail button, mouse back, and previous view passed`);
    } finally {
      await page.close();
    }
  }

  for (const [id, fallback] of [["book", "#/bookshelf"], ["video", "#/library"]]) {
    const { page, errors } = await newPage(1366, 768);
    try {
      await page.goto(`${base}/#/library/${id}`);
      await page.getByRole("button", { name: "返回上一页" }).click();
      await assertRoute(page, fallback);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  console.log("direct detail fallback: passed");
} finally {
  await browser.close();
}
