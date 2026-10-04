// Real IPC smoke test against the isolated Sync Test app. Never point it at a personal instance.
import { chromium } from "playwright-core";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9225");
const page = browser.contexts()[0].pages()[0];
const call = (command, args = {}) => page.evaluate(([command,args]) => window.__TAURI_INTERNALS__.invoke(command,args), [command,args]);
const info = await call("get_app_info");
assert.equal(path.basename(info.dataDirectory), "com.genzo.desktop.sync-test", "Never run this fixture against the user's library");
const initial = await call("sync_status");
const resume = process.argv.includes("--resume");
assert.equal(initial.connected, resume, "Use a fresh isolated test profile, or --resume only after the interrupted synthetic fixture run");
const input = {title:"WebDAV Windows verification",originalTitle:null,type:"video",description:"Synthetic verification work",coverPath:null,status:"planned",favorite:false,rating:8,notes:"Initial PC note",tags:["sync-fixture"]};
let work;
if (!resume) {
for (const previous of await call("list_works")) {
  if (previous.title === input.title && previous.mediaCount === 0) {
    const detail = await call("get_work", {id:previous.id});
    if (detail.notes === input.notes && detail.description === input.description) await call("delete_work",{id:previous.id});
  }
}
work = await call("create_work",{input});
} else { work = (await call("list_works")).find(w=>w.title===input.title); assert.ok(work); assert.equal(initial.endpoint,"http://127.0.0.1:18485/"); }
await page.getByRole("link",{name:"设置",exact:true}).click();
await page.getByRole("tab",{name:"个人同步",exact:true}).click();
if (!resume) {
await page.getByLabel("专用 WebDAV 同步目录",{exact:true}).fill("http://127.0.0.1:18485/");
await page.getByLabel("账号",{exact:true}).fill("wrong");
await page.getByLabel("密码",{exact:true}).fill("p");
await page.getByLabel("仅用于本机隔离服务的 HTTP 测试").check();
await page.getByRole("button",{name:"测试连接",exact:true}).click();
await page.getByRole("alert").filter({hasText:"AUTH_REQUIRED"}).waitFor();
assert.equal((await call("sync_status")).connected,false);
await page.getByLabel("账号",{exact:true}).fill("u");
await page.getByRole("button",{name:"测试连接",exact:true}).click();
await page.getByRole("status").filter({hasText:"认证、读写和条件写入测试通过"}).waitFor();
await page.getByRole("button",{name:"创建同步空间",exact:true}).click();
await page.getByRole("button",{name:"立即同步 / 重试",exact:true}).waitFor();
await call("sync_set_enabled",{enabled:false});
await call("update_work",{id:work.id,input:{...input,notes:"PC offline note"}});

// Model another protocol-compatible device using a CAS update of the isolated fixture only.
const headers={Authorization:"Basic dTpw"};
const response=await fetch("http://127.0.0.1:18485/state.json",{headers});
assert.equal(response.status,200);
const document=await response.json();
const entity=Object.values(document.operations).find(op=>op.field==="title" && op.value===input.title).entity;
const clock={};
for (const op of Object.values(document.operations)) clock[op.deviceId]=Math.max(clock[op.deviceId]??0,op.counter);
const device=randomUUID();
for (const [index,[field,value]] of [["notes","Other device offline note"],["favorite",true]].entries()) {
  const counter=index+1,id=`${device}:${counter}`;
  document.operations[id]={id,deviceId:device,counter,context:{...clock,...(index?{[device]:index}:{})},entity,field,value,observedAt:new Date().toISOString(),origin:"manual"};
}
document.revision++;
const put=await fetch("http://127.0.0.1:18485/state.json",{method:"PUT",headers:{...headers,"If-Match":response.headers.get("etag"),"Content-Type":"application/json"},body:JSON.stringify(document)});
assert.equal(put.status,201);
}
await page.getByRole("button",{name:"立即同步 / 重试",exact:true}).click();
await page.getByRole("heading",{name:"笔记有两端修改"}).waitFor();
const conflicts=await call("sync_conflicts");
assert.equal(conflicts.find(c=>c.field==="notes").candidates.length,2);
assert.equal((await call("get_work",{id:work.id})).favorite,true);
await mkdir("artifacts/sync-v1/screenshots",{recursive:true});
const windows=[];
for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]) {
  await page.setViewportSize({width,height});
  const overflow=await page.locator(".settings-drawer").evaluate(el=>el.scrollWidth>el.clientWidth+1);
  assert.equal(overflow,false,`${width} drawer overflow`);
  await page.screenshot({path:`artifacts/sync-v1/screenshots/sync-${width}x${height}.png`});
  windows.push({width,height,horizontalOverflow:false});
}
await page.getByLabel("合并后的笔记",{exact:true}).fill("Combined PC and other device notes");
await page.getByRole("button",{name:"保存合并内容",exact:true}).click();
await page.getByRole("status").filter({hasText:"合并笔记已保存"}).waitFor();
await page.getByRole("button",{name:"立即同步 / 重试",exact:true}).click();
await page.getByRole("status").filter({hasText:"同步完成"}).waitFor();
assert.equal((await call("sync_conflicts")).length,0);
assert.equal((await call("get_work",{id:work.id})).notes,"Combined PC and other device notes");
assert.equal((await call("sync_status")).pending,0);
await page.getByRole("button",{name:"关闭设置",exact:true}).click();
await page.goto(`http://tauri.localhost/#/library/${work.id}`);
await page.getByLabel("点评 / 备注",{exact:true}).fill("Unsaved local draft must remain");
const latestResponse=await fetch("http://127.0.0.1:18485/state.json",{headers:{Authorization:"Basic dTpw"}});
const latest=await latestResponse.json();
const currentDevice=(await call("sync_status")).deviceId;
const otherDevice=Object.values(latest.operations).find(op=>op.deviceId!==currentDevice).deviceId;
const latestClock={};for(const op of Object.values(latest.operations)) latestClock[op.deviceId]=Math.max(latestClock[op.deviceId]??0,op.counter);
const nextCounter=latestClock[otherDevice]+1,id=`${otherDevice}:${nextCounter}`;
const workEntity=Object.values(latest.operations).find(op=>op.field==="title"&&op.value===input.title).entity;
latest.operations[id]={id,deviceId:otherDevice,counter:nextCounter,context:latestClock,entity:workEntity,field:"favorite",value:false,observedAt:new Date().toISOString(),origin:"manual"};latest.revision++;
const changed=await fetch("http://127.0.0.1:18485/state.json",{method:"PUT",headers:{Authorization:"Basic dTpw","If-Match":latestResponse.headers.get("etag")},body:JSON.stringify(latest)});assert.equal(changed.status,201);
await call("sync_now");
await page.getByRole("button",{name:"加入收藏",exact:true}).waitFor();
assert.equal(await page.getByLabel("点评 / 备注",{exact:true}).inputValue(),"Unsaved local draft must remain");
await writeFile("artifacts/sync-v1/native-ui-results.json",JSON.stringify({realIpc:true,authFailure:true,probe:true,create:true,mergeFavorite:true,concurrentNotes:2,resolution:true,unsavedDraftPreserved:true,pending:0,windows},null,2));
console.log("Real Windows IPC, authentication, create, merge, conflict resolution and three window sizes passed");
await browser.close();
