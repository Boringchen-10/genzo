import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Only generated fixtures on the computer emulator. Preserve existing sources and credentials.
const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/video-v02";
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
mkdirSync(output, { recursive: true });
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = "D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4";
const animeQuery = process.env.GENZO_QA_ANIME_QUERY || "孤独摇滚";
const fixtureRunId = Date.now();
const names = [1, 2, 3].map(number => `Genzo V02 ${fixtureRunId} S01E0${number}.mp4`);
const auth = `Basic ${Buffer.from("qa:fixture-only").toString("base64")}`;
let offline = false;
const requests = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  requests.push({ method: req.method, path });
  res.setHeader("Connection", "close");
  if (offline) { res.writeHead(503); res.end(); return; }
  if (req.headers.authorization !== auth) { res.writeHead(401); res.end(); return; }
  if (req.method === "PROPFIND") {
    const item = (href, directory) => `<d:response><d:href>${encodeURI(href)}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? "<d:collection/>" : ""}</d:resourcetype>${directory ? "" : `<d:getcontentlength>${statSync(fixture).size}</d:getcontentlength><d:getetag>fixture-v02</d:getetag>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    const children = path === "/dav/" ? item("/dav/Clips/", true) : names.map(name => item(`/dav/Clips/${name}`, false)).join("");
    res.writeHead(207, { "Content-Type": "application/xml" });
    res.end(`<d:multistatus xmlns:d="DAV:">${item(path, true)}${children}</d:multistatus>`); return;
  }
  if (!names.some(name => path.endsWith(`/${name}`))) { res.writeHead(404); res.end(); return; }
  const size = statSync(fixture).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
  res.writeHead(range ? 206 : 200, { "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === "HEAD") { res.end(); return; }
  const stream = createReadStream(fixture, { start, end }); res.on("close", () => stream.destroy()); stream.pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
adb("reverse", `tcp:${port}`, `tcp:${port}`);
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    let connection;
    try {
      adb("forward", "tcp:9227", `localabstract:webview_devtools_remote_${adb("shell", "pidof", "com.genzo.android")}`);
      connection = await chromium.connectOverCDP("http://127.0.0.1:9227", { noDefaults: true });
      if (connection.contexts()[0]?.pages().length) return connection;
    } catch { /* Wait for the WebView socket after relaunch. */ }
    await connection?.close(); await sleep(250);
  }
  throw new Error("WebView not ready");
}
let browser = await connect();
let page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const nav = title => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: title, exact: true }).click();
const dialog = () => page.getByRole("dialog");
const capture = async name => { await sleep(400); await page.screenshot({ path: `${output}/${name}.png` }); };
async function until(predicate, label, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) { const result = await predicate(); if (result) return result; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
async function sources() { await nav("我的"); await page.getByRole("button", { name: "资料库", exact: false }).click(); }
async function layout() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => innerWidth)); }
let sourceId;
let temporaryToken = false;
const results = { serial, layouts: [] };
try {
  if (await dialog().count()) await dialog().getByRole("button", { name: "关闭", exact: true }).click();
  for (const title of ["首页", "媒体库", "书架", "发现", "我的"]) { await nav(title); await layout(); results.layouts.push(title); }
  await sources();
  const configured = (await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb").configured;
  if (!configured && process.env.GENZO_QA_SKIP_TOKEN !== "1") {
    await page.getByLabel("TMDB API Read Access Token").fill("fixture-only-v02-token");
    await page.getByRole("button", { name: "保存 Token", exact: true }).click(); temporaryToken = true;
    await until(async () => (await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb").configured, "Keystore Token saved");
    assert.equal(await invoke("get_setting", { key: "metadata.tmdb_read_token" }), null);
    const ciphertext = adb("shell", "run-as", "com.genzo.android", "cat", "shared_prefs/genzo-encrypted-credentials.xml");
    assert.ok(ciphertext.includes("metadata.tmdb_read_token")); assert.ok(!ciphertext.includes("fixture-only-v02-token"));
    await browser.close(); adb("shell", "am", "force-stop", "com.genzo.android"); adb("shell", "am", "start", "-n", "com.genzo.android/.MainActivity");
    browser = await connect(); page = browser.contexts()[0].pages()[0]; page.on("pageerror", error => errors.push(String(error)));
    assert.ok((await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb").configured);
    await sources(); await page.getByRole("button", { name: "清除 Token", exact: true }).click();
    await until(async () => !(await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb").configured, "Keystore Token cleared");
    temporaryToken = false; results.keystore = "saved, hidden, encrypted, retained after relaunch, cleared";
  } else results.keystore = "Skipped temporary Token test to preserve user configuration";
  await page.getByRole("button", { name: "添加 WebDAV 视频来源" }).click();
  const sourceName = `Genzo v02 QA ${port}`;
  await dialog().getByLabel("来源名称").fill(sourceName);
  await dialog().getByLabel("WebDAV 地址").fill(`http://127.0.0.1:${port}/dav/`);
  await dialog().getByLabel("用户名", { exact: true }).fill("qa");
  await dialog().getByLabel("密码", { exact: true }).fill("wrong");
  await dialog().getByRole("button", { name: "测试连接", exact: true }).click();
  await dialog().getByRole("alert").waitFor();
  assert.ok(await dialog().getByRole("button", { name: "添加所选目录" }).isDisabled());
  await dialog().getByLabel("密码", { exact: true }).fill("fixture-only");
  await dialog().getByRole("button", { name: "测试连接", exact: true }).click();
  await dialog().getByRole("button", { name: "Clips", exact: true }).click();
  await until(async () => await dialog().getByRole("button", { name: "添加所选目录" }).isEnabled(), "directory validated");
  await capture("webdav-directory"); await layout();
  await dialog().getByRole("button", { name: "添加所选目录" }).click();
  await until(async () => !(await dialog().count()), "source saved");
  sourceId = (await invoke("get_video_source_states")).find(item => item.label === sourceName).id;
  const card = () => page.locator(".gz-source").filter({ hasText: sourceName });
  await card().getByRole("button", { name: "扫描", exact: true }).click();
  await until(async () => (await invoke("list_scan_tasks")).some(task => task.rootId === sourceId && task.stage === "completed"), "WebDAV UI scan");
  assert.ok(requests.every(request => request.method === "PROPFIND"));
  const indexed = (await invoke("list_unassigned_media", { destination: "media" })).filter(item => item.libraryRootId === sourceId);
  assert.equal(indexed.length, 3);
  await card().getByRole("button", { name: "连接凭据", exact: true }).click();
  await dialog().getByLabel("用户名", { exact: true }).fill("qa"); await dialog().getByLabel("密码", { exact: true }).fill("fixture-only");
  await dialog().getByRole("button", { name: "测试连接", exact: true }).click();
  await until(async () => await dialog().getByRole("button", { name: "保存凭据" }).isEnabled(), "credential validation");
  await dialog().getByRole("button", { name: "保存凭据" }).click(); await until(async () => !(await dialog().count()), "credentials updated");
  await page.getByRole("button", { name: "待整理队列" }).click();
  const group = (await invoke("list_unassigned_media_groups")).find(item => item.representative.libraryRootId === sourceId);
  await page.locator(".gz-row-card").filter({ hasText: group.representative.fileName }).click();
  await until(async () => await dialog().getByRole("checkbox").count() === 3, "file selection loaded");
  await dialog().getByLabel(names[2], { exact: true }).uncheck();
  const title = `Genzo v02 selected QA ${port}`;
  await dialog().getByLabel("手动创建作品 *").fill(title); await capture("selected-files");
  await dialog().getByRole("button", { name: "创建并整理所选文件" }).click(); await until(async () => !(await dialog().count()), "selected creation");
  const work = (await invoke("list_works")).find(item => item.title === title);
  const detail = await invoke("get_work", { id: work.id });
  assert.equal(detail.mediaFiles.length, 2); assert.deepEqual(work.sourceScopes, ["network"]);
  assert.ok((await invoke("list_unassigned_media", { destination: "media" })).some(item => item.id === indexed.find(file => file.fileName === names[2]).id));
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  assert.equal(await page.getByText("锁定资料字段", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "个人记录", exact: true }).click();
  await dialog().getByLabel("个人备注").fill(`Genzo v02 QA ${port}`);
  await dialog().getByLabel("个人评分（0–10）").fill("7.5");
  await dialog().getByRole("button", { name: "保存记录", exact: true }).click();
  await until(async () => !(await dialog().count()), "personal record saved");
  await page.getByRole("button", { name: "分集纠错", exact: true }).click();
  await dialog().getByLabel("分集方式").selectOption("sequence"); await dialog().getByLabel("起始集号").fill("7");
  await dialog().getByRole("button", { name: "预览纠错" }).click();
  await dialog().getByLabel("已核对文件范围、目标作品与集号").check(); await capture("correction-preview");
  await dialog().getByRole("button", { name: "保存纠错" }).click(); await until(async () => !(await dialog().count()), "correction saved");
  const input = { sourceWorkId: work.id, targetWorkId: work.id, mediaFileIds: detail.mediaFiles.map(file => file.id), mode: "keep", startEpisode: 1, season: null, episodeType: 0 };
  results.correction = await invoke("preview_media_correction", { input });
  assert.deepEqual(results.correction.rows.map(row => row.episode), [7, 8]);
  console.log("PASS: source form, nested directory, credentials, selected files, personal record and correction");
  await page.getByRole("button", { name: "匹配作品资料", exact: true }).click();
  await until(async () => await dialog().getByRole("checkbox").count() > 0, "matched-work file range");
  await dialog().getByLabel("搜索作品资料").fill(animeQuery); await dialog().getByRole("button", { name: "查找候选" }).click();
  await until(async () => await dialog().getByRole("button", { name: "确认该作品" }).count() > 0, "live Bangumi candidates");
  results.liveCandidates = await dialog().locator(".gz-candidates strong").allTextContents();
  await capture("bangumi-candidates"); await dialog().getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("tab", { name: "剧集", exact: true }).click();
  const mediaId = detail.mediaFiles[0].id;
  await page.locator(".gz-episode").filter({ hasText: detail.mediaFiles[0].fileName }).evaluate(button => button.click());
  const playing = await until(async () => { const state = await invoke("get_internal_player_state"); return state.mediaFileId === mediaId && state.status === "playing" && state.positionMs > 300 && state; }, "UI WebDAV playback");
  await invoke("control_internal_player", { sessionId: playing.sessionId, action: { type: "seek", positionMs: 17000 } });
  await invoke("control_internal_player", { sessionId: playing.sessionId, action: { type: "pause" } });
  await until(async () => (await invoke("get_playback_progress", { workId: work.id })).items.some(item => item.mediaFileId === mediaId && item.positionMs > 15000), "SQLite progress");
  writeFileSync(`${output}/player.png`, execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"]));
  await invoke("control_internal_player", { sessionId: playing.sessionId, action: { type: "close" } });
  await nav("首页"); await until(async () => await page.locator(".gz-continue").filter({ hasText: title }).count() > 0, "resume card");
  await page.locator(".gz-continue").filter({ hasText: title }).evaluate(button => button.click());
  await until(async () => { const state = await invoke("get_internal_player_state"); return state.mediaFileId === mediaId && state.sessionId !== playing.sessionId && state.status === "playing" && state.positionMs > 15000; }, "UI resume");
  const resumed = await invoke("get_internal_player_state"); await invoke("control_internal_player", { sessionId: resumed.sessionId, action: { type: "close" } });
  await nav("媒体库"); await page.getByRole("radio", { name: "网络", exact: true }).click();
  await page.locator(".gz-card").filter({ hasText: title }).waitFor(); await page.getByRole("radio", { name: "本地", exact: true }).click();
  assert.equal(await page.locator(".gz-card").filter({ hasText: title }).count(), 0); await page.getByRole("radio", { name: "全部", exact: true }).click();
  await sources(); offline = true; await card().getByRole("button", { name: "扫描", exact: true }).click();
  await until(async () => (await invoke("list_scan_tasks")).some(task => task.rootId === sourceId && task.stage === "completed" && task.errors.length), "partial failure visible");
  await card().getByText("扫描完成", { exact: true }).waitFor(); await capture("source-failure");
  assert.equal((await invoke("get_work", { id: work.id })).mediaFiles.length, 2);
  offline = false; await card().getByRole("button", { name: "重试失败范围" }).click();
  await until(async () => (await invoke("list_scan_tasks")).filter(task => task.rootId === sourceId)[0]?.stage === "completed" && !(await invoke("list_scan_tasks")).filter(task => task.rootId === sourceId)[0]?.errors.length, "source recovered");
  await capture("sources"); await layout(); results.sourceId = sourceId; results.workId = work.id; results.playbackAndResume = true; results.errors = errors;
  await card().getByRole("button", { name: "停用来源" }).click();
  await until(async () => !(await invoke("get_video_source_states")).find(item => item.id === sourceId).enabled, "source disabled without deletion");
  assert.equal((await invoke("get_work", { id: work.id })).mediaFiles.length, 2);
  await card().getByRole("button", { name: "启用来源" }).click();
  await until(async () => (await invoke("get_video_source_states")).find(item => item.id === sourceId).enabled, "source re-enabled");
  console.log("PASS: real playback, SQLite resume, filters, offline retention and source recovery");
  async function searchAndConfirm(mediaId, query, kind, season) {
    await dialog().getByLabel("搜索作品资料").fill(query);
    await dialog().getByLabel("资料类型").selectOption(kind);
    if (kind === "tv") await dialog().getByLabel("季度", { exact: true }).fill(String(season));
    await dialog().getByRole("button", { name: "查找候选" }).click();
    await until(async () => await dialog().getByRole("button", { name: "确认该作品" }).count() > 0, `${kind} candidates`, 600);
    const firstTitle = await dialog().locator(".gz-candidates strong").first().textContent();
    const candidate = (await invoke("list_match_candidates", { mediaFileId: mediaId })).find(item => item.title === firstTitle);
    assert.ok(candidate);
    for (const existing of await invoke("list_works")) {
      const current = await invoke("get_work", { id: existing.id });
      assert.ok(current.mediaFiles.some(file => file.id === mediaId) || current.metadata?.provider !== candidate.provider || current.metadata?.externalId !== candidate.externalId, "Refuse merging QA files into an existing unrelated work");
    }
    await capture(`${kind}-candidates`); await dialog().getByRole("button", { name: "确认该作品" }).first().click();
    await until(async () => !(await dialog().count()), `${kind} confirmed`, 600);
    const currentId = (await page.evaluate(() => location.hash)).slice("#/detail/".length);
    await page.getByRole("tab", { name: "概览", exact: true }).click();
    await page.getByRole("button", { name: "刷新已匹配资料", exact: true }).click();
    await until(async () => await page.getByRole("button", { name: "刷新已匹配资料", exact: true }).isEnabled(), `${kind} refreshed`, 600);
    const current = await invoke("get_work", { id: currentId });
    assert.equal(current.metadata.provider, candidate.provider);
    assert.equal(current.metadata.externalId, candidate.externalId);
    assert.ok(current.mediaFiles.some(file => file.id === mediaId));
    return current;
  }
  await nav("媒体库"); await page.locator(".gz-card").filter({ hasText: title }).click();
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "匹配作品资料", exact: true }).click();
  await until(async () => await dialog().getByRole("checkbox").count() > 0, "Bangumi rematch range");
  const anime = await searchAndConfirm(detail.mediaFiles[0].id, animeQuery, "anime");
  assert.equal(anime.id, work.id); assert.equal(anime.notes, `Genzo v02 QA ${port}`); assert.equal(anime.rating, 7.5);
  const structure = await invoke("get_anime_work_structure", { workId: anime.id });
  assert.ok(structure.episodes.some(episode => episode.episodeNumber === 7 && episode.localFiles.length));
  assert.ok(structure.episodes.some(episode => episode.episodeNumber === 8 && episode.localFiles.length));
  await page.getByRole("tab", { name: "剧集", exact: true }).click();
  await page.locator(".gz-episode").filter({ hasText: "第 7 集" }).waitFor(); await capture("anime-mapping");
  results.bangumi = { confirmed: true, refreshed: true, personalRecordPreserved: true, correctionPreserved: true };
  if ((await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb").configured) {
    await sources(); await page.getByRole("button", { name: "待整理队列" }).click();
    const remainingId = indexed.find(file => file.fileName === names[2]).id;
    const remainingGroup = (await invoke("list_unassigned_media_groups")).find(item => item.representative.id === remainingId);
    assert.ok(remainingGroup); await page.locator(".gz-row-card").filter({ hasText: remainingGroup.representative.fileName }).click();
    await until(async () => await dialog().getByRole("checkbox").count() > 0, "movie range");
    const movie = await searchAndConfirm(remainingId, "Inception", "movie"); assert.equal(movie.category, "movie");
    await page.getByRole("button", { name: "重新匹配资料", exact: true }).click();
    await until(async () => await dialog().getByRole("checkbox").count() > 0, "TV range");
    const tv = await searchAndConfirm(remainingId, "Planet Earth", "tv", 1); assert.equal(tv.category, "tv");
    const tvStructure = await invoke("get_anime_work_structure", { workId: tv.id }); assert.ok(tvStructure.episodes.length);
    results.tmdb = { movieConfirmedAndRefreshed: true, tvConfirmedAndRefreshed: true, tvEpisodes: tvStructure.episodes.length };
    await capture("tmdb-tv-detail");
  } else results.tmdb = "Not configured; live validation pending";
  assert.deepEqual(errors, []); writeFileSync(`${output}/result.json`, JSON.stringify(results, null, 2));
  console.log("PASS: v0.2 real UI sources, credentials, selected organization, personal records, correction, live candidates, playback, resume, filters and failure recovery");
} catch (error) {
  await capture("failure").catch(() => {}); writeFileSync(`${output}/failure.json`, JSON.stringify({ ...results, error: String(error) }, null, 2)); throw error;
} finally {
  const player = await invoke("get_internal_player_state").catch(() => null);
  if (player?.sessionId && !["idle", "closed", "error"].includes(player.status)) await invoke("control_internal_player", { sessionId: player.sessionId, action: { type: "close" } }).catch(() => {});
  if (temporaryToken) await invoke("set_setting", { key: "metadata.tmdb_read_token", value: "" }).catch(() => {});
  if (sourceId) await invoke("update_library_root", { id: sourceId, kind: "video", enabled: false }).catch(() => {});
  await browser.close(); await new Promise(resolve => server.close(resolve)); adb("reverse", "--remove", `tcp:${port}`);
}
