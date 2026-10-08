import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial="3B164M00Z0500000",app="com.genzo.android.readerqa",output=`D:/DevTools/Android/Build/qa/comic-four-${Date.now()}`;
mkdirSync(output,{recursive:true});const cmd=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});const pause=ms=>new Promise(r=>setTimeout(r,ms));
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
function png(red){const width=800,height=900,raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*3+1)+1+x*3;raw[i]=red;raw[i+1]=(Math.floor(y/100)%2)*100+80;raw[i+2]=180;}
 const chunk=(type,bytes)=>{const name=Buffer.from(type),size=Buffer.alloc(4),hash=Buffer.alloc(4);size.writeUInt32BE(bytes.length);hash.writeUInt32BE(crc(Buffer.concat([name,bytes])));return Buffer.concat([size,name,bytes,hash]);};const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);}
const images=[png(210),png(110),png(50),png(160),png(80),png(30)];const requests=[],requestTimes=[];const namespace=`comic-four-${Date.now()}`;let root="",failures=new Map(),archivePath=null;
const keys=images.map((_,i)=>createHash("sha256").update(`${namespace}/original/${i}`).digest("hex"));
const server=createServer((request,response)=>{
 const route=request.url.split("?")[0].split("/").slice(2).join("/");
 if(request.method==="POST"){response.writeHead(200,{"Content-Type":"application/json"});response.end("{}");return;}
 if(route==="entries/0"){response.setHeader("Content-Type","application/json");response.end(JSON.stringify({total:1,entries:[{id:"one",title:"自制漫画",order:0,count:images.length}]}));return;}
 if(route==="chapter/one") {response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({kind:"comic",entryId:"one",title:"自制漫画",offline:!!archivePath,archivePath,archiveEntries:images.map((_,i)=>`${i}.png`),pages:images.map((_,i)=>`${root}chapter/one/page/${i}`),cacheKeys:keys,location:{pageIndex:0,offset:0}}));return;}
 const index=Number(route.split("/").at(-1));requests.push(index);requestTimes.push(Date.now());failures.set(index,(failures.get(index)||0)+1);
 if(index===5&&failures.get(index)===1){response.writeHead(503);response.end();return;}
 setTimeout(()=>{if(response.destroyed)return;response.writeHead(200,{"Content-Type":"image/png"});response.end(images[index]);},index===0?2800:150);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const port=server.address().port;root=`http://127.0.0.1:${port}/${namespace}/`;cmd("reverse",`tcp:${port}`,`tcp:${port}`);
cmd("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await pause(1200);const pid=cmd("shell","pidof",app).trim();assert.match(pid,/^\d+$/);cmd("forward","tcp:9344",`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9344",{noDefaults:true}),page=browser.contexts()[0].pages()[0];
const invoke=(command,args={})=>page.evaluate(({command,args})=>Promise.race([window.__TAURI_INTERNALS__.invoke(command,args),new Promise((_,reject)=>setTimeout(()=>reject(Error(`IPC timeout: ${command}`)),15000))]),{command,args});const native=(command,payload={})=>invoke("android_native",{command,payload});
const state=()=>native("readerState");const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await state()).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
async function until(predicate,label){for(let attempt=0;attempt<100;attempt++){const value=await state();if(predicate(value))return value;await pause(100);}throw Error(label);}
const capture=name=>writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:16*1024*1024}));const result={output,cases:{}};let original;
try{
 assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);const before=await invoke("list_works");
 if((await state()).status!=="closed"){await control("close");await pause(400);}
 await native("openComicFixture",{sessionId:namespace,baseUrl:root,kind:"comic",entryId:"one"});await until(s=>s.kind==="comic"&&s.status!=="closed","fixture opens");original=(await state()).settings;
 await control("settings",0,{mode:"scroll-vertical",autoScroll:false,gap:0,imageRetries:1,imageTimeout:15});await pause(250);
 assert.equal((await state()).rendered,false);cmd("shell","input","tap","630","1300");await pause(400);const first=(await state()).menuVisible;cmd("shell","input","tap","630","1300");await pause(400);assert.notEqual((await state()).menuVisible,first);result.cases.menuDuringLoading=true;capture("loading-menu");
 await until(s=>s.rendered,"first image loaded");const firstRequest=requests.indexOf(0);assert.ok(firstRequest<3);assert.ok(requestTimes[firstRequest]-requestTimes[0]<120,"visible image does not wait for slow neighbors to release slots");result.cases.visibleImageFirst={requestDelayMs:requestTimes[firstRequest]-requestTimes[0]};
 if((await state()).menuVisible)await control("menu");await pause(400);
 cmd("push","D:/DevTools/Android/Build/qa/reader-c/gesture/reader-gesture.jar","/data/local/tmp/genzo-reader-gesture.jar");
 cmd("shell","CLASSPATH=/data/local/tmp/genzo-reader-gesture.jar","app_process","/","com.genzo.qa.ReaderGesture","636","1300");
 const zoomed=await until(s=>s.zoomRatio>1.4,"whole-list pinch");assert.ok(zoomed.visiblePages.length>=2);for(const item of zoomed.visiblePages){assert.ok(Math.abs(item.visualWidth/item.width-zoomed.zoomRatio)<.01);assert.ok(item.localZoom<1.01);}result.cases.globalZoom={ratio:zoomed.zoomRatio,pages:zoomed.visiblePages};capture("whole-list-zoom");
 cmd("shell","input","swipe","1000","1300","300","1300","600");await pause(300);const panned=await state();assert.ok(panned.zoomRatio>1.4);assert.notEqual(panned.zoomDiagnostics.offsetX,zoomed.zoomDiagnostics.offsetX);result.cases.horizontalPan={before:zoomed.zoomDiagnostics.offsetX,after:panned.zoomDiagnostics.offsetX};
 await control("settings",0,{mode:"page-horizontal"});await control("seek",1);await until(s=>s.rendered,"automatic image retry");assert.equal(failures.get(5),2);result.cases.retryOnce=true;
 await control("settings",0,{mode:"scroll-vertical"});await control("seek",0);await until(s=>s.rendered,"return to first image");const count=requests.filter(i=>i===0).length;await control("close");await pause(400);
 root=`http://127.0.0.1:${port}/${namespace}-second/`;const started=Date.now();await native("openComicFixture",{sessionId:`${namespace}-second`,baseUrl:root,kind:"comic",entryId:"one"});await until(s=>s.rendered,"disk cache reopening");assert.equal(requests.filter(i=>i===0).length,count);result.cases.diskCacheReopen={milliseconds:Date.now()-started};
 await control("menu");await pause(300);const chrome=await state();assert.ok(chrome.contentTop>0,"artwork stays below status/cutout");result.cases.statusBackground={contentTop:chrome.contentTop,color:chrome.chromeColor};capture("status-chrome");
 await control("close");await pause(300);
 const local=[],central=[];let position=0;
 images.forEach((bytes,index)=>{const name=Buffer.from(`${index}.png`),header=Buffer.alloc(30),entry=Buffer.alloc(46);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc(bytes),14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
 entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc(bytes),16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(position,42);local.push(header,name,bytes);central.push(entry,name);position+=header.length+name.length+bytes.length;});
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(images.length,8);end.writeUInt16LE(images.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(position,16);
 const zipFile=`${output}/generated.cbz`;writeFileSync(zipFile,Buffer.concat([...local,directory,end]));cmd("push",zipFile,`/data/local/tmp/${namespace}.cbz`);cmd("shell","run-as",app,"mkdir","-p","reading-cache");cmd("shell","run-as",app,"cp",`/data/local/tmp/${namespace}.cbz`,`reading-cache/${namespace}.cbz`);archivePath=`/data/user/0/${app}/reading-cache/${namespace}.cbz`;
 const beforeArchive=requests.length;await native("openComicFixture",{sessionId:`${namespace}-archive`,baseUrl:root,kind:"comic",entryId:"one"});await until(s=>s.rendered,"offline archive");
 for(const mode of ["scroll-vertical","scroll-horizontal","page-horizontal","page-vertical"]){await control("settings",0,{mode});await control("seek",0);const value=await until(s=>s.rendered&&s.imageGeometry?.source==="local-cbz",mode);if(mode.startsWith("page")){const g=value.imageGeometry;assert.ok(Math.abs((g.left+g.right)-g.width)<3);assert.ok(Math.abs((g.top+g.bottom)-g.height)<3);}}
 assert.equal(requests.length,beforeArchive);result.cases.offlineArchiveFourModes=true;
 assert.deepEqual((await invoke("list_works")).map(w=>[w.id,w.notes,w.status,w.favorite]),before.map(w=>[w.id,w.notes,w.status,w.favorite]));
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);result.state=await state().catch(()=>null);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}
finally{if((await state().catch(()=>({status:"closed"}))).status!=="closed"){if(original)await control("settings",0,original).catch(()=>{});await control("close").catch(()=>{});}await browser.close();cmd("reverse","--remove",`tcp:${port}`);await new Promise(resolve=>server.close(resolve));}
