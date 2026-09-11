import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const now = new Date().toISOString();
const mediaRoot = "H:\\Genzo Visual Fixtures";
const works = [
  ["1", "星海列车：跨越群星与时间的第一季", "Starlight Railway", "video", 12, true, "in_progress", 8.7],
  ["2", "边境回声", "Echoes of the Frontier", "game", 4, false, "in_progress", 7.5],
  ["3", "蓝色时期", "Blue Period", "comic", 12, true, "in_progress", 9.1],
  ["4", "海边的卡夫卡", "Kafka on the Shore", "novel", 1, false, "planned", null],
  ["5", "雨巷画集", "Rain Alley", "comic", 8, true, "completed", 9.4],
  ["6", "夜航手记", "Night Flight Notes", "novel", 3, false, "in_progress", null],
  ["7", "资料归档", null, "other", 1, false, "planned", null],
].map(([id, title, originalTitle, type, mediaCount, favorite, status, rating]) => ({
  id: String(id), title: String(title), originalTitle, type, mediaCount: Number(mediaCount), favorite: Boolean(favorite), status,
  coverPath: null, description: "用于验证 Genzo 本地媒体整理流程的测试作品。", rating, notes: "仅保存在本机的个人备注。",
  tags: ["本地", "已整理"], missingCount: id === "7" ? 1 : 0, createdAt: now, updatedAt: now,
  metadataStatus: id === "1" ? "matched" : "manually_created", metadataYear: id === "1" ? 2023 : null, lastRecognizedAt: id === "1" ? now : null,
}));
const unassigned = [{
  id: "pending", workId: null, libraryRootId: "root", path: `${mediaRoot}\\Anime\\pending anime.mkv`, fileName: "pending anime.mkv",
  extension: "mkv", mediaType: "video", size: 734003200, modifiedAt: now, missing: false, createdAt: now, updatedAt: now,
  recognitionStatus: "candidate_pending", parsedTitle: "葬送的芙莉莲", parsedOriginalTitle: null, parsedSeason: 1, parsedEpisode: "01", parsedYear: 2023, parsedReleaseGroup: "字幕组", parsedSpecialType: null, parsedMediaInfo: '["1080p"]', lastRecognizedAt: now, recognitionError: null,
}];
const unassignedGroups = [{ key: "folder:pending", title: "葬送的芙莉莲", folderPath: `${mediaRoot}\\Anime\\葬送的芙莉莲`, mediaType: "video", fileCount: 24, missingCount: 0, totalSize: 17616076800, recognitionStatus: "candidate_pending", representative: unassigned[0] }];
const dashboard = {
  totalWorks: works.length, videoCount: 1, comicCount: 2, novelCount: 2, gameCount: 1, otherCount: 1,
  favoriteCount: 3, missingFileCount: 1, recentWorks: works, favoriteWorks: works.filter((work) => work.favorite), lastScan: null,
};
const candidate = { id: "candidate", mediaFileId: "pending", provider: "bangumi", externalId: "400602", title: "葬送的芙莉莲", originalTitle: "葬送のフリーレン", aliases: ["Frieren"], subjectType: "tv", year: 2023, season: 1, coverUrl: null, confidence: 0.86, matchReasons: ["标题相似度 95%", "年份一致"], createdAt: now };
const detail = { ...works[0], metadata: { provider: "bangumi", externalId: "400602", title: works[0].title, originalTitle: "葬送のフリーレン", year: 2023, coverUrl: null, fetchedAt: now }, fieldLocks: ["title"], candidates: [], mediaFiles: [
  { ...unassigned[0], id: "episode-1", workId: "1", path: `${mediaRoot}\\Anime\\episode 1.mkv`, fileName: "episode 1.mkv" },
  { ...unassigned[0], id: "episode-10", workId: "1", path: `${mediaRoot}\\Anime\\episode 10.mkv`, fileName: "episode 10.mkv" },
] };
const roots = [{ id: "root", path: mediaRoot, kind: "auto", enabled: true, lastScannedAt: now, createdAt: now, updatedAt: now }];
const scanJobs = [{ id: "scan", libraryRootId: "root", status: "completed", discoveredCount: 8, addedCount: 1, updatedCount: 0, missingCount: 1, startedAt: now, finishedAt: now, errors: [] }];
const tools = [{ id: "tool", name: "mpv", executablePath: "C:\\Program Files\\mpv\\mpv.exe", supportedMediaTypes: ["video"], argumentsTemplate: "--fullscreen {file}", workingDirectory: null, isDefault: true, createdAt: now, updatedAt: now }];
const appInfo = { version: "0.1.0", databasePath: "C:\\Users\\User\\AppData\\Roaming\\com.genzo.desktop\\genzo.db", coverCachePath: "C:\\Users\\User\\AppData\\Roaming\\com.genzo.desktop\\covers", dataDirectory: "C:\\Users\\User\\AppData\\Roaming\\com.genzo.desktop" };
const responses = { get_dashboard: dashboard, list_works: works, list_unassigned_media: unassigned, list_unassigned_media_groups: unassignedGroups, get_work: detail, list_external_tools: tools, list_library_roots: roots, list_scan_jobs: scanJobs, get_app_info: appInfo, get_setting: "dark" };
responses.list_match_candidates = [candidate];

