import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// The human has granted GenzoPrototype on the phone; the emulator uses its own fixtures.
const serial = process.env.GENZO_ANDROID_SERIAL ?? "3B164M00Z0500000";
const port = process.env.GENZO_ANDROID_CDP_PORT ?? "9226";
const output = process.env.GENZO_ANDROID_QA_DIR ?? "D:/DevTools/Android/Build/qa";
mkdirSync(output, { recursive: true });
const adb = (...args) => execFileSync("adb", ["-s", serial, ...args], { encoding: "utf8" }).trim();
const pid = adb("shell", "pidof", "com.genzo.android");
adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
const page = browser.contexts()[0].pages()[0];
const invoke = (command, args = {}) => page.evaluate(({ command, args }) =>
  window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const tree = await invoke("android_native", { command: "listTree", payload: {} });
assert.equal(tree.status, "available");
assert.ok(tree.uri.endsWith("primary%3ADownload%2FGenzoPrototype"), "Only the generated fixture tree may be indexed by this script");
const authorized = await invoke("authorize_video_source", { label: "GenzoPrototype QA", reuseAuthorized: true });
assert.equal(authorized.status, "authorized");
const source = authorized.source;
assert.equal(source.kind, "saf");
assert.equal(source.enabled, true);
async function scan() {
  const { taskId } = await invoke("scan_video_source", { sourceId: source.id });
  assert.ok(taskId);
  for (let attempt = 0; attempt < 150; attempt++) {
    const task = (await invoke("list_scan_tasks")).find(task => task.id === taskId);
    if (task && ["completed", "failed", "cancelled", "interrupted"].includes(task.stage)) {
      assert.equal(task.stage, "completed", JSON.stringify(task));
      assert.deepEqual(task.errors, []);
      return task;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for SAF scan");
}
const first = await scan();
const files = (await invoke("list_unassigned_media", { destination: "media" })).filter(file => file.libraryRootId === source.id);
const works = await invoke("list_works");
let detail = works.find(work => work.title === "Genzo SAF QA fixture");
if (detail) detail = await invoke("get_work", { id: detail.id });
const all = [...files, ...(detail?.mediaFiles ?? [])];
for (const name of ["h264.mp4", "h265.mkv", "h264-tracks.mkv", "h264.srt", "h264.ass", "h264.ssa", "Genzo Fixture S02E03.mkv"]) {
  assert.ok(all.some(file => file.fileName === name), `Missing indexed fixture: ${name}`);
}
const episode = all.find(file => file.fileName === "Genzo Fixture S02E03.mkv");
assert.equal(episode.parsedSeason, 2);
assert.equal(episode.parsedEpisodeStart, 3);
assert.ok(all.every(file => file.path.startsWith("saf://") && !file.missing));
const identities = Object.fromEntries(all.map(file => [file.fileName, { id: file.id, updatedAt: file.updatedAt }]));
if (!detail) {
  const input = { title: "Genzo SAF QA fixture", originalTitle: null, type: "video", description: "Synthetic fixture", coverPath: null,
    status: "paused", favorite: true, rating: 8, notes: "Keep personal data", tags: ["QA"] };
  detail = await invoke("create_work_from_media", { mediaFileId: episode.id, input });
  // Explicit attachment updates media timestamps; compare the following scans
  // against that new baseline rather than confusing assignment with rescanning.
  for (const file of detail.mediaFiles) {
    assert.equal(file.id, identities[file.fileName].id);
    identities[file.fileName].updatedAt = file.updatedAt;
  }
}
const second = await scan();
const unassigned = (await invoke("list_unassigned_media", { destination: "media" })).filter(file => file.libraryRootId === source.id);
const retained = await invoke("get_work", { id: detail.id });
assert.equal(retained.favorite, true);
assert.equal(retained.notes, "Keep personal data");
assert.equal(retained.status, "paused");
assert.equal(retained.rating, 8);
for (const file of [...unassigned, ...retained.mediaFiles]) {
  assert.deepEqual({ id: file.id, updatedAt: file.updatedAt }, identities[file.fileName]);
}
assert.equal(second.reused, all.length);
await assert.rejects(() => invoke("delete_library_root", { id: source.id }));
await invoke("update_library_root", { id: source.id, kind: "video", enabled: false });
await assert.rejects(() => invoke("scan_video_source", { sourceId: source.id }));
assert.equal((await invoke("get_work", { id: detail.id })).notes, "Keep personal data");
await invoke("update_library_root", { id: source.id, kind: "video", enabled: true });
writeFileSync(`${output}/saf-index.json`, JSON.stringify({ serial, source, first, second, identities,
  workId: detail.id, personalRecordsPreserved: true, disabledSourceRejected: true, deletionRejected: true,
  viewport: await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })) }, null, 2));
await browser.close();
console.log("PASS: recursive SAF indexing, subtitles, parsed season/episode, stable IDs, metadata reuse, manual work/personal data and source safeguards");
