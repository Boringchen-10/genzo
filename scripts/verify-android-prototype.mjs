import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

// Run against the installed debug prototype. SAF authorization is performed by the human on the phone.
const packageId = "com.genzo.android";
const adb = (...args) => execFileSync("adb", ["-s", process.env.GENZO_ANDROID_SERIAL ?? "3B164M00Z0500000", ...args], { encoding: "utf8" }).trim();
const output = process.env.GENZO_ANDROID_QA_DIR ?? "D:/DevTools/Android/Build/qa";
const cdpPort = process.env.GENZO_ANDROID_CDP_PORT ?? "9226";
mkdirSync(output, { recursive: true });
const connect = async () => {
  let pid;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { pid = adb("shell", "pidof", packageId); } catch { pid = ""; }
    if (pid && adb("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(pid && ready, "The prototype must be installed and its debug WebView running");
  adb("forward", `tcp:${cdpPort}`, `localabstract:webview_devtools_remote_${pid}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { noDefaults: true });
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector("[data-testid=probe-result]");
  return { browser, page };
};
const invoke = (page, command, payload) => page.evaluate(({ command, payload }) =>
  window.__TAURI_INTERNALS__.invoke(command, payload), { command, payload });
let { browser, page } = await connect();
const before = await invoke(page, "android_probe", { write: true });
assert.equal(before.platform, "android");
assert.equal(before.integrity, "ok");
assert.equal(before.migrations, Number(process.env.GENZO_EXPECTED_MIGRATIONS ?? 25));
assert.equal(before.databaseMarker, before.cacheMarker);
assert.ok(before.databaseMarker);
assert.equal(before.credentialMarkerMatches, true);
await assert.rejects(() => invoke(page, "android_native", { command: "readCredentials", payload: { id: "android-prototype-marker" } }),
  "The React prototype cannot call credential read methods");
await assert.rejects(() => invoke(page, "plugin:genzo-android|readCredentials", { id: "android-prototype-marker" }),
  "The native credential plugin has no public JavaScript command handler");
await browser.close();
adb("shell", "am", "force-stop", packageId);
adb("shell", "am", "start", "-n", `${packageId}/.MainActivity`);
({ browser, page } = await connect());
const after = await invoke(page, "android_probe", { write: false });
assert.equal(after.integrity, "ok");
assert.equal(after.databaseMarker, before.databaseMarker);
assert.equal(after.cacheMarker, before.cacheMarker);
assert.equal(after.credentialMarkerMatches, true);
assert.equal(adb("shell", "run-as", packageId, "cat", "shared_prefs/genzo-encrypted-credentials.xml").includes(before.databaseMarker), false);
const root = await invoke(page, "android_native", { command: "listTree", payload: {} });
assert.equal(root.status, "available", "Authorize the generated test folder on the phone first");
const directory = root.files.find(file => file.name === "GenzoPrototype");
const selected = directory?.uri ?? root.uri;
const files = await invoke(page, "android_native", { command: "listTree", payload: { uri: selected } });
assert.equal(files.status, "available");
for (const name of ["h264.mp4", "h265.mkv", "h264-tracks.mkv"]) {
  assert.ok(files.files.some(file => file.name === name && file.uri.startsWith("content://")));
}
const denied = await invoke(page, "android_native", { command: "listTree", payload: {
  uri: "content://com.android.externalstorage.documents/tree/primary%3AGenzoUnauthorized" } });
assert.equal(denied.status, "permission_denied");
writeFileSync(`${output}/persistence-saf.json`, JSON.stringify({ before, after,
  source: { status: root.status, authorizedUri: root.uri },
  testFiles: files.files.map(({ name, uri, size }) => ({ name, uri, size })), denied }, null, 2));
await browser.close();
console.log("PASS: Android Rust/SQLite, migrations, integrity, force-stop persistence, cache, credential read rejection, SAF restart and permission denial");
