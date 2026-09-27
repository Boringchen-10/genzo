// Isolated Tauri fixture: no real database, media, credentials or network providers.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
const now = "2026-09-27T00:00:00Z";
const root = String.raw`\\?\UNC\RaiDrive-Administrator\share\Anime`;
const files = [["1", 1, null], ["2", 1, null], ["13", 2, null], ["14", 2, null], ["ed", null, "NCED"]].map(([id, season, special]) => ({
  id, workId: null, libraryRootId: "root", path: `${root}\\Show\\Show [${id}].mkv`, fileName: `Show [${id}].mkv`, extension: "mkv", mediaType: "video", size: 100, missing: false,
  createdAt: now, updatedAt: now, recognitionStatus: "candidate_pending", parsedTitle: "示例作品", parsedSeason: season, parsedSpecialType: special, parsedEpisodeStart: Number(id) || null,
}));
const groups = [["1", "第一季", ["1", "2"]], ["13", "第二季", ["13", "14"]], ["ed", "NCED", ["ed"]]].map(([id, title, ids]) => ({ key: id, title, ids, representative: files.find(file => file.id === id), folderPath: `${root}\\Show`, mediaType: "video", fileCount: ids.length, missingCount: 0, totalSize: 100, recognitionStatus: "candidate_pending" }));
const candidates = Object.fromEntries(groups.map(group => [group.key, [{ id: `c${group.key}`, mediaFileId: group.key, provider: "bangumi", externalId: group.key, title: `目标${group.title}`, year: 2026, season: group.representative.parsedSeason, subjectType: "tv", confidence: .8, matchReasons: ["隔离候选"], aliases: [], createdAt: now }]]));
const work = { id: "existing", title: "已有作品", originalTitle: null, type: "video", category: "anime", coverPath: null, status: "planned", favorite: false, rating: null, notes: "保留笔记", tags: [], mediaCount: 1, missingCount: 0, createdAt: now, updatedAt: now };
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [[1024, 640], [1366, 768], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: width === 1366 ? "dark" : "light" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ root, now, files, groups, candidates, work }) => {
      window.__calls = []; window.__failSecond = false;
      let remaining = files.map(file => ({ ...file }));
      let history = [];
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value, transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (command === "list_works") return [work];
          if (command === "list_library_roots") return [{ id: "root", path: root, kind: "video", enabled: true, createdAt: now, updatedAt: now }];
          if (command === "list_unassigned_media") return remaining;
          if (command === "list_unassigned_media_groups") return groups.filter(group => remaining.some(file => file.id === group.key));
          if (command === "recognize_media_file") { window.__search = args; return { status: "candidate_pending", candidates: candidates[args.mediaFileId] || [], parsedTitle: "示例作品", error: null }; }
          if (command === "list_match_candidates") return candidates[args.mediaFileId] || [];
          if (command === "list_recognition_group_members") {
            const group = groups.find(group => group.ids.includes(args.mediaFileId));
            return { members: args.groupScope === "folder" ? remaining : remaining.filter(file => group.ids.includes(file.id)), title: group.title, folderPath: `${root}\\Show`, linkedWorkId: null, scope: args.groupScope };
          }
          if (command === "confirm_match_candidate" || command === "attach_media_files") {
            window.__calls.push({ command, args });
            if (window.__failSecond && args.mediaFileId === "13") { window.__failSecond = false; throw new Error("模拟保存失败，可重试"); }
            const ids = args.selectedMediaIds || args.mediaFileIds;
            const saved = remaining.filter(file => ids.includes(file.id));
            remaining = remaining.filter(file => !ids.includes(file.id));
            history.unshift({ id: `h${history.length}`, targetTitle: "目标作品", targetWorkId: "target", fileCount: ids.length, createdAt: now, undoneAt: null, saved });
            return "target";
          }
          if (command === "list_recognition_history") return history;
          if (command === "undo_recognition") {
            const item = history.find(item => item.id === args.id); remaining.push(...item.saved); item.undoneAt = now; return null;
          }
          if (command === "get_playback_progress") return { items: [], sessions: [] };
          if (command.startsWith("list_")) return [];
          return null;
        },
      } });
    }, { root, now, files, groups, candidates, work });
    await page.goto(process.env.GENZO_TEST_URL || "http://127.0.0.1:4187/#/library?tab=inbox");
    await page.getByRole("button", { name: "批量预览与确认", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "勾选全部可确认项" }).waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll(".recognition-batch-row").length === 3 && !document.querySelector(".recognition-selection-tools button").disabled);
    assert.equal(await page.evaluate(() => window.__calls.length), 0);
    await modal.getByRole("button", { name: "勾选全部可确认项" }).click();
    await page.evaluate(() => { window.__failSecond = true; });
    await modal.getByRole("button", { name: "确认勾选的关联" }).click();
    await modal.getByText("模拟保存失败，可重试", { exact: false }).waitFor();
    await modal.getByRole("button", { name: "确认勾选的关联" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.recognition-batch-status')].every(node => node.textContent === "已关联"));
    const calls = await page.evaluate(() => window.__calls);
    assert.deepEqual(calls.map(call => call.args.mediaFileId).sort(), ["1", "13", "13", "ed"]);
    assert.deepEqual(calls.find(call => call.args.mediaFileId === "13").args.selectedMediaIds.sort(), ["13", "14"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/screenshots/recognition-batch-${width}.png` });
    await modal.getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.getByRole("button", { name: "识别记录", exact: true }).click();
    await modal.locator(".recognition-history-row").first().getByRole("button", { name: "撤销", exact: true }).click();
    await modal.getByRole("button", { name: "确认撤销", exact: true }).click();
    await modal.getByText("已撤销", { exact: false }).waitFor();
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".inbox-folder-link").first().click();
    await page.locator(".inbox-folder-link").first().click();
    await page.getByRole("button", { name: "关联已有作品", exact: true }).click();
    await modal.getByRole("button", { name: "清空选择", exact: true }).click();
    await modal.locator(".recognition-selection-heading").filter({ hasText: "第 2 季" }).getByRole("checkbox").check();
    await modal.getByRole("button", { name: "选择此作品" }).click();
    const before = await page.evaluate(() => window.__calls.length);
    assert.equal(before, 4, "choosing a work only previews the association");
    await modal.getByRole("button", { name: "确认关联", exact: true }).click();
    await page.waitForFunction(() => window.__calls.length === 5);
    assert.deepEqual((await page.evaluate(() => window.__calls.at(-1))).args.mediaFileIds.sort(), ["13", "14"]);
    await page.reload();
    await page.locator(".inbox-folder-link").first().click();
    await page.locator(".inbox-folder-link").first().click();
    await page.getByRole("button", { name: "识别整个文件夹", exact: true }).click();
    await modal.locator(".recognition-selection-heading").filter({ hasText: "第 2 季" }).waitFor();
    assert.equal(await modal.locator(".recognition-selection-heading").count(), 3);
    await modal.getByRole("button", { name: "清空选择", exact: true }).click();
    await modal.locator(".recognition-selection-heading").filter({ hasText: "第 2 季" }).getByRole("checkbox").check();
    await modal.getByRole("button", { name: "预览关联" }).click();
    assert.deepEqual((await modal.locator(".recognition-preview li").allTextContents()).sort(), ["Show [13].mkv", "Show [14].mkv"]);
    assert.equal(await page.evaluate(() => window.__calls.length), 0);
    await modal.getByRole("button", { name: "返回调整", exact: true }).click();
    await modal.getByRole("button", { name: "清空选择", exact: true }).click();
    await modal.locator(".recognition-selection-heading").filter({ hasText: "第 1 季" }).getByRole("checkbox").check();
    await modal.getByRole("button", { name: "按文件名识别", exact: true }).click();
    await modal.getByText("目标第一季", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__search.mediaFileId), "1");
    await modal.getByRole("button", { name: "预览关联" }).click();
    assert.deepEqual((await modal.locator(".recognition-preview li").allTextContents()).sort(), ["Show [1].mkv", "Show [2].mkv"]);
    await page.screenshot({ path: `artifacts/screenshots/recognition-split-${width}.png` });
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: /连续处理/ }).click();
    const skipped = await modal.locator(".recognition-file strong").textContent();
    await modal.getByRole("button", { name: "跳过", exact: true }).click();
    const next = await modal.locator(".recognition-file strong").textContent();
    assert.notEqual(skipped, next);
    await modal.getByRole("button", { name: "预览关联", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__calls.length), 0);
    await modal.getByRole("button", { name: "确认关联", exact: true }).click();
    await page.waitForTimeout(300);
    assert.notEqual(await modal.locator(".recognition-file strong").textContent(), skipped);
    assert.equal(await modal.locator(".recognition-file strong").textContent(), "Show [ed].mkv");
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal((await page.locator(".inbox-crumb-current").textContent()).toLowerCase(), "show");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}x${height}: preview-only, season isolation, partial batch failure/retry, undo, selective existing-work attachment passed`);
  }
} finally { await browser.close(); }
