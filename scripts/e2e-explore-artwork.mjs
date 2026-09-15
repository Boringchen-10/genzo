import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const candidates = browser
  .contexts()
  .flatMap((context) => context.pages())
  .filter((page) => page.url().startsWith("http://127.0.0.1:1420"));

let page;
for (const candidate of candidates.reverse()) {
  try {
    const available = await candidate.evaluate(() => Boolean(globalThis.__TAURI_INTERNALS__?.invoke));
    if (available) {
      page = candidate;
      break;
    }
  } catch {
    // A stale WebView target can remain visible briefly while Tauri restarts.
  }
}
if (!page) throw new Error("No live Genzo Tauri WebView was exposed on port 9223.");

const invoke = (command, args = {}) => page.evaluate(
  ({ commandName, commandArgs }) => globalThis.__TAURI_INTERNALS__.invoke(commandName, commandArgs),
  { commandName: command, commandArgs: args },
);
const screenshots = path.resolve("artifacts", "screenshots");
await mkdir(screenshots, { recursive: true });

const first = await invoke("get_explore_overview", { year: 2026, month: 1 });
if (first.seasonal.length < 8) throw new Error("January 2026 seasonal data is unexpectedly empty.");
const firstCovers = first.seasonal.filter((item) => item.coverUrl).length;
const firstBanners = first.seasonal.filter((item) => item.bannerUrl).length;
const missingCovers = first.seasonal
  .filter((item) => !item.coverUrl)
  .map((item) => ({ externalId: item.externalId, title: item.title }));
if (firstCovers < Math.ceil(first.seasonal.length * 0.75)) {
  throw new Error(`Too few seasonal covers were prefetched: ${firstCovers}/${first.seasonal.length}.`);
}
if (firstBanners === 0) throw new Error("AniList did not supply any seasonal backdrop artwork.");

await page.waitForTimeout(2_500);
const second = await invoke("get_explore_overview", { year: 2026, month: 1 });
const localCovers = second.seasonal.filter((item) => item.coverUrl && !/^https?:/i.test(item.coverUrl)).length;
if (localCovers === 0) throw new Error("No prefetched cover reached the local cache.");

await page.evaluate(() => { globalThis.location.hash = "#/explore"; });
await page.waitForSelector(".gnz-explore-page");
await page.locator(".gnz-filter-selects select").nth(0).selectOption("2026");
await page.locator(".gnz-filter-selects select").nth(1).selectOption("1");
await page.getByRole("tab", { name: "本季" }).click();
await page.waitForSelector(".gnz-explore-card img", { timeout: 30_000 });
await page.waitForFunction(() => {
  const images = [...document.querySelectorAll(".gnz-explore-card img")].slice(0, 8);
  return images.length >= 6 && images.every((image) => image.complete && image.naturalWidth >= 400);
}, null, { timeout: 30_000 });

await page.locator(".gnz-explore-card").first().click();
await page.waitForSelector(".modal");
await page.waitForTimeout(1_000);
const fatalDetailError = await page.locator(".gnz-explore-detail-error").count();
if (fatalDetailError) {
  throw new Error(`Explore detail still failed: ${await page.locator(".gnz-explore-detail-error").innerText()}`);
}
await page.keyboard.press("Escape");

for (const size of [
  { width: 1024, height: 640 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  await page.setViewportSize(size);
  await page.evaluate(() => {
    globalThis.scrollTo(0, 0);
    document.querySelector(".main-content")?.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    brokenImages: [...document.querySelectorAll(".gnz-explore-card img")]
      .filter((image) => image.complete && image.naturalWidth === 0).length,
  }));
  if (layout.scrollWidth > layout.viewport + 1 || layout.brokenImages > 0) {
    throw new Error(`Explore layout failed at ${size.width}x${size.height}: ${JSON.stringify(layout)}`);
  }
  await page.screenshot({
    path: path.join(screenshots, `genzo-explore-artwork-${size.width}x${size.height}.png`),
    fullPage: false,
  });
}

console.log(JSON.stringify({
  seasonal: first.seasonal.length,
  firstCovers,
  firstBanners,
  localCovers,
  missingCovers,
  sources: [...new Set(first.seasonal.flatMap((item) => item.sourceKeys ?? []))],
  screenshots,
}, null, 2));
await browser.close();
