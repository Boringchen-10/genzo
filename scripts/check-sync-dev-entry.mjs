// Check the browser/desktop boundary without invoking a user's native database.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.GENZO_EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.GENZO_PREVIEW_URL || "http://127.0.0.1:1420/");
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("tab", { name: "个人同步", exact: true }).click();
  await page.getByText("浏览器预览没有本机数据库与安全凭据能力。", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "创建同步空间", exact: true }).count(), 0);
  const windows = [];
  await mkdir("artifacts/sync-dev-integration/screenshots", { recursive: true });
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator(".settings-drawer").evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await page.screenshot({ path: `artifacts/sync-dev-integration/screenshots/preview-${width}x${height}.png` });
    windows.push({ width, height, horizontalOverflow: false });
  }
  assert.deepEqual(errors, []);
  await writeFile("artifacts/sync-dev-integration/browser-results.json", JSON.stringify({ browserCannotClaimNativeSync: true, errors, windows }, null, 2));
  console.log("Browser preview gives desktop startup instructions; three settings sizes passed");
} finally {
  await browser.close();
}
