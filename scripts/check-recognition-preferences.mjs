// Isolated UI fixtures: no real Tauri/database/account or media-file access.
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const artifactDir = "artifacts/recognition-preferences";
await mkdir(artifactDir, { recursive: true });
const harness = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MediaCorrectionDialog} from '/src/components/MediaCorrectionDialog.tsx';
import {RecognitionDialog} from '/src/components/RecognitionDialog.tsx';
import {ResilientImage,RetryImagesButton} from '/src/components/ResilientImage.tsx';
import '/src/styles.css';
import '/src/v1-1-1.css';
const files=['01','02','13'].map((n,i)=>({id:'f'+i,workId:'s1',libraryRootId:'root',path:'C:/媒体/Show/'+n+'.mkv',fileName:'[Test] 这是一个很长的作品名称用于检查布局 ['+n+'].mkv',mediaType:'video',missing:false,parsedEpisode:n,parsedEpisodeStart:Number(n),size:123,extension:'mkv'}));
function App(){
 const [saved,setSaved]=useState(''); const [source,setSource]=useState('/qa-image?one');
 const images=new URLSearchParams(location.search).has('images');
 const memory=new URLSearchParams(location.search).has('memory');
 return images ? React.createElement('div',{},React.createElement(RetryImagesButton),React.createElement('button',{onClick:()=>setSource(previous=>previous==='/qa-image?one'?'/qa-image?two':'/qa-image?one')},'切换图片'),React.createElement(ResilientImage,{sources:[source,'/qa-cache'],alt:'测试封面',fallback:React.createElement('span',{},'图片占位')})) : React.createElement(React.Fragment,{},React.createElement('p',{'data-testid':'saved'},saved),memory?React.createElement(RecognitionDialog,{media:files[0],onClose:()=>{},onMatched:setSaved}):React.createElement(MediaCorrectionDialog,{files,sourceWorkId:'s1',onClose:()=>{},onSaved:setSaved}));
} createRoot(document.getElementById('root')).render(React.createElement(App));`;
const server = await createServer({ server: { host: "127.0.0.1", port: 4193, strictPort: true }, plugins: [{
  name: "isolated-recognition-ui", resolveId(id) { if (id === "virtual:recognition-qa") return "\0recognition-qa"; },
  load(id) { if (id === "\0recognition-qa") return harness; },
  configureServer(vite) { vite.middlewares.use("/__qa_recognition", async (_req,res) => {
    res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml('/__qa_recognition','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><div id="portal-root"></div><script type="module" src="/@id/__x00__recognition-qa"></script></body></html>'));
  }); },
}] });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  const page = await browser.newPage(); const errors=[]; page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
  page.on("console",msg=>{if(msg.type()==="error") console.error(msg.text());});
  page.on("response",res=>{if(res.status()>=400) console.error(res.status()+" "+res.url());});
  await page.addInitScript(() => {
    window.__qaCalls=[];
    window.__TAURI_INTERNALS__={invoke:async(cmd,args)=> {
      window.__qaCalls.push({cmd,args});
      if(cmd==='list_works') return [{id:'s1',title:'第一季',type:'video'},{id:'s2',title:'第二季',type:'video'}];
      if(cmd==='list_match_candidates') return [];
      if(cmd==='list_recognition_group_members') return {members:[{id:'f0',workId:'s1',fileName:'Show [01].mkv',path:'C:/Show/01.mkv',mediaType:'video',parsedEpisode:'1',parsedSeason:1,missing:false}],linkedWorkId:null};
      if(cmd==='list_recognition_preferences') return [{id:'p1',workId:'s1',title:'第一季',kind:'anime',updatedAt:'now'},{id:'p2',workId:'s2',title:'第二季',kind:'anime',updatedAt:'now'}];
      if(cmd==='forget_recognition_preference') return null;
      if(cmd==='preview_media_correction') return {token:'preview-token',title:'第二季',warnings:['暂无官方分集，将保留人工集号。'],rows:args.input.mediaFileIds.map((id,i)=>({id,fileName:'Show ['+(i+1)+'].mkv',episode:i+1,oldEpisode:'13',fromTitle:'第一季',officialTitle:null}))};
      if(cmd==='apply_media_correction') return 's2';
      throw new Error('Unexpected mock command: '+cmd);
    }};
  });
  for(const [width,height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:4193/__qa_recognition');
    await page.waitForSelector('.media-correction',{timeout:10000}).catch(async e=>{console.error(await page.locator('body').innerText());await page.screenshot({path:artifactDir+'/failure.png'});throw e;});
    await page.getByRole('button',{name:'全选 / 清空'}).click();
    await page.getByLabel('纠错目标作品').selectOption('s2');
    await page.getByLabel('编号方式').selectOption('sequence');
    await page.getByRole('button',{name:'预览调整'}).click();
    await page.getByLabel('批量纠错预览').waitFor();
    assert.equal(await page.getByRole('button',{name:'确认保存'}).isEnabled(),false);
    await page.getByText('我已核对文件范围、目标作品与逐行集号').click();
    assert.equal(await page.getByRole('button',{name:'确认保存'}).isEnabled(),true);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('.modal,.modal-body,.media-correction')].some(e=>e.scrollWidth>e.clientWidth+2));
    assert.equal(overflow,false,`horizontal overflow ${width}x${height}`);
    await page.screenshot({path:artifactDir+'/'+width+'x'+height+'.png'});
    await page.getByRole('button',{name:'确认保存'}).click();
    await page.getByTestId('saved').filter({hasText:'s2'}).waitFor();
    const calls=await page.evaluate(()=>window.__qaCalls); assert.equal(calls.filter(c=>c.cmd==='apply_media_correction').at(-1).args.token,'preview-token');
  }
  await page.goto('http://127.0.0.1:4193/__qa_recognition?memory');
  await page.getByLabel('已确认识别推荐').waitFor();
  assert.match(await page.getByLabel('已确认识别推荐').innerText(),/存在多个确认结果/);
  assert.equal(await page.evaluate(()=>window.__qaCalls.some(c=>c.cmd==='apply_media_correction')),false);
  await page.getByRole('button',{name:'忘记推荐'}).first().click();
  await page.waitForFunction(()=>document.querySelectorAll('button').length>0 && document.body.textContent.includes('这只是推荐'));
  await page.getByRole('button',{name:'核对并关联'}).click();
  await page.getByRole('button',{name:'预览调整'}).click();
  await page.getByText('我已核对文件范围、目标作品与逐行集号').click();
  await page.getByRole('button',{name:'确认保存'}).click();
  await page.getByTestId('saved').filter({hasText:'s2'}).waitFor();
  const remembered=await page.evaluate(()=>window.__qaCalls.find(c=>c.cmd==='apply_media_correction'));
  assert.deepEqual(remembered.args.input.mediaFileIds,['f0']);
  let succeed=false; let cache=true; const requests=[];
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7z8AAAAASUVORK5CYII=';
  await page.route('**/qa-image?*',async route=>{requests.push(route.request().url());await route.fulfill({headers:{'Cache-Control':'no-store'},...(succeed?{status:200,contentType:'image/png',body:Buffer.from(image,'base64')}:{status:404,body:'missing'})});});
  await page.route('**/qa-cache',route=>route.fulfill({headers:{'Cache-Control':'no-store'},...(cache?{status:200,contentType:'image/png',body:Buffer.from(image,'base64')}:{status:404,body:'missing'})}));
  await page.goto('http://127.0.0.1:4193/__qa_recognition?images');
  await page.waitForFunction(()=>document.querySelector('img')?.getAttribute('src')==='/qa-cache' && document.querySelector('img')?.naturalWidth>0);
  cache=false;
  await page.goto('http://127.0.0.1:4193/__qa_recognition?images&failed');
  await page.getByText('图片占位',{exact:true}).waitFor();
  succeed=true;
  await page.getByRole('button',{name:'重试图片'}).click();
  await page.waitForFunction(()=>document.querySelector('img')?.getAttribute('src')==='/qa-image?one' && document.querySelector('img')?.naturalWidth>0);
  await page.getByRole('button',{name:'切换图片'}).click();
  await page.waitForFunction(()=>document.querySelector('img')?.getAttribute('src')==='/qa-image?two' && document.querySelector('img')?.naturalWidth>0);
  await page.getByRole('button',{name:'切换图片'}).click();
  await page.waitForFunction(()=>document.querySelector('img')?.getAttribute('src')==='/qa-image?one' && document.querySelector('img')?.naturalWidth>0);
  const count=requests.length;await page.getByRole('button',{name:'重试图片'}).click();assert.equal(requests.length,count);
  assert.deepEqual(errors,[]);
  console.log('PASS: three window sizes, explicit preview/save, conflicting recommendations/forget, cache fallback, changed-source recovery, failed-image retry without reloading valid images.');
} finally { await browser.close();await server.close(); }
