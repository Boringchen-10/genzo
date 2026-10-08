import assert from "node:assert/strict";
import {createServer} from "node:http";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial="3B164M00Z0500000",app="com.genzo.android.readerqa";
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:15000});
const output=`D:/DevTools/Android/Build/qa/bangumi-cache-${Date.now()}`;mkdirSync(output,{recursive:true});
let requests=0,unavailable=false;
const server=createServer((request,response)=>{
 if(!request.url.startsWith("/v0/episodes?")){response.writeHead(404);response.end();return;}requests++;
 if(unavailable){response.writeHead(503);response.end();return;}
 response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({data:[{id:9999911,subject_id:777777777,type:0,ep:1,sort:1,name:"Generated episode",name_cn:"自制分集",airdate:"2026-10-01",duration:"00:24:00",desc:"合成缓存测试"}],total:1,limit:100,offset:0}));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const port=server.address().port;command("reverse",`tcp:${port}`,`tcp:${port}`);
command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await new Promise(resolve=>setTimeout(resolve,1000));
const pid=command("shell","pidof",app).trim();assert.match(pid,/^\d+$/);command("forward","tcp:9342",`localabstract:webview_devtools_remote_${pid}`);
let browser=await chromium.connectOverCDP("http://127.0.0.1:9342",{noDefaults:true}),page=browser.contexts()[0].pages()[0];
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const previous=await invoke("get_bangumi_network"),result={output,cases:{}};
try{
 assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);
 const before=await invoke("list_works");await invoke("save_bangumi_network",{config:{mode:"mirror",mirrorUrl:`http://127.0.0.1:${port}`}});
 const args={externalId:"777777777",section:"episodes"};let data=await invoke("get_bangumi_subject_structure",args);assert.equal(data.episodes.length,1);assert.equal(requests,1);result.cases.networkSeed=true;
 const started=Date.now();data=await invoke("get_bangumi_subject_structure",args);assert.equal(data.episodes.length,1);assert.equal(requests,1);result.cases.cacheHit={milliseconds:Date.now()-started};
 await browser.close();command("shell","am","force-stop",app);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await new Promise(resolve=>setTimeout(resolve,1500));
 const restarted=command("shell","pidof",app).trim();assert.match(restarted,/^\d+$/);command("forward","tcp:9342",`localabstract:webview_devtools_remote_${restarted}`);browser=await chromium.connectOverCDP("http://127.0.0.1:9342",{noDefaults:true});page=browser.contexts()[0].pages()[0];
 data=await invoke("get_bangumi_subject_structure",args);assert.equal(data.episodes.length,1);assert.equal(requests,1);result.cases.restartUsesDiskCache=true;
 unavailable=true;data=await invoke("get_bangumi_subject_structure",{...args,force:true});assert.equal(data.episodes.length,1);assert.equal(requests,2);assert.ok(data.warnings.some(warning=>warning.includes("显示已有缓存")));result.cases.failureKeepsDataAndWarning=true;
 assert.deepEqual((await invoke("list_works")).map(w=>[w.id,w.notes,w.favorite,w.status]),before.map(w=>[w.id,w.notes,w.favorite,w.status]));
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:true}));
}catch(error){result.error=String(error);writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));throw error;}
finally{await invoke("save_bangumi_network",{config:previous});assert.deepEqual(await invoke("get_bangumi_network"),previous);await browser.close();command("reverse","--remove",`tcp:${port}`);await new Promise(resolve=>server.close(resolve));}
