// Must connect to the uniquely isolated Book Content QA app, never a personal instance.
import { chromium } from "playwright-core";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const browser=await chromium.connectOverCDP("http://127.0.0.1:9237");
try {
  const page=browser.contexts()[0].pages()[0];
  await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__?.invoke);
  const call=(command,args={})=>page.evaluate(([command,args])=>window.__TAURI_INTERNALS__.invoke(command,args),[command,args]);
  const info=await call("get_app_info");
  assert.match(path.basename(info.dataDirectory),/^com\.genzo\.desktop\.book-content-qa-[a-f0-9]{32}$/);
  const initial=await call("list_works");assert.ok(initial.every(w=>w.title.startsWith("合成测试")&&w.mediaCount===0),"Use a synthetic profile");
  const results=[];
  for (const [kind,source,entry] of [["novel","qa-novel","v1"],["comic","qa-comic","c1"]]) {
    const id=await call(kind==="novel"?"save_novel_explore_work":"save_comic_explore_work",{pathWord:source,favorite:true});
    assert.equal(await call(kind==="novel"?"save_novel_explore_work":"save_comic_explore_work",{pathWord:source,favorite:false}),id);
    assert.deepEqual(await call("get_book_reading_source",{workId:id}),{kind,pathWord:source});
    const work=await call("get_work",{id});assert.equal(work.type,kind);assert.equal(work.favorite,true);assert.equal(work.mediaFiles.length,0);
    const catalogue=await call("get_book_source_entries",{kind,pathWord:source,group:"",offset:0,refresh:false});assert.equal(catalogue.entries[0].id,entry);
    const cached=await call("list_cached_book_content",{kind,pathWord:source,entryIds:[entry]});assert.equal(cached.length,1);
    // Complete-cache reuse goes through real Rust IPC and cannot request upstream content.
    const reused=await call("cache_book_source_content",{kind,pathWord:source,entryId:entry,group:catalogue.group,refresh:false});assert.equal(reused.entryId,entry);
    await call("open_cached_book_content",{kind,pathWord:source,entryId:entry,folder:false});
    let opened;
    for(let attempt=0;attempt<30;attempt++) {try {opened=JSON.parse(await readFile(path.join(info.dataDirectory,"reader-result.json"),"utf8"));if(opened.file.endsWith(kind==="novel"?"volume.epub":"chapter.cbz"))break;}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.ok(opened.exists);assert.ok(opened.file.startsWith(info.dataDirectory));
    const after=await call("get_work",{id});assert.equal(after.status,work.status);assert.equal(after.notes,work.notes);
    await page.goto(`http://127.0.0.1:4187/#/bookshelf/${id}`);await page.locator(".book-source-content").getByRole("button",{name:"打开",exact:true}).waitFor();
    assert.equal(await page.getByRole("link",{name:"书架",exact:true}).getAttribute("aria-current"),"page");
    await mkdir("artifacts/book-content/native",{recursive:true});await page.screenshot({path:`artifacts/book-content/native/${kind}.png`});
    await call("clear_cached_book_content",{kind,pathWord:source,entryId:entry});
    assert.equal((await call("list_cached_book_content",{kind,pathWord:source,entryIds:[entry]})).length,0);
    assert.equal((await call("get_work",{id})).favorite,true);
    results.push({kind,identity:true,idempotentImport:true,completeCacheReuse:true,structuredReaderLaunch:true,openDoesNotMarkRead:true,clearKeepsWork:true});
  }
  // Live metadata only. Does not fetch page images, TXT bodies, or source credentials.
  const novel="wuzhizhuanshengdaoleyishijiejiunachuzhenbenshi";
  const details=await call("get_novel_explore_detail",{pathWord:novel,refresh:true});assert.equal(details.item.pathWord,novel);
  const volumes=await call("get_book_source_entries",{kind:"novel",pathWord:novel,group:"",offset:0,refresh:true});assert.ok(volumes.total>0);
  const chapters=await call("get_book_source_entries",{kind:"comic",pathWord:"modujingbingdenuli",group:"default",offset:0,refresh:true});assert.ok(chapters.total>0);
  const next=await call("get_book_source_entries",{kind:"comic",pathWord:"modujingbingdenuli",group:chapters.group,offset:chapters.entries.length,refresh:true});assert.ok(next.entries.length>0);
  results.push({liveMetadata:true,novelVolumes:volumes.total,comicChapters:chapters.total,liveBodies:false});
  await writeFile("artifacts/book-content/native/results.json",JSON.stringify({profile:info.dataDirectory,results},null,2));
  console.log("Native IPC passed: independent source identities, repeated imports, verified cache, external reader arguments, manual read state, safe clearing; live catalogue metadata passed");
} finally {await browser.close();}
