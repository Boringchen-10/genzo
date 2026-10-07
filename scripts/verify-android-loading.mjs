import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { build } from "vite";

const output = "D:/DevTools/Android/Build/qa/loading-20261007";
mkdirSync(output, { recursive: true });
const baseline = execFileSync("git", ["show", "73c6d69:src/android/AndroidApp.tsx"], { encoding: "utf8" });
for (const variant of ["baseline", "current"]) {
  await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, plugins: variant === "baseline" ? [{ name: "qa-original-startup", load(id) { if (id.replaceAll("\\", "/").endsWith("/src/android/AndroidApp.tsx")) return baseline; } }] : [], build: { outDir: `${output}/${variant}`, emptyOutDir: false, lib: { entry: "scripts/fixtures/android-loading.tsx", name: "LoadingFixture", cssFileName: "fixture", formats: ["iife"], fileName: () => "fixture.js" } } });
}
const browser = await chromium.connectOverCDP("http://127.0.0.1:9228", { noDefaults: true });
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
const result = { baselineCommit: "73c6d69", scope: "React startup with controlled delays; not APK process cold start", delaysMs: { works: 80, groups: 900, sources: 1200, tasks: 1600, progress: 2200 }, baselineMs: [], currentMs: [] };
async function frame(variant, failure = false) {
  await page.evaluate(() => document.getElementById("qa-loading")?.remove());
  await page.evaluate(() => {
    const iframe = document.createElement("iframe"); iframe.id = "qa-loading";
    iframe.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:99999;background:#101719;border:0";
    iframe.srcdoc = '<html><head><base href="about:srcdoc"></head><body style="margin:0"><div id="root"></div></body></html>'; document.body.append(iframe);
  });
  const target = page.locator("#qa-loading").contentFrame();
  await target.locator("#root").waitFor({ state: "attached" });
  await target.locator("body").evaluate((body, { javascript, css, failure }) => {
    const win = body.ownerDocument.defaultView;
    win.__QA_FAIL_SOURCE__ = failure;
    const style = body.ownerDocument.createElement("style"); style.textContent = css; body.ownerDocument.head.append(style);
    win.Function(javascript)();
  }, { failure, javascript: readFileSync(`${output}/${variant}/fixture.js`, "utf8"), css: readFileSync(`${output}/${variant}/fixture.css`, "utf8") });
  return target;
}
async function settled(target) { await target.locator('.gz-cover').first().waitFor(); return target.locator("body").evaluate(node => node.ownerDocument.defaultView.__QA_LOADING__); }
try {
  assert.equal(await page.evaluate(() => window.__GENZO_FRONTEND_PREVIEW__), true);
  for (const variant of ["baseline", "current"]) for (let run = 0; run < 3; run++) {
    const target = await frame(variant);
    const data = await settled(target);
    result[`${variant}Ms`].push(Math.round(data.firstCoverMs));
    if (variant === "current") assert.ok(data.firstCoverMs < 800, "works must show before auxiliary reads finish");
  }
  let target = await frame("current", true);
  await target.getByRole("status", { name: "正在读取观看记录…", exact: true }).waitFor();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector("#qa-loading").contentDocument.querySelector(".gz-load-indicator")).opacity) > .95);
  await page.screenshot({ path: `${output}/loading.png` });
  await settled(target);
  assert.equal(await target.getByText("暂无观看记录。开始播放后，续播入口会出现在这里。", { exact: true }).count(), 0);
  await target.getByRole("alert").filter({ hasText: "测试来源暂时离线" }).waitFor();
  assert.ok(await target.locator(".gz-cover").count());
  result.sourceFailureKeepsLibrary = true;
  target = await frame("current");
  await settled(target);
  await target.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "发现" }).click();
  await target.getByRole("tab", { name: "漫画", exact: true }).click();
  await target.locator('[data-explore-cover-id="qa-book"]').first().click();
  const chapters = target.locator(".gz-online-chapters");
  await chapters.locator("[data-chapter-id]").first().waitFor();
  await chapters.getByRole("tab", { name: /单行本.*20/ }).waitFor();
  await chapters.getByRole("button", { name: "章节第 3 页" }).click();
  await target.locator('[data-chapter-id="default-201"]').waitFor();
  await target.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的" }).click();
  await target.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "发现" }).click();
  assert.equal(await chapters.getByRole("button", { name: "章节第 3 页" }).getAttribute("aria-current"), "page");
  await target.getByRole("button", { name: "返回发现", exact: true }).click();
  await target.locator('[data-explore-cover-id="qa-book"]').first().click();
  await target.locator('[data-chapter-id="default-201"]').waitFor();
  await chapters.getByRole("button", { name: "章节第 1 页" }).click();
  await target.locator('[data-chapter-id="default-1"]').waitFor();
  await chapters.getByRole("tab", { name: /单行本/ }).click();
  await target.locator('[data-chapter-id="volume-1"]').waitFor();
  const counts = await target.locator("body").evaluate(body => body.ownerDocument.defaultView.__QA_LOADING__.calls);
  for (const key of ["popular", "calendar", "comicHome", "bookDetail", "comments", "chapters:default:0", "chapters:default:200", "chapters:volume:0"]) assert.equal(counts[key], 1, `${key} must be reused`);
  result.fixtureReadCounts = counts;
  await target.locator("body").evaluate(body => body.ownerDocument.defaultView.__QA_LOADING__.changeReadingSource());
  await target.locator('[data-chapter-id="default-1"]').waitFor();
  assert.equal(await target.locator("body").evaluate(body => body.ownerDocument.defaultView.__QA_LOADING__.calls["chapters:default:0"]), 2);
  result.sourceChangeRefreshesChapters = true;
  await page.emulateMedia({ reducedMotion: "reduce" });
  target = await frame("current");
  await settled(target);
  const reducedLoader = target.getByRole("status", { name: "正在读取观看记录…", exact: true });
  assert.equal(await reducedLoader.evaluate(node => node.ownerDocument.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  assert.equal(await reducedLoader.locator(".gz-load-shape").evaluate(node => node.getAnimations({ subtree: true }).length), 0);
  result.reducedMotion = true;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => document.getElementById("qa-loading")?.remove());
  console.log("Controlled startup and session reuse checks passed", JSON.stringify(result));

  const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  async function snapshot() {
    const works = (await invoke("list_works")).map(({ id, status, rating, favorite }) => ({ id, status, rating, favorite })).sort((a, b) => a.id.localeCompare(b.id));
    return { count: works.length, hash: createHash("sha256").update(JSON.stringify(works)).digest("hex") };
  }
  const before = await snapshot();
  const work = (await invoke("list_works")).find(item => item.title === "魔都精兵的奴隸");
  assert.ok(work);
  await page.evaluate(id => { location.hash = `#/detail/${id}`; }, work.id);
  const localChapters = page.locator(".gz-scroll > .gz-online-chapters");
  await localChapters.locator("[data-chapter-id]").first().waitFor();
  await localChapters.getByRole("button", { name: "章节第 3 页" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".gz-scroll > .gz-online-chapters [data-chapter-id]").length === 14);
  const chapterId = await localChapters.locator("[data-chapter-id]").first().getAttribute("data-chapter-id");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "首页" }).click();
  await page.waitForFunction(() => location.hash === "#/home" && !document.querySelector(".gz-scroll > .gz-online-chapters"));
  await page.evaluate(id => { location.hash = `#/detail/${id}`; }, work.id);
  await localChapters.locator(`[data-chapter-id="${chapterId}"]`).waitFor();
  await page.waitForFunction(() => document.querySelector('.gz-scroll > .gz-online-chapters button[aria-label="章节第 3 页"]')?.getAttribute("aria-current") === "page");
  assert.equal(await localChapters.getByRole("button", { name: "章节第 3 页" }).getAttribute("aria-current"), "page");
  assert.equal(await page.getByRole("status", { name: "正在读取章节目录…", exact: true }).count(), 0);
  result.nativeChapterPageRetained = true;
  for (const width of [360, 412, 915]) {
    await page.setViewportSize({ width, height: 892 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector(".gz-scroll").scrollWidth > document.querySelector(".gz-scroll").clientWidth + 1), false);
  }
  await page.setViewportSize({ width: 412, height: 892 });
  await page.screenshot({ path: `${output}/cached-chapters.png` });
  const nav = () => page.getByRole("navigation", { name: "主导航" });
  await nav().getByRole("button", { name: "书架" }).click();
  await page.getByRole("button", { name: "搜索书架", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索书架", exact: true }).fill("魔都");
  await nav().getByRole("button", { name: "我的" }).click();
  await page.waitForFunction(() => location.hash === "#/profile" && !document.querySelector('input[aria-label="搜索书架"]'));
  await nav().getByRole("button", { name: "书架" }).click();
  assert.equal(await page.getByRole("searchbox", { name: "搜索书架", exact: true }).inputValue(), "魔都");
  result.nativeShelfSearchRetained = true;
  await page.getByRole("button", { name: "关闭搜索", exact: true }).click();
  await nav().getByRole("button", { name: "发现" }).click();
  await page.getByRole("tab", { name: "漫画", exact: true }).click();
  const explore = page.locator('.gz-kept-page:not([hidden])');
  await explore.getByRole("heading", { name: "推荐", exact: true }).waitFor();
  const loadedItems = await explore.locator("[data-explore-cover-id]").count();
  assert.ok(loadedItems > 0);
  const scrollTop = await page.locator(".gz-scroll").evaluate(node => { node.scrollTop = 380; return node.scrollTop; });
  await nav().getByRole("button", { name: "我的" }).click();
  await page.waitForFunction(() => document.querySelector('.gz-kept-page[hidden] .gz-explore-tabs') !== null);
  await nav().getByRole("button", { name: "发现" }).click();
  await explore.getByRole("heading", { name: "推荐", exact: true }).waitFor();
  assert.equal(await explore.getByRole("tab", { name: "漫画", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await explore.locator("[data-explore-cover-id]").count(), loadedItems);
  assert.ok(Math.abs(await page.locator(".gz-scroll").evaluate(node => node.scrollTop) - scrollTop) < 2);
  assert.equal(await explore.locator(".gz-load-indicator").count(), 0);
  result.nativeExploreRetained = { items: loadedItems, scrollTop };
  await nav().getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "网络", exact: true }).click();
  await page.getByRole("heading", { name: "Bangumi 数据源", exact: true }).waitFor();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "网络", exact: true }).click();
  await page.getByRole("heading", { name: "Bangumi 数据源", exact: true }).waitFor();
  assert.equal(await page.getByRole("status", { name: "正在读取网络设置…", exact: true }).count(), 0);
  result.nativeNetworkRetained = true;
  const after = await snapshot();
  assert.deepEqual(after, before);
  result.nativeData = before;
  result.errors = errors;
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log("Emulator checks passed; result:", `${output}/result.json`);
} finally {
  await page.emulateMedia({ reducedMotion: "no-preference" }).catch(() => {});
  await page.evaluate(() => document.getElementById("qa-loading")?.remove()).catch(() => {});
  await browser.close();
}
