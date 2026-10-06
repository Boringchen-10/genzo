// Run only against a newly built, uniquely identified QA application on port 9241.
import { chromium } from "playwright-core";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9241");
try {
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
  const call = (command, args = {}) => page.evaluate(([command,args]) => window.__TAURI_INTERNALS__.invoke(command,args), [command,args]);
  const info = await call("get_app_info");
  assert.match(path.basename(info.dataDirectory), /^com\.genzo\.desktop\.reading-network-qa-[a-f0-9]{32}$/);
  assert.deepEqual(await call("list_works"), []);
  const root = path.join(info.dataDirectory,"reading-cache");
  let hadCache = false; try { await access(root); hadCache = true; } catch {}
  assert.equal(hadCache,false,"Use a fresh QA profile");
  const config = await call("get_reading_network");
  await call("save_reading_network",{config:{...config,autoUpdate:false}});
  const probes = await call("test_reading_network",{config});
  assert.equal(probes.length,7); assert.ok(probes.some(p=>p.route!==null && p.milliseconds!==null));
  const filled = await call("fill_reading_network",{config});
  assert.ok(filled.apiHost.startsWith("api.copy"));assert.ok(filled.updatedAt);
  console.log("Native network settings, source fill and node probes passed");
  const book = "modujingbingdenuli";
  const directory = await call("get_book_source_entries",{kind:"comic",pathWord:book,group:"default",offset:0,refresh:true});
  const entries = directory.entries.slice(0,2);assert.equal(entries.length,2);
  const online = await call("get_book_online_content",{kind:"comic",pathWord:book,entryId:entries[0].id,group:directory.group});
  assert.ok(online.pages.length>1); assert.equal(online.sections.length,0);
  const image = await page.evaluate(async url => {
    const bytes = new Uint8Array(await window.__TAURI_INTERNALS__.invoke("get_book_online_image",{url}));
    return {bytes:bytes.length,magic:Array.from(bytes.slice(0,4))};
  },online.pages[0]);
  assert.ok(image.bytes>1000);
  const novel = "wuzhizhuanshengdaoleyishijiejiunachuzhenbenshi";
  const text = await call("get_book_online_content",{kind:"novel",pathWord:novel,entryId:"3792",group:""});
  assert.ok(text.sections.some(s=>s.text?.length>1000));
  let wroteCache = false; try { await access(root); wroteCache = true; } catch {}
  assert.equal(wroteCache,false,"Online data must not generate CBZ/EPUB or write the reading cache");
  console.log("Native online manga page and novel text passed without generated reading files");
  const downloaded = await Promise.all(entries.map(entry => call("cache_book_source_content",{kind:"comic",pathWord:book,entryId:entry.id,group:directory.group,refresh:false})));
  assert.ok(downloaded.every(v=>v.bytes>1000));
  const cached = await call("list_cached_book_content",{kind:"comic",pathWord:book,entryIds:entries.map(e=>e.id)});
  assert.equal(cached.length,2);
  const later = await call("get_book_source_entries",{kind:"comic",pathWord:book,group:directory.group,offset:100,refresh:true});
  assert.ok(later.entries.length>0);
  const laterDownloaded = await call("cache_book_source_content",{kind:"comic",pathWord:book,entryId:later.entries[0].id,group:directory.group,refresh:false});
  assert.ok(laterDownloaded.bytes>1000);
  assert.deepEqual(await call("list_works"),[]);
  const result = {dataDirectory:info.dataDirectory,probes,filled:{apiHost:filled.apiHost,appVersion:filled.appVersion},online:{comicPages:online.pages.length,imageBytes:image.bytes,novelSections:text.sections.length,generatedReadingFiles:false},downloads:downloaded,laterPageDownload:laterDownloaded,personalWorksUnchanged:true};
  await mkdir("artifacts/reading-network",{recursive:true});
  await writeFile("artifacts/reading-network/native-results.json",JSON.stringify(result,null,2));
  console.log("Native concurrent real manga chapter downloads passed; no personal library or real media touched");
} finally { await browser.close(); }
