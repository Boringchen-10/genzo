import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Public metadata and UI only; never imports works, reads chapters or changes accounts.
const serial = "emulator-5554";
const output = "D:/DevTools/Android/Build/qa/discovery-feeds";
const adbPath = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(output, { recursive: true });
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    let browser;
    try {
      const pid = adb("shell", "pidof", "com.genzo.android");
      adb("forward", "tcp:9227", `localabstract:webview_devtools_remote_${pid}`);
      browser = await chromium.connectOverCDP("http://127.0.0.1:9227", { noDefaults: true });
      if (browser.contexts()[0]?.pages().length) return browser;
    } catch { /* WebView may still be starting. */ }
    await browser?.close(); await sleep(250);
  }
  throw new Error("Emulator WebView not ready");
}
const browser = await connect();
const page = browser.contexts()[0].pages()[0];
await page.waitForLoadState("domcontentloaded");
await page.getByRole("navigation",{name:"主导航"}).waitFor();
await page.waitForFunction(()=>document.readyState === "complete" && !!window.__TAURI_INTERNALS__);
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
async function invoke(command, args = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(({ command, args }) => Promise.race([
        window.__TAURI_INTERNALS__.invoke(command, args),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error(`IPC timed out: ${command}`)),25000)),
      ]), { command, args });
    } catch (error) {
      if (attempt >= 30 || !String(error).includes("state not managed")) throw error;
      await sleep(400);
    }
  }
}
async function personalSnapshot() {
  const works = (await invoke("list_works")).map(({ id, favorite, status, rating }) => ({ id, favorite, status, rating })).sort((a,b) => a.id.localeCompare(b.id));
  return { count: works.length, hash: createHash("sha256").update(JSON.stringify(works)).digest("hex") };
}
try {
  if (process.argv.includes("--capture-baseline")) {
    const baseline = await personalSnapshot();
    writeFileSync(`${output}/baseline.json`,JSON.stringify(baseline,null,2));
    console.log(JSON.stringify({ baselineWorkCount:baseline.count }));
  } else {
    const baseline = JSON.parse(readFileSync(`${output}/baseline.json`,"utf8"));
    assert.deepEqual(await personalSnapshot(),baseline,"Installed APK must preserve works and personal state");
    console.log("Installed APK preserved personal state; checking public metadata");
    const first = await invoke("get_anime_popular",{page:1,refresh:true});
    assert.equal(first.items.length,24); assert.equal(first.pageSize,24);
    assert.ok(first.hasMore && first.totalPages > 1 && !first.stale);
    const second = await invoke("get_anime_popular",{page:2,refresh:true});
    assert.notEqual(first.items[0].externalId,second.items[0].externalId);
    const cached = await invoke("get_anime_popular",{page:1,refresh:false});
    assert.deepEqual(cached.items.map(item=>item.externalId),first.items.map(item=>item.externalId));
    const last = await invoke("get_anime_popular",{page:first.totalPages,refresh:true});
    assert.ok(!last.hasMore && last.items.length > 0 && last.items.length <= 24);
    const ranking = await invoke("get_anime_ranking",{page:1,pageSize:3});
    assert.equal(ranking.length,3);
    assert.notEqual(ranking[0].externalId,first.items[0].externalId,"Windows score ranking remains independent");
    const home = await invoke("get_comic_explore_home",{refresh:true});
    assert.equal(home.sections.length,7); assert.ok(!home.stale);
    const sectionChecks = [];
    for (const group of home.sections) {
      assert.ok(group.items.length > 0);
      assert.ok(group.items.every(entry=>entry.item.pathWord && entry.item.title));
      if (!group.supportsPaging) {
        assert.equal(group.section,"hotUpdates"); assert.equal(group.total,null);
        sectionChecks.push({section:group.section,items:group.items.length,supportsPaging:false});
        continue;
      }
      const input = {section:group.section,offset:0,limit:3};
      if (group.period) { input.period=group.period; input.audience=group.audience; }
      const start = await invoke("list_comic_explore_section",{input,refresh:true});
      assert.equal(start.items.length,3); assert.ok(start.hasMore && !start.stale);
      assert.equal(start.items[0].item.pathWord,group.items[0].item.pathWord);
      const next = await invoke("list_comic_explore_section",{input:{...input,offset:3},refresh:true});
      assert.equal(next.offset,3); assert.notEqual(start.items[0].item.pathWord,next.items[0].item.pathWord);
      sectionChecks.push({section:group.section,period:group.period,items:group.items.length,total:start.total,paging:true});
      console.log(`Verified COPY ${group.section} ${group.period ?? ""}`);
    }
    const female = await invoke("list_comic_explore_section",{input:{section:"ranking",period:"day",audience:"female",offset:0,limit:3},refresh:true});
    assert.equal(female.items.length,3);
    await assert.rejects(invoke("list_comic_explore_section",{input:{section:"hotUpdates",offset:0,limit:3},refresh:false}));
    console.log("Public metadata passed; checking anime UI and scroll append");
    await page.reload();
    await page.getByRole("navigation",{name:"主导航"}).waitFor();
    await page.getByRole("navigation",{name:"主导航"}).getByRole("button",{name:"发现",exact:true}).click();
    await page.getByRole("heading",{name:"热门番组",exact:true}).waitFor();
    const hot = page.locator("section").filter({has:page.getByRole("heading",{name:"热门番组",exact:true})});
    await hot.locator(".gz-cover").first().waitFor({timeout:30000});
    const ids = await hot.locator("[data-explore-cover-id]").evaluateAll(nodes=>nodes.map(node=>node.dataset.exploreCoverId));
    assert.deepEqual(ids.slice(0,5),first.items.slice(0,5).map(item=>item.externalId));
    await hot.locator(".gz-sentinel").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll("section")].find(node=>node.querySelector("h2")?.textContent==="热门番组")?.querySelectorAll(".gz-cover").length > 30,{},{timeout:30000});
    const loadedIds = await hot.locator("[data-explore-cover-id]").evaluateAll(nodes=>nodes.map(node=>node.dataset.exploreCoverId));
    const expectedIds = [...new Set([...first.items,...second.items].map(item=>item.externalId))];
    assert.deepEqual(loadedIds.slice(0,expectedIds.length),expectedIds,"Scroll append must keep source order and deduplicate page overlaps");
    const loaded = loadedIds.length;
    await page.evaluate(()=>document.querySelector(".gz-scroll").scrollTo(0,0));
    await sleep(2000);
    const settledIds = await hot.locator("[data-explore-cover-id]").evaluateAll(nodes=>nodes.map(node=>node.dataset.exploreCoverId));
    assert.deepEqual(settledIds.slice(0,expectedIds.length),expectedIds,"Late calendar/season results must not reset appended popular pages");
    const layout = await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    assert.equal(layout.width,layout.scrollWidth);
    writeFileSync(`${output}/anime-popular.png`,execFileSync(adbPath,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:16*1024*1024}));
    assert.deepEqual(await personalSnapshot(),baseline,"Discovery must preserve personal records");
    assert.deepEqual(errors,[]);
    const result = {date:new Date().toISOString(),serial,workCount:baseline.count,firstAnime:first.items.slice(0,5).map(item=>({id:item.externalId,title:item.title})),totalPages:first.totalPages,loadedCards:loaded,sections:sectionChecks,femaleRank:true,personalRecordsPreserved:true,layout,errors};
    writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
  }
} finally { await browser.close(); }
