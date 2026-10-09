import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial="3B164M00Z0500000",app="com.genzo.android.readerqa";
const name=`comic-smooth-${Date.now()}`,output=`D:/DevTools/Android/Build/qa/${name}`;mkdirSync(output,{recursive:true});
const cmd=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});const pause=ms=>new Promise(r=>setTimeout(r,ms));
function crc(bytes){let n=0xffffffff;for(const byte of bytes){n^=byte;for(let b=0;b<8;b++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function png(height){const width=2000,raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*3+1)+1+x*3;raw[i]=236;raw[i+1]=229;raw[i+2]=208;}
 const chunk=(type,bytes)=>{const n=Buffer.from(type),s=Buffer.alloc(4),c=Buffer.alloc(4);s.writeUInt32BE(bytes.length);c.writeUInt32BE(crc(Buffer.concat([n,bytes])));return Buffer.concat([s,n,bytes,c]);};const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",h),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);}
const images=[2800,2100,3150,1400].map(png),count=24,done=new Set();let root;
const server=createServer((req,res)=>{const route=req.url.split("?")[0].split("/").slice(2).join("/");if(req.method==="POST"){res.end("{}");return;}
 if(route==="entries/0"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({total:1,entries:[{id:"one",title:"流畅滚动验证",order:0,count}]}));return;}
 if(route==="chapter/one"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({kind:"comic",entryId:"one",title:"流畅滚动验证",offline:false,pages:Array.from({length:count},(_,i)=>`${root}chapter/one/page/${i}`),cacheKeys:Array.from({length:count},(_,i)=>createHash("sha256").update(`${name}/${i}`).digest("hex")),location:{pageIndex:0,offset:0}}));return;}
 const i=Number(route.split("/").at(-1));res.setHeader("Content-Type","image/png");res.end(images[i%images.length]);done.add(i);
});await new Promise(r=>server.listen(0,"127.0.0.1",r));const port=server.address().port;root=`http://127.0.0.1:${port}/${name}/`;cmd("reverse",`tcp:${port}`,`tcp:${port}`);
cmd("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await pause(800);cmd("forward","tcp:9344",`localabstract:webview_devtools_remote_${cmd("shell","pidof",app).trim()}`);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9344",{noDefaults:true}),page=browser.contexts()[0].pages()[0];
const native=(command,payload={})=>page.evaluate(({command,payload})=>window.__TAURI_INTERNALS__.invoke("android_native",{command,payload}),{command,payload});const state=()=>native("readerState");const control=async(action,value=0,settings)=>native("readerControl",{sessionId:(await state()).sessionId,action,value,settings:settings?JSON.stringify(settings):null});
const capture=file=>writeFileSync(`${output}/${file}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:16*1024*1024}));let original;const result={};
try{
 if((await state()).status!=="closed")await control("close");await native("openComicFixture",{sessionId:name,baseUrl:root,kind:"comic",entryId:"one"});
 for(let i=0;i<100&&!(await state()).rendered;i++)await pause(100);original=(await state()).settings;await control("settings",0,{mode:"scroll-vertical",gap:0,autoScroll:false,dimming:0});
 for(let i=0;i<100&&done.size<count;i++)await pause(100);assert.equal(done.size,count);await control("seek",0);await pause(1000);
 if((await state()).menuVisible)await control("menu");await pause(350);const hidden=await state();capture("hidden");
 assert.equal(hidden.contentTop,0);assert.equal(hidden.statusBackgroundVisible,false);
 await control("menu");await pause(350);const shown=await state();capture("shown");
 assert.equal(shown.statusBackgroundVisible,true);assert.ok(shown.statusBackgroundHeight>0);assert.equal(shown.viewportHeight,hidden.viewportHeight);assert.equal(shown.viewportWidth,hidden.viewportWidth);
 await control("menu");await pause(350);assert.equal((await state()).zoomDiagnostics.sizeResets,hidden.zoomDiagnostics.sizeResets);
 result.chrome={hidden,shown};
 const video=`${output}/scroll.mp4`;
 const recording=spawn("D:/DevTools/Android/Tools/scrcpy-5.0/scrcpy-win64-v5.0/scrcpy.exe",["--serial",serial,"--no-window","--no-control","--no-audio","--max-size=1568","--max-fps=60","--video-bit-rate=6M","--time-limit=10",`--record=${video}`],{env:{...process.env,ADB:adb},stdio:["ignore","pipe","pipe"]});let recordError="";recording.stderr.on("data",x=>recordError+=x);const completed=new Promise((r,j)=>recording.on("close",code=>code===0?r():j(Error(recordError))));completed.catch(()=>{});await pause(1200);if(recording.exitCode!==null)await completed;
 result.scroll=[];for(let i=0;i<9;i++){cmd("shell","input","swipe","636","2100","636","700","650");const s=await state();result.scroll.push({page:s.location.pageIndex,viewport:s.viewportHeight,visible:s.visiblePages});}
 await completed;capture("after-scroll");
 assert.ok(result.scroll.every(s=>s.viewport===hidden.viewportHeight));assert.ok(result.scroll.at(-1).page>=8);
 result.output=output;console.log(JSON.stringify({output,viewportStable:true,lastPage:result.scroll.at(-1).page}));
}catch(error){result.error=String(error);throw error;}finally{writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));if((await state()).status!=="closed"){if(original)await control("settings",0,original);await control("close");}await browser.close();cmd("reverse","--remove",`tcp:${port}`);await new Promise(r=>server.close(r));}
