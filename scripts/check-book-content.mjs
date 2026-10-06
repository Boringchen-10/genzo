// Synthetic metadata and IPC only. No real library, credentials or third-party bodies.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
const base = process.env.GENZO_TEST_URL || "http://127.0.0.1:4187";
const output = "artifacts/book-content";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const results = [];
try {
  for (const dark of [false, true]) for (const [width, height] of [[1024,640], [1366,768], [1920,1080]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.addInitScript(dark => {
      localStorage.setItem("genzo-theme", dark ? "dark" : "light");
      window.isTauri = true; window.__bookCalls = []; window.__bookCache = {}; window.__bookFail = true; window.__bookHold = false; window.__bookWaiters = [];
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      const item = id => ({ pathWord:id,title:`测试轻小说 ${id}`,coverUrl:null,authors:["测试作者"],tags:["冒险"],summary:"这是一段合成的作品简介。",status:"已完结",updatedAt:"2026-10-05",latestChapter:"第2卷",localWorkId:null,favorite:false });
      window.__TAURI_INTERNALS__ = { metadata:{currentWindow:{label:"main"}}, convertFileSrc:p=>p, transformCallback:()=>1, unregisterCallback:()=>{}, invoke:async(command,args={})=>{
        window.__bookCalls.push({command,args});
        if (command === "list_novel_explore" || command === "list_comic_explore") return { items:Array.from({length:args.input.page===1?24:6},(_,i)=>item(`book-${(args.input.page-1)*24+i}`)), total:30,page:args.input.page,stale:false };
        if (command === "get_novel_explore_themes" || command === "get_comic_explore_themes") return [{name:"冒险",pathWord:"adventure"}];
        if (command === "get_novel_explore_detail" || command === "get_comic_explore_detail") return {item:item(args.pathWord),aliases:[],chapterCount:2,stale:false};
        if (command === "get_book_source_entries") return {entries:[{id:"v1",title:"第1卷 一个很长的测试标题用来检查文字换行",order:0,count:2},{id:"v2",title:"第2卷",order:1,count:2}],total:2,offset:0,group:args.kind==="comic"?"default":"",groups:[],stale:false};
        if (command === "list_cached_book_content") return Object.entries(window.__bookCache).filter(([key])=>key.startsWith(`${args.kind}:`)).map(([,value])=>value);
        if (command === "cache_book_source_content") {
          await new Promise(r=>setTimeout(r,50));
          if (window.__bookFail) {window.__bookFail=false;throw "正文传输中断，原有缓存保留";}
          if (window.__bookHold) await new Promise(resolve => window.__bookWaiters.push(resolve));
          const value={entryId:args.entryId,title:"第1卷",format:args.kind==="novel"?"EPUB":"CBZ",bytes:1048576,cachedAt:"2026-10-05"}; window.__bookCache[`${args.kind}:${args.entryId}`]=value;return value;
        }
        if (command === "open_cached_book_content") return null;
        if (command === "clear_cached_book_content") {delete window.__bookCache[`${args.kind}:${args.entryId}`];return null;}
        if (command === "save_novel_explore_work") return "novel-work";
        if (command === "get_setting") return null;
        if (command === "get_reading_network") return {apiHost:"api.copy202601.com",appVersion:"3.0.9",route:0,node:"",proxyMode:"system",proxyUrl:"",autoUpdate:true,updatedAt:null,attemptedAt:null,comicConcurrency:4,novelConcurrency:2};
        if (command === "save_reading_network") {window.__readingSaved=args.config;return null;}
        if (command === "test_reading_network") return [{host:"mapi.hotmangasg.com",route:0,milliseconds:100,error:null},{host:"mapi.elfgjfghkk.club",route:1,milliseconds:80,error:null},{host:"api.copy202601.com",route:null,milliseconds:null,error:"连接失败"}];
        if (command === "get_app_info") return {name:"Genzo",version:"0.6.0-alpha.1",dataDirectory:"qa",databasePath:"qa"};
        if (command.startsWith("plugin:")) return null;
        return [];
      }};
    }, dark);
    await page.goto(`${base}/#/explore?type=novel`, {waitUntil:"domcontentloaded"});
    const cards=page.locator(".comic-explore-card");await cards.first().waitFor();
    assert.equal(await cards.count(),24);
    assert.equal(await page.getByRole("tab",{name:"轻小说",exact:true}).getAttribute("aria-selected"),"true");
    assert.equal(await page.getByLabel("漫画目录").count(),0);
    await page.getByRole("button",{name:/展开更多作品/}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".comic-explore-card").length===30);
    await cards.first().click();
    const panel=page.locator(".book-source-content");await panel.getByRole("heading",{name:"来源分卷"}).waitFor();
    assert.equal(await panel.locator(".book-content-row").count(),2);
    await panel.getByRole("button",{name:"获取",exact:true}).first().click();
    await panel.getByRole("alert").filter({hasText:"正文传输中断，原有缓存保留"}).waitFor();
    assert.equal(await panel.getByRole("button",{name:"打开",exact:true}).count(),0);
    const directoryCalls=await page.evaluate(()=>window.__bookCalls.filter(c=>c.command==="get_book_source_entries").length);
    await panel.getByRole("button",{name:"重试此操作",exact:true}).click();
    await panel.getByRole("button",{name:"打开",exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__bookCalls.filter(c=>c.command==="get_book_source_entries").length),directoryCalls);
    await panel.getByRole("button",{name:"打开",exact:true}).click();
    await panel.getByText("已交给外部阅读器；阅读状态请在书架手动记录。",{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__bookCalls.filter(c=>c.command==="open_cached_book_content").length),1);
    assert.equal(await page.evaluate(()=>window.__bookCalls.some(c=>/read_state|save_book_entry/.test(c.command))),false);
    await panel.getByRole("button",{name:"当前顺序，切换倒序"}).click();
    assert.match(await panel.locator(".book-content-row").first().innerText(),/第2卷/);
    await panel.getByRole("button",{name:/第1卷.*更多操作/}).click();
    await panel.getByRole("menuitem",{name:"打开缓存目录"}).click();
    await panel.getByRole("button",{name:/第1卷.*更多操作/}).click();
    await panel.getByRole("menuitem",{name:"清除本章卷缓存"}).click();
    await panel.getByText("已清除此章卷的生成缓存，作品和个人记录保留。",{exact:true}).waitFor();
    assert.equal(await panel.getByRole("button",{name:"打开",exact:true}).count(),0);
    await page.evaluate(()=>{window.__bookHold=true;});
    await panel.getByRole("button",{name:"获取",exact:true}).first().click();
    const second=panel.getByRole("button",{name:"获取",exact:true}).nth(1);
    assert.equal(await second.isEnabled(),true);await second.click();
    await page.waitForFunction(()=>window.__bookWaiters.length===2);
    await page.evaluate(()=>{window.__bookHold=false;window.__bookWaiters.splice(0).forEach(resolve=>resolve());});
    await page.waitForFunction(()=>document.querySelectorAll('.book-content-row button').length>0 && [...document.querySelectorAll('.book-content-row button')].filter(b=>b.textContent==='打开').length===2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    await page.screenshot({path:`${output}/novel-${dark?"dark":"light"}-${width}.png`,fullPage:true});
    await page.getByRole("button",{name:"返回探索",exact:true}).click();await cards.first().waitFor();assert.equal(await cards.count(),30);
    await page.getByRole("tab",{name:"漫画",exact:true}).click();await cards.first().waitFor();await cards.first().click();
    await panel.getByRole("heading",{name:"来源章节"}).waitFor();
    await panel.getByRole("button",{name:"获取",exact:true}).first().click();await panel.getByRole("button",{name:"打开",exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__bookCalls.filter(c=>c.command==="cache_book_source_content").at(-1).args.kind),"comic");
    await page.screenshot({path:`${output}/comic-${dark?"dark":"light"}-${width}.png`,fullPage:true});
    await page.getByRole("link",{name:"设置",exact:true}).click();
    await page.getByRole("tab",{name:"阅读网络",exact:true}).click();
    const network=page.getByRole("region",{name:"阅读网络设置"});
    await network.getByRole("button",{name:"测速全部节点"}).click();
    await network.getByRole("button",{name:/线路 2.*80 ms/}).click();
    await network.getByLabel("代理设置",{exact:true}).selectOption("manual");
    await network.getByLabel("阅读代理地址",{exact:true}).fill("http://127.0.0.1:7890");
    await network.getByRole("button",{name:"保存阅读网络"}).click();
    await network.getByText(/阅读网络已保存/).waitFor();
    assert.equal(await page.evaluate(()=>window.__readingSaved.route),1);
    assert.equal(await page.evaluate(()=>window.__readingSaved.proxyMode),"manual");
    assert.equal(await page.locator(".settings-drawer").evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
    await page.screenshot({path:`${output}/network-${dark?"dark":"light"}-${width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);results.push({width,height,dark,passed:true});await page.close();
  }
  await writeFile(`${output}/ui-results.json`,JSON.stringify(results,null,2));console.log("Book content UI passed: both kinds, retry, cache/open/clear, source order, expanded-list back, six window/theme combinations");
} finally {await browser.close();}
