// Browser UI contract fixture. Backend protocol/cache tests live in remote_storage_tests.rs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
await mkdir("artifacts/screenshots/remote-storage", { recursive: true });
try {
  for (const [width, height] of [[1024,640],[1366,768],[1920,1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const sources = [];
      const roots = [{ id:"mounted",path:"G:\\影音",kind:"video",enabled:true,sourceType:"mounted",availability:"unavailable",createdAt:now,updatedAt:now }];
      globalThis.__remoteCalls = [];
      Object.defineProperty(globalThis, "__TAURI_INTERNALS__", { value: {
        convertFileSrc: value => value,
        invoke: async (command,args) => {
          globalThis.__remoteCalls.push({command,args});
          if (command === "get_setting") return args.key === "storage.cache_limit_gib" ? "20" : "dark";
          if (command === "list_library_roots") return roots;
          if (command === "list_remote_sources") return sources;
          const file = { id:"video",fileName:"Show - 01.mkv",path:"webdav://dav/Show - 01.mkv",libraryRootId:"dav",mediaType:"video",size:10,missing:false,recognitionStatus:"unmatched",createdAt:now,updatedAt:now };
          if (command === "list_unassigned_media_groups" && sources.length) return [{key:"group",title:"Show",folderPath:null,mediaType:"video",fileCount:1,missingCount:0,totalSize:10,recognitionStatus:"unmatched",representative:file}];
          if (command === "list_unassigned_media" && sources.length) return [file];
          const detailFile = {...file,workId:"work",extension:"mkv",parsedMediaInfo:"HEVC · 1080p",fileName:"[字幕组] 示例动画第一季 - 01 [1080p HEVC].mkv"};
          if (command === "get_work") return {id:"work",title:"示例动画",type:"video",description:"WebDAV 分集界面测试",status:"planned",favorite:false,rating:null,notes:"",tags:[],coverPath:null,bannerPath:null,metadataStatus:"matched",createdAt:now,updatedAt:now,mediaFiles:[detailFile],subtitleLinks:[],fieldLocks:[],candidates:[],metadata:{provider:"bangumi",externalId:"1",title:"示例动画",fetchedAt:now}};
          if (command === "get_anime_work_structure") return {workId:"work",bangumiId:"1",seasons:[],staff:[],characters:[],warnings:[],unmatchedFiles:[],episodes:[{provider:"bangumi",externalId:"ep",episodeNumber:1,sortNumber:1,title:"第一集",originalTitle:null,description:"",airDate:null,duration:null,fetchedAt:now,localFiles:[detailFile]}]};
          if (["list_works","list_unassigned_media_groups","list_unassigned_media","list_scan_jobs","list_remote_cache","list_external_tools"].includes(command)) return [];
          if (command === "browse_webdav") return [{href:"/dav/动漫/",name:"动漫",directory:true,size:0}];
          if (command === "add_webdav_source") {
            sources.push({id:"dav",name:args.input.name,endpoint:args.input.endpoint,directory:args.input.directory});
            roots.push({id:"dav",displayName:args.input.name,path:"webdav://dav",kind:"video",sourceType:"webdav",availability:"online",enabled:true,createdAt:now,updatedAt:now});
            return "dav";
          }
          if (command === "scan_library_root") return { id:"scan",libraryRootId:args.id,discoveredCount:12,addedCount:12,updatedCount:0,missingCount:0,status:"completed",errors:[] };
          if (command === "update_library_root") { roots.find(r => r.id === args.id).enabled = args.enabled; return null; }
          return null;
        },
      }});
    });
    await page.goto(`${process.env.GENZO_PREVIEW_URL || "http://127.0.0.1:4177"}/#/library?tab=sources`);
    await page.getByRole("button", { name:"添加 WebDAV", exact:true }).click();
    await page.getByLabel("名称", { exact:true }).fill("我的 Alist 媒体盘");
    await page.getByLabel("WebDAV 服务地址").fill("http://127.0.0.1:5244/dav/");
    await page.getByLabel("用户名", { exact:true }).fill("fixture-user");
    await page.getByLabel("密码 / 应用密码").fill("fixture-password");
    await page.getByRole("button", { name:"测试连接并浏览" }).click();
    await page.getByRole("button", { name:"动漫", exact:true }).click();
    assert.equal(await page.getByLabel("扫描目录（相对于服务地址）").inputValue(), "动漫");
    await page.screenshot({path:`artifacts/screenshots/remote-storage/connect-${width}.png`});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await page.getByRole("button", { name:"选择当前目录并扫描" }).click();
    await page.getByText("已扫描 12 个文件", {exact:true}).waitFor();
    await page.locator(".remote-source").getByRole("button", {name:"停用",exact:true}).click();
    await page.locator(".remote-source").getByRole("button", {name:"启用",exact:true}).waitFor();
    await page.screenshot({path:`artifacts/screenshots/remote-storage/sources-${width}.png`});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await page.getByRole("tab",{name:/待整理/}).click();
    await page.getByText("我的 Alist 媒体盘", {exact:true}).first().waitFor();
    const calls = await page.evaluate(() => globalThis.__remoteCalls);
    assert(calls.some(c => c.command === "add_webdav_source" && c.args.input.directory === "动漫"));
    assert(calls.some(c => c.command === "update_library_root" && c.args.enabled === false));
    await page.goto(`${process.env.GENZO_PREVIEW_URL || "http://127.0.0.1:4177"}/#/library/work`);
    await page.locator(".episode-file-line").waitFor();
    await page.locator(".episode-file-line").scrollIntoViewIfNeeded();
    const rowLayout = await page.locator(".episode-file-line").evaluate(row => {
      const bounds = row.getBoundingClientRect();
      return [...row.children].every(child => { const b=child.getBoundingClientRect();return b.left>=bounds.left-1 && b.right<=bounds.right+1; });
    });
    assert(rowLayout, "Remote file controls must remain inside episode card");
    await page.screenshot({path:`artifacts/screenshots/remote-storage/episode-${width}.png`});
    await page.locator(".episode-file-line").getByRole("button", {name:"保留离线",exact:true}).click();
    await page.getByText("已下载并保留离线",{exact:true}).waitFor();
    assert((await page.evaluate(() => globalThis.__remoteCalls)).some(c => c.command === "cache_remote_media" && c.args.pinned));
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log("WebDAV add/browse/scan/disable/inbox refresh: passed at 1024, 1366, 1920 px.");
} finally { await browser.close(); }