const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
await page.addInitScript((payload) => {
  Object.defineProperty(globalThis, "__TAURI_INTERNALS__", { value: { invoke: async (command) => command in payload ? payload[command] : null, convertFileSrc: (value) => value } });
  localStorage.setItem("genzo-preferences", JSON.stringify({ state: { theme: "dark", libraryView: "grid" }, version: 0 }));
}, responses);

const screenshots = path.resolve("artifacts", "screenshots");
await mkdir(screenshots, { recursive: true });
const cases = [
  ["home", "#/", 1366, 768, ".seanime-home"],
  ["home-wide", "#/", 1920, 1080, ".seanime-home"],
  ["library", "#/library", 1920, 1080, ".work-card"],
  ["library-compact", "#/library", 1024, 640, ".unassigned-row"],
  ["detail", "#/library/1", 1024, 640, ".file-row"],
  ["scan", "#/scan", 1366, 768, ".root-row"],
  ["tools", "#/tools", 1366, 768, ".tool-row"],
  ["settings", "#/settings", 1024, 640, ".settings-layout"],
  ["settings-light", "#/settings", 1366, 768, ".settings-layout"],
];
const reports = [];
for (const [name, route, width, height, selector] of cases) {
  await page.setViewportSize({ width, height });
  await page.goto(`http://127.0.0.1:4175/?preview=theme${route}`, { waitUntil: "networkidle" });
  await page.waitForSelector(selector);
  if (name === "library-compact") {
    await page.locator(".unassigned-actions button").first().click();
    await page.waitForSelector(".candidate-list");
  }
  if (name === "settings-light") await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const report = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overlaps: [...document.querySelectorAll(".page-header, .library-toolbar, .detail-hero, .root-row, .tool-row, .setting-row, .candidate-row, .recognition-search")]
      .flatMap((element) => {
        const parent = element.getBoundingClientRect();
        return [...element.children]
          .filter((child) => {
            const rect = child.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (rect.left < parent.left - 1 || rect.right > parent.right + 1);
          })
          .map((child) => { const rect = child.getBoundingClientRect(); return `${element.tagName}.${element.className} > ${child.tagName}.${child.className}[${Math.round(rect.left)},${Math.round(rect.right)}] parent[${Math.round(parent.left)},${Math.round(parent.right)}]`; });
      }),
  }));
  if (report.scrollWidth > report.viewport || report.overlaps.length) throw new Error(`${name} layout overflow: ${JSON.stringify(report)}`);
  await page.screenshot({ path: path.join(screenshots, `genzo-${name}-${width}x${height}.png`) });
  reports.push({ name, width, height, ...report });
}
console.log(JSON.stringify(reports, null, 2));
await browser.close();
