import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const endpoint = "http://127.0.0.1:9223";
const mediaRoot = path.resolve(".e2e-media");
const directAnimeRoot = path.resolve(".e2e-direct-anime");
const looseMediaRoot = path.resolve(".e2e-loose-media");
const subtitleMediaRoot = path.resolve(".e2e-subtitle-media");
const screenshots = path.resolve("artifacts", "screenshots");
await Promise.all([
  mkdir(directAnimeRoot, { recursive: true }),
  mkdir(looseMediaRoot, { recursive: true }),
  mkdir(path.join(subtitleMediaRoot, "Kiss x Sis", "video"), { recursive: true }),
  mkdir(path.join(subtitleMediaRoot, "Kiss x Sis", "subtitle"), { recursive: true }),
  mkdir(path.join(mediaRoot, "Anime"), { recursive: true }),
  mkdir(path.join(mediaRoot, "Comic"), { recursive: true }),
  mkdir(path.join(mediaRoot, "Comic", "Junji Ito", "Tomie"), { recursive: true }),
  mkdir(path.join(mediaRoot, "Comic", "Junji Ito", "Uzumaki"), { recursive: true }),
  mkdir(path.join(mediaRoot, "Novel"), { recursive: true }),
  mkdir(path.join(mediaRoot, "Misc"), { recursive: true }),
  mkdir(path.join(mediaRoot, "Game"), { recursive: true }),
]);
await Promise.all([
  writeFile(path.join(directAnimeRoot, "[Group] Direct Anime [01][2160p].mkv"), "Genzo direct-root grouping fixture.\n"),
  writeFile(path.join(directAnimeRoot, "[Group] Direct Anime [02][2160p].mkv"), "Genzo direct-root grouping fixture.\n"),
  writeFile(path.join(looseMediaRoot, "[Ygm] Kimi no Koto ga Dai Dai Daisuki [01][2160p].mkv"), "Genzo loose media fixture.\n"),
  writeFile(path.join(looseMediaRoot, "S01E186.2020.2160p.WEB-DL.H264.AAC.mp4"), "Genzo loose media fixture.\n"),
  writeFile(path.join(looseMediaRoot, "Balloon.pdf"), "Genzo loose media fixture.\n"),
  writeFile(path.join(subtitleMediaRoot, "Kiss x Sis", "video", "Kiss x Sis - 01.mkv"), "Genzo subtitle mapping fixture.\n"),
  writeFile(path.join(subtitleMediaRoot, "Kiss x Sis", "video", "Kiss x Sis - 02.mkv"), "Genzo subtitle mapping fixture.\n"),
  writeFile(path.join(subtitleMediaRoot, "Kiss x Sis", "subtitle", "Kiss x Sis - 01.ass"), "Genzo subtitle mapping fixture.\n"),
  writeFile(path.join(subtitleMediaRoot, "Kiss x Sis", "subtitle", "Kiss x Sis - 02.ass"), "Genzo subtitle mapping fixture.\n"),
  writeFile(path.join(mediaRoot, "Anime", "episode 1.mkv"), "Genzo end-to-end scan fixture.\n"),
  writeFile(path.join(mediaRoot, "Anime", "episode 10.mkv"), "Genzo end-to-end scan fixture.\n"),
  writeFile(path.join(mediaRoot, "Anime", "pending anime.mkv"), "Genzo unassigned media fixture.\n"),
  writeFile(path.join(mediaRoot, "Comic", "volume 2.cbz"), "Genzo end-to-end scan fixture.\n"),
  writeFile(path.join(mediaRoot, "Comic", "Junji Ito", "Tomie", "001.jpg"), "Genzo nested comic fixture.\n"),
  writeFile(path.join(mediaRoot, "Comic", "Junji Ito", "Tomie", "002.jpg"), "Genzo nested comic fixture.\n"),
  writeFile(path.join(mediaRoot, "Comic", "Junji Ito", "Uzumaki", "001.jpg"), "Genzo nested comic fixture.\n"),
  writeFile(path.join(mediaRoot, "Novel", "story.epub"), "Genzo end-to-end scan fixture.\n"),
  writeFile(path.join(mediaRoot, "Misc", "reference.nfo"), "Genzo end-to-end scan fixture.\n"),
]);
await copyFile(
  path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe"),
  path.join(mediaRoot, "Game", "GenzoTestGame.exe"),
);
const browser = await chromium.connectOverCDP(endpoint);
let page;
for (let attempt = 0; attempt < 80 && !page; attempt += 1) {
  page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith("http://127.0.0.1:1420"));
  if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!page) throw new Error("No Genzo WebView page was exposed on the debug endpoint.");

const runtimeErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") {
    const location = message.location();
    runtimeErrors.push(`console: ${message.text()} @ ${location.url || "unknown"}:${location.lineNumber ?? 0}`);
  }
});
page.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`));
page.on("response", (response) => {
  if (response.status() >= 400) runtimeErrors.push(`response ${response.status()}: ${response.url()}`);
});

await page.waitForSelector(".sidebar", { timeout: 15_000 });

async function invoke(command, args = {}) {
  return page.evaluate(
    ({ commandName, commandArgs }) => globalThis.__TAURI_INTERNALS__.invoke(commandName, commandArgs),
    { commandName: command, commandArgs: args },
  );
}

let roots = await invoke("list_library_roots");
let root = roots.find((item) => item.path.toLocaleLowerCase() === mediaRoot.toLocaleLowerCase());
if (!root) {
  root = await invoke("add_library_root", {
    input: { path: mediaRoot, kind: "auto", enabled: true },
  });
}

const firstScan = await invoke("scan_library_root", { id: root.id });
if (firstScan.discoveredCount !== 10) {
  throw new Error(`Expected 10 fixture files, found ${firstScan.discoveredCount}.`);
}
const secondScan = await invoke("scan_library_root", { id: root.id });
if (secondScan.addedCount !== 0 || secondScan.updatedCount !== 0) {
  throw new Error(`Repeated scan was not idempotent: ${JSON.stringify(secondScan)}`);
}

let directAnimeLibraryRoot = roots.find(
  (item) => item.path.toLocaleLowerCase() === directAnimeRoot.toLocaleLowerCase(),
);
if (!directAnimeLibraryRoot) {
  directAnimeLibraryRoot = await invoke("add_library_root", {
    input: { path: directAnimeRoot, kind: "video", enabled: true },
  });
}
const directAnimeScan = await invoke("scan_library_root", { id: directAnimeLibraryRoot.id });
if (directAnimeScan.discoveredCount !== 2) {
  throw new Error(`Expected 2 direct anime fixture files, found ${directAnimeScan.discoveredCount}.`);
}
const directAnimeGroups = (await invoke("list_unassigned_media_groups")).filter(
  (group) => group.folderPath?.toLocaleLowerCase() === directAnimeRoot.toLocaleLowerCase(),
);
if (directAnimeGroups.length !== 1 || directAnimeGroups[0].fileCount !== 2) {
  throw new Error(`Direct anime root was not grouped as one work: ${JSON.stringify(directAnimeGroups)}`);
}

let looseMediaLibraryRoot = roots.find(
  (item) => item.path.toLocaleLowerCase() === looseMediaRoot.toLocaleLowerCase(),
);
if (!looseMediaLibraryRoot) {
  looseMediaLibraryRoot = await invoke("add_library_root", {
    input: { path: looseMediaRoot, kind: "auto", enabled: true },
  });
}
const looseMediaScan = await invoke("scan_library_root", { id: looseMediaLibraryRoot.id });
if (looseMediaScan.discoveredCount !== 3) {
  throw new Error(`Expected 3 loose media fixture files, found ${looseMediaScan.discoveredCount}.`);
}
const looseMediaGroups = (await invoke("list_unassigned_media_groups")).filter(
  (group) => group.folderPath?.toLocaleLowerCase() === looseMediaRoot.toLocaleLowerCase()
    || group.representative.path.toLocaleLowerCase().startsWith(looseMediaRoot.toLocaleLowerCase()),
);
if (looseMediaGroups.length !== 3 || looseMediaGroups.some((group) => group.fileCount !== 1)) {
  throw new Error(`Unrelated loose media files were grouped together: ${JSON.stringify(looseMediaGroups)}`);
}
const nestedComicGroups = (await invoke("list_unassigned_media_groups")).filter(
  (group) => group.folderPath?.toLocaleLowerCase().includes(path.join("Comic", "Junji Ito").toLocaleLowerCase()),
);
if (nestedComicGroups.length !== 2 || nestedComicGroups.map((group) => group.fileCount).sort().join(",") !== "1,2") {
  throw new Error(`Nested comic folders were not split into leaf groups: ${JSON.stringify(nestedComicGroups)}`);
}

let subtitleLibraryRoot = roots.find(
  (item) => item.path.toLocaleLowerCase() === subtitleMediaRoot.toLocaleLowerCase(),
);
if (!subtitleLibraryRoot) {
  subtitleLibraryRoot = await invoke("add_library_root", {
    input: { path: subtitleMediaRoot, kind: "auto", enabled: true },
  });
}
const subtitleScan = await invoke("scan_library_root", { id: subtitleLibraryRoot.id });
if (subtitleScan.discoveredCount !== 4) {
  throw new Error(`Expected 4 video/subtitle fixture files, found ${subtitleScan.discoveredCount}.`);
}
let subtitleWork = (await invoke("list_works")).find((item) => item.title === "Kiss x Sis");
if (!subtitleWork) {
  const subtitleGroup = (await invoke("list_unassigned_media_groups")).find(
    (group) => group.folderPath?.toLocaleLowerCase() === path.join(subtitleMediaRoot, "Kiss x Sis").toLocaleLowerCase(),
  );
  if (!subtitleGroup || subtitleGroup.fileCount !== 4) {
    throw new Error(`Video and subtitle folders were not grouped as one work: ${JSON.stringify(subtitleGroup)}`);
  }
  subtitleWork = await invoke("create_work_from_media", {
    mediaFileId: subtitleGroup.representative.id,
    input: {
      title: "Kiss x Sis",
      originalTitle: null,
      type: "video",
      description: "视频与外挂字幕关联测试。",
      coverPath: null,
      status: "planned",
      favorite: false,
      rating: null,
      tags: [],
      notes: "",
    },
  });
}
const subtitleDetail = await invoke("get_work", { id: subtitleWork.id });
if (subtitleDetail.mediaFiles.length !== 4 || subtitleDetail.subtitleLinks.length !== 2) {
  throw new Error(`Subtitle links were not persisted: ${JSON.stringify(subtitleDetail.subtitleLinks)}`);
}

const workDefinitions = [
  {
    title: "星海列车：第一季",
    originalTitle: "Starlight Railway",
    type: "video",
    description: "一部用于验证本地视频整理流程的测试作品。",
    status: "in_progress",
    favorite: true,
    rating: 8.7,
    tags: ["科幻", "追番中"],
    notes: "下次从第二话开始。",
    files: ["episode 1.mkv", "episode 10.mkv"],
  },
  {
    title: "雨巷画集",
    originalTitle: null,
    type: "comic",
    description: "本地漫画归档测试。",
    status: "completed",
    favorite: true,
    rating: 9.1,
    tags: ["画集", "收藏"],
    notes: "",
    files: ["volume 2.cbz"],
  },
  {
    title: "夜航手记",
    originalTitle: null,
    type: "novel",
    description: "本地电子书归档测试。",
    status: "planned",
    favorite: false,
    rating: null,
    tags: ["短篇"],
    notes: "待读。",
    files: ["story.epub"],
  },
  {
    title: "边境回声",
    originalTitle: "Echoes of the Frontier",
    type: "game",
    description: "用于验证本地 EXE 启动流程的测试条目。",
    status: "in_progress",
    favorite: false,
    rating: 7.5,
    tags: ["RPG"],
    notes: "",
    files: ["GenzoTestGame.exe"],
  },
  {
    title: "资料归档",
    originalTitle: null,
    type: "other",
    description: "无法自动归类的本地文件。",
    status: "planned",
    favorite: false,
    rating: null,
    tags: ["其他"],
    notes: "",
    files: ["reference.nfo"],
  },
];

let works = await invoke("list_works");
let unassigned = await invoke("list_unassigned_media");
for (const definition of workDefinitions) {
  let work = works.find((item) => item.title === definition.title);
  if (!work) {
    work = await invoke("create_work", {
      input: {
        title: definition.title,
        originalTitle: definition.originalTitle,
        type: definition.type,
        description: definition.description,
        coverPath: null,
        status: definition.status,
        favorite: definition.favorite,
        rating: definition.rating,
        tags: definition.tags,
        notes: definition.notes,
      },
    });
  }
  for (const fileName of definition.files) {
    const file = unassigned.find((item) => item.fileName === fileName);
    if (file) {
      await invoke("attach_media_file", { workId: work.id, mediaFileId: file.id });
      unassigned = unassigned.filter((item) => item.id !== file.id);
    }
  }
}

works = await invoke("list_works");
if (works.length !== 6 || works.reduce((sum, item) => sum + item.mediaCount, 0) !== 10) {
  throw new Error("Work creation or file association did not produce the expected data.");
}

const videoWork = works.find((item) => item.type === "video");
if (!videoWork.coverPath) {
  const cachedCover = await invoke("import_cover", {
    sourcePath: path.resolve("src-tauri", "icons", "icon.png"),
  });
  await invoke("update_work", {
    id: videoWork.id,
    input: {
      title: videoWork.title,
      originalTitle: videoWork.originalTitle,
      type: videoWork.type,
      description: videoWork.description,
      coverPath: cachedCover,
      status: videoWork.status,
      favorite: videoWork.favorite,
      rating: videoWork.rating,
      tags: videoWork.tags,
      notes: videoWork.notes,
    },
  });
  works = await invoke("list_works");
}

let tools = await invoke("list_external_tools");
let tool = tools.find((item) => item.name === "Genzo E2E Tool");
if (!tool) {
  tool = await invoke("create_external_tool", {
    input: {
      name: "Genzo E2E Tool",
      executablePath: "C:\\Windows\\System32\\where.exe",
      supportedMediaTypes: ["video"],
      argumentsTemplate: "{file}",
      workingDirectory: null,
      isDefault: true,
    },
  });
}

const videoDetail = await invoke("get_work", { id: works.find((item) => item.type === "video").id });
await invoke("launch_media", { mediaFileId: videoDetail.mediaFiles[0].id, toolId: tool.id, useSystem: false });
const gameDetail = await invoke("get_work", { id: works.find((item) => item.type === "game").id });
await invoke("launch_media", { mediaFileId: gameDetail.mediaFiles[0].id, toolId: null, useSystem: false });

async function setRoute(route) {
  await page.evaluate((hash) => {
    globalThis.location.hash = hash;
  }, route);
  await page.reload();
  await page.waitForSelector(".sidebar");
  await page.waitForTimeout(350);
}

async function assertNoHorizontalOverflow(label) {
  const result = await page.evaluate(() => ({
    viewport: globalThis.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    containers: [document.documentElement, document.body, document.querySelector(".main-content")]
      .filter(Boolean)
      .map((element) => ({ name: element.className || element.tagName, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
    contentOverflowing: (() => {
      const container = document.querySelector(".main-content");
      if (!container) return [];
      const bounds = container.getBoundingClientRect();
      return [...container.querySelectorAll("*")]
        .filter((element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== "none" && rect.width > 0 && (rect.right > bounds.right + 1 || rect.left < bounds.left - 1); })
        .slice(0, 10)
        .map((element) => `${element.tagName}.${element.className}`);
    })(),
    contentChildren: [...(document.querySelector(".main-content")?.children ?? [])].map((element) => ({ className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, width: element.getBoundingClientRect().width })),
    wideDescendants: [...(document.querySelector(".main-content")?.querySelectorAll("*") ?? [])].filter((element) => element.scrollWidth > element.clientWidth + 1).slice(0, 10).map((element) => ({ tag: element.tagName, className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
    overflowing: [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (element.classList.contains("seanime-banner-image")) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > globalThis.innerWidth + 1 || rect.left < -1);
      })
      .slice(0, 10)
      .map((element) => `${element.tagName}.${element.className}`),
  }));
  if (result.scrollWidth > result.viewport || result.overflowing.length || result.containers.some((item) => item.scrollWidth > item.clientWidth + 1)) {
    throw new Error(`${label} overflow: ${JSON.stringify(result)}`);
  }
}

await mkdir(screenshots, { recursive: true });
await page.setViewportSize({ width: 1366, height: 768 });
await setRoute("#/settings");
await page.getByRole("radio", { name: "深色" }).click();
await setRoute("#/");
await page.waitForSelector(".seanime-home");
await page.waitForSelector(".window-titlebar");
if (await page.locator(".window-control").count() !== 3) {
  throw new Error("Custom title bar did not expose the three standard window controls.");
}
if (await page.locator(".window-titlebar[data-tauri-drag-region]").count() !== 1) {
  throw new Error("Custom title bar did not expose a Tauri drag region.");
}
const maximizeButton = page.locator(".window-control-maximize");
await maximizeButton.click();
await page.waitForTimeout(250);
if (await maximizeButton.getAttribute("aria-label") !== "还原") {
  throw new Error("Maximize control did not report the maximized state.");
}
await maximizeButton.click();
await page.waitForTimeout(250);
if (await maximizeButton.getAttribute("aria-label") !== "最大化") {
  throw new Error("Maximize control did not restore the window state.");
}
await page.locator(".window-drag-space").dblclick();
await page.waitForTimeout(250);
if (await maximizeButton.getAttribute("aria-label") !== "还原") {
  throw new Error("Double-clicking the title bar did not maximize the window.");
}
await page.locator(".window-drag-space").dblclick();
await page.waitForTimeout(250);
if (await maximizeButton.getAttribute("aria-label") !== "最大化") {
  throw new Error("Double-clicking the title bar did not restore the window.");
}
await page.getByRole("button", { name: "最小化" }).click();
await page.waitForTimeout(250);
if (!(await invoke("plugin:window|is_minimized", { label: "main" }))) {
  throw new Error("Minimize control did not minimize the native window.");
}
await invoke("plugin:window|unminimize", { label: "main" });
await page.waitForTimeout(250);
await page.mouse.move(700, 500);
await page.waitForTimeout(300);
await assertNoHorizontalOverflow("home 1366x768");
await page.screenshot({ path: path.join(screenshots, "genzo-home-1366x768.png") });
if ((await page.locator(".gnz-switcher-items button").count()) < 3) {
  throw new Error("Home work switcher did not show the available recent works.");
}

await page.setViewportSize({ width: 1920, height: 1080 });
await setRoute("#/");
await assertNoHorizontalOverflow("home 1920x1080");
await page.screenshot({ path: path.join(screenshots, "genzo-home-1920x1080.png") });

await setRoute("#/library");
await page.getByLabel("海报网格").click();
await page.mouse.move(1200, 760);
await page.waitForSelector(".work-card");
await assertNoHorizontalOverflow("library 1920x1080");
await page.screenshot({ path: path.join(screenshots, "genzo-library-1920x1080.png") });
await page.getByRole("tab", { name: /待整理/ }).click();
await page.waitForSelector(".unassigned-row");
if ((await page.getByLabel("待整理内容排序").inputValue()) !== "status") {
  throw new Error("Unassigned content did not default to recognition-status sorting.");
}
const pendingRow = page.locator(".unassigned-row").filter({
  has: page.locator("strong").getByText("Anime", { exact: true }),
});
if ((await pendingRow.count()) !== 1 || !(await pendingRow.getByText("动漫").count())) {
  throw new Error("Scanned unassigned anime was not visible in the library.");
}
await pendingRow.getByRole("button", { name: "手动整理" }).click();
if ((await page.locator(".modal input").first().inputValue()) !== "Anime") {
  throw new Error("Organize form did not prefill the top-level media folder.");
}
if ((await page.locator(".modal select").first().inputValue()) !== "video") {
  throw new Error("Organize form did not prefill the detected media type.");
}
await page.getByRole("button", { name: "取消" }).click();
const directAnimeRow = page.locator(".unassigned-row").filter({
  has: page.locator("strong").getByText("Direct Anime", { exact: true }),
});
if ((await directAnimeRow.count()) !== 1 || !(await directAnimeRow.getByText("2 个", { exact: false }).count())) {
  throw new Error("Files directly under an anime scan root were not shown as one two-file group.");
}
const looseMediaRows = page.locator(".unassigned-row").filter({ hasText: ".e2e-loose-media" });
if ((await looseMediaRows.count()) !== 3) {
  throw new Error("Loose files at the scan root were not shown as three separate rows.");
}
for (const row of await looseMediaRows.all()) {
  if (!(await row.getByText("1 个", { exact: false }).count())) {
    throw new Error("A loose media row included files from another work.");
  }
}
await assertNoHorizontalOverflow("inbox 1920x1080");
await page.screenshot({ path: path.join(screenshots, "genzo-inbox-1920x1080.png") });

await page.setViewportSize({ width: 1024, height: 640 });
await page.getByRole("tab", { name: "媒体库" }).click();
await page.getByLabel("列表").click();
await page.waitForSelector(".work-list-row");
await assertNoHorizontalOverflow("library list 1024x640");
await page.getByLabel("搜索作品").fill("星海列车");
if ((await page.locator(".work-list-row").count()) !== 1) throw new Error("Library title search failed.");
await page.locator(".work-list-row").first().click();
await page.waitForSelector(".file-row");
if ((await page.locator(".file-row").count()) !== 2) throw new Error("Work detail did not show associated files.");
const notesWorkId = works.find((item) => item.title === "星海列车：第一季").id;
const existingNotes = (await invoke("get_work", { id: notesWorkId })).notes;
const notesTestValue = existingNotes === "端到端测试点评" ? "端到端测试点评（复测）" : "端到端测试点评";
await page.getByLabel("点评 / 备注").fill(notesTestValue);
await page.getByRole("button", { name: "保存点评" }).click();
await page.waitForTimeout(200);
if ((await invoke("get_work", { id: notesWorkId })).notes !== notesTestValue) {
  throw new Error("Work detail notes were not persisted.");
}
await assertNoHorizontalOverflow("work detail 1024x640");
await page.screenshot({ path: path.join(screenshots, "genzo-detail-1024x640.png") });

await setRoute(`#/library/${subtitleWork.id}`);
await page.waitForSelector(".file-row");
const localFilesSection = page.locator(".detail-section").filter({ has: page.getByRole("heading", { name: "章节与文件" }) });
await localFilesSection.scrollIntoViewIfNeeded();
if ((await localFilesSection.locator(".episode-card-meta", { hasText: "1 个字幕" }).count()) !== 2) {
  throw new Error("Work detail did not show the two persisted episode subtitle links.");
}
await assertNoHorizontalOverflow("subtitle detail 1024x640");
await page.screenshot({ path: path.join(screenshots, "genzo-subtitle-detail-1024x640.png") });

