// Mock IPC only; never accesses user media, accounts or the live database.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
const now = new Date().toISOString();
const roots = [{ id:"old",path:"C:\\Old",kind:"video",sourceType:"mounted",availability:"unavailable",enabled:true,createdAt:now,updatedAt:now,lastScannedAt:now },{ id:"new",path:"D:\\New",kind:"video",sourceType:"local",availability:"online",enabled:true,createdAt:now,updatedAt:now,lastScannedAt:now }];
const files = [1,2,3].map(n=>({ id:`old${n}`,workId:"work",title:"保留作品",libraryRootId:"old",path:`C:\\Old\\0${n}.mkv`,rootPath:"C:\\Old",fileName:`0${n}.mkv`,mediaType:"video",size:8000,missing:true,contentFingerprint:null,availability:"unavailable" })).concat([1,2].map(n=>({ id:`new${n}`,workId:null,title:null,libraryRootId:"new",path:`D:\\New\\Show\\0${n}.mkv`,rootPath:"D:\\New",fileName:`0${n}.mkv`,mediaType:"video",size:8000,missing:false,contentFingerprint:null,availability:"online" })));
const browser = await chromium.launch({ executablePath: process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless:true });
try {
  await mkdir("artifacts/screenshots",{recursive:true});
  for (const [width,height] of [[1024,640],[1366,768],[1920,1080]]) {
    const page=await browser.newPage({viewport:{width,height}}); const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(theme => localStorage.setItem("genzo-preferences", JSON.stringify({state:{theme},version:0})), width === 1920 ? "dark" : "light");
    await page.addInitScript(({roots,files})=>{
      window.__maintenanceCalls=[]; window.__revision=1; window.__applied=[];
      Object.defineProperty(window,"__TAURI_INTERNALS__",{value:{convertFileSrc:x=>x,transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command,args)=>{
        if(command==="list_library_roots") return roots;
        if(command==="inspect_library") return ["offline","missing","duplicate","unlinked","mixed"].map(kind=>({kind,total:kind==="offline"?1:0,items:kind==="offline"?[{kind,id:"old",title:"离线挂载",path:"C:\\Old",rootId:"old",workId:null}]:[]}));
        if(command==="list_relocation_files") return files.filter(f=>f.libraryRootId===args.rootId);
        if(command==="preview_media_relocation") { window.__maintenanceCalls.push({command,args}); return {token:String(window.__revision),rows:args.pairs.map(pair=>{const a=files.find(f=>f.id===pair.oldId),b=files.find(f=>f.id===pair.newId);return {pair,oldPath:a.path,newPath:b.path,title:a.title,size:a.size,token:String(window.__revision)};})}; }
        if(command==="apply_media_relocation") { window.__maintenanceCalls.push({command,args}); if(args.token!==String(window.__revision)) throw new Error("预览后文件已变化，请重新预览；未执行迁移"); for(const pair of args.pairs){const a=files.find(f=>f.id===pair.oldId),b=files.find(f=>f.id===pair.newId);a.path=b.path;a.libraryRootId=b.libraryRootId;a.rootPath=b.rootPath;a.missing=false;files.splice(files.indexOf(b),1);} window.__applied.push(...args.pairs);return args.pairs.length; }
        if(command==="list_works" || command.startsWith("list_")) return [];
        return null;
      }}});
    },{roots,files});
    const base=process.env.GENZO_TEST_BASE || "http://127.0.0.1:4190";
    await page.goto(`${base}/#/library`);
    await page.getByRole("button",{name:"媒体库检查 / 路径恢复",exact:true}).click();
    const modal=page.getByRole("dialog",{name:"媒体库检查与路径恢复"});
    await modal.getByRole("button",{name:"来源不可用 1",exact:true}).click();
    await modal.getByText("离线挂载",{exact:true}).waitFor();
    assert.equal(await modal.getByRole("button",{name:"失效路径 0",exact:true}).count(),1);
    await modal.getByRole("button",{name:"路径恢复",exact:true}).click();
    await modal.getByLabel("旧媒体源",{exact:true}).selectOption("old");
    await modal.getByLabel("新媒体源",{exact:true}).selectOption("new");
    await modal.getByLabel("定位方式").selectOption("folder");
    await modal.getByLabel("新文件夹",{exact:true}).selectOption("show");
    await modal.getByRole("button",{name:"预览路径恢复",exact:true}).click();
    await modal.getByText("找到 2 个对应文件；请勾选需要恢复的项目。每批最多 1000 个。",{exact:true}).waitFor();
    await modal.getByText(/1 个旧文件没有唯一目标/).waitFor();
    assert.equal(await page.evaluate(()=>window.__applied.length),0);
    assert.equal(await modal.getByRole("button",{name:"确认恢复 0 个文件"}).isDisabled(),true);
    await modal.locator(".maintenance-row").filter({hasText:"旧：C:\\Old\\02.mkv"}).getByRole("checkbox").check();
    await modal.getByRole("checkbox",{name:/我确认勾选的新旧路径/}).check();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`artifacts/screenshots/library-maintenance-${width}.png`});
    await modal.getByRole("button",{name:"确认恢复 1 个文件"}).click();
    await modal.getByText("已恢复 1 个文件的位置，保留原分集关联和观看进度。",{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__applied),[{oldId:"old2",newId:"new2"}]);
    await modal.getByLabel("定位方式").selectOption("file");
    await modal.getByLabel("旧文件",{exact:true}).selectOption("old1");
    await modal.getByLabel("查找新位置").fill("01.mkv");
    await modal.getByLabel("新文件",{exact:true}).selectOption("new1");
    await modal.getByRole("button",{name:"预览路径恢复",exact:true}).click();
    await modal.locator(".maintenance-row").getByRole("checkbox").check();
    await modal.getByRole("checkbox",{name:/我确认勾选的新旧路径/}).check();
    await page.evaluate(()=>{window.__revision++;});
    await modal.getByRole("button",{name:"确认恢复 1 个文件"}).click();
    await modal.getByRole("alert").filter({hasText:"预览后文件已变化"}).waitFor();
    assert.equal(await page.evaluate(()=>window.__applied.length),1,"stale preview never applied");
    assert.deepEqual(errors,[]);
    console.log(`${width}x${height}: offline separation, folder preview, partial confirmation, single-file search and stale preview passed`);
    await page.close();
  }
} finally { await browser.close(); }