await setRoute("#/scan");
if ((await page.locator(".root-row").count()) !== 4) throw new Error("Scan directory UI did not show all configured roots.");
await setRoute("#/tools");
if ((await page.locator(".tool-row").count()) !== 1) throw new Error("Tool management UI did not show the configured tool.");
await assertNoHorizontalOverflow("tools 1024x640");
await page.screenshot({ path: path.join(screenshots, "genzo-tools-1024x640.png") });
await setRoute("#/explore");
if (!(await page.getByText("Prototype · Future", { exact: true }).count())) throw new Error("Explore did not identify future-only content.");
if (!(await page.getByLabel("搜索探索内容（尚未开放）").isDisabled())) throw new Error("Explore future search was unexpectedly interactive.");
await assertNoHorizontalOverflow("explore 1024x640");
await page.screenshot({ path: path.join(screenshots, "genzo-explore-1024x640.png") });
const settingsTrigger = page.getByRole("link", { name: "设置" });
await settingsTrigger.click();
await page.waitForSelector(".settings-drawer");
await page.getByRole("radio", { name: "深色" }).click();
if (!(await page.locator("html.dark").count())) throw new Error("Dark theme did not activate.");
if (!(await page.getByRole("tab", { name: /下载与备份/ }).isDisabled())) throw new Error("Future download settings were unexpectedly interactive.");
const drawerWidth = await page.locator(".settings-drawer").evaluate((element) => element.getBoundingClientRect().width);
if (drawerWidth > 410) throw new Error(`Settings drawer is wider than the v1.1.1 specification: ${drawerWidth}px.`);
for (const label of ["主题色", "玻璃模糊", "圆角大小"]) {
  if (!(await page.getByLabel(label, { exact: false }).count())) throw new Error(`Missing appearance control: ${label}.`);
}
await assertNoHorizontalOverflow("settings drawer 1024x640");
await page.screenshot({ path: path.join(screenshots, "genzo-settings-1024x640.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
if (await page.locator(".settings-drawer").count()) throw new Error("Escape did not close the settings drawer.");
if (!(await settingsTrigger.evaluate((element) => element === document.activeElement))) throw new Error("Settings drawer did not return focus to its trigger.");
await setRoute("#/settings");
await page.getByRole("radio", { name: "跟随系统" }).click();
await page.keyboard.press("Escape");
await page.waitForSelector(".settings-drawer", { state: "detached" });

const visualRoutes = [
  { route: "#/", name: "home", selector: ".gnz-home" },
  { route: "#/library", name: "library", selector: ".page-library" },
  { route: "#/explore", name: "explore", selector: ".gnz-explore-page" },
  { route: `#/library/${works.find((item) => item.title === "星海列车：第一季").id}`, name: "detail", selector: ".detail-page" },
  { route: "#/settings", name: "settings", selector: ".settings-drawer" },
];
await setRoute("#/settings");
await page.getByRole("radio", { name: "深色" }).click();
await page.keyboard.press("Escape");
for (const size of [{ width: 1024, height: 640 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  await page.setViewportSize(size);
  for (const item of visualRoutes) {
    await setRoute(item.route);
    await page.waitForSelector(item.selector);
    await assertNoHorizontalOverflow(`${item.name} ${size.width}x${size.height}`);
    await page.screenshot({ path: path.join(screenshots, `genzo-v1-1-1-${item.name}-${size.width}x${size.height}.png`) });
  }
}

await setRoute("#/settings");
await page.getByRole("radio", { name: "浅色" }).click();
await page.keyboard.press("Escape");
for (const size of [{ width: 1024, height: 640 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  await page.setViewportSize(size);
  for (const item of visualRoutes.filter((route) => route.name === "detail" || route.name === "settings")) {
    await setRoute(item.route);
    await page.waitForSelector(item.selector);
    await assertNoHorizontalOverflow(`light ${item.name} ${size.width}x${size.height}`);
    await page.screenshot({ path: path.join(screenshots, `genzo-v1-1-1-light-${item.name}-${size.width}x${size.height}.png`) });
  }
}
await setRoute("#/settings");
await page.getByRole("radio", { name: "跟随系统" }).click();
await page.keyboard.press("Escape");

if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join("\n")}`);
console.log(JSON.stringify({
  firstScan: {
    discovered: firstScan.discoveredCount,
    added: firstScan.addedCount,
    errors: firstScan.errors.length,
  },
  secondScan: {
    added: secondScan.addedCount,
    updated: secondScan.updatedCount,
  },
  directAnimeGroup: {
    groups: directAnimeGroups.length,
    files: directAnimeGroups[0].fileCount,
  },
  looseMediaGroups: {
    groups: looseMediaGroups.length,
    filesPerGroup: looseMediaGroups.map((group) => group.fileCount),
  },
  nestedComicGroups: nestedComicGroups.map((group) => ({ title: group.title, files: group.fileCount })),
  subtitleLinks: subtitleDetail.subtitleLinks.length,
  works: works.length,
  files: works.reduce((sum, item) => sum + item.mediaCount, 0),
  screenshots,
}, null, 2));

const closed = page.waitForEvent("close");
await page.getByRole("button", { name: "关闭", exact: true }).click();
await closed;
await browser.close();
