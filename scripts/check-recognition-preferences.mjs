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
 const filename=new URLSearchParams(location.search).has('filename');
 const diagnostic=new URLSearchParams(location.search).has('diagnostic');
 const diagnosticFiles=['Show S02E01.mkv','Show S02E02.mkv','Show S01E01.mkv','Show S02 NCED01.mkv','Show [01-02].mkv','Show S02E03.mkv'].map((fileName,i)=>({...files[0],id:'f'+i,fileName,missing:i===1}));
 const candidates=diagnostic?diagnosticFiles:filename?files.map((f,i)=>({...f,fileName:'想要成为影之实力者！ - S0'+(i===2?2:1)+'E0'+(i+5)+' - 测试分集.mkv',parsedEpisode:'1',parsedEpisodeStart:1})):files;
 return images ? React.createElement('div',{},React.createElement(RetryImagesButton),React.createElement('button',{onClick:()=>setSource(previous=>previous==='/qa-image?one'?'/qa-image?two':'/qa-image?one')},'切换图片'),React.createElement(ResilientImage,{sources:[source,'/qa-cache'],alt:'测试封面',fallback:React.createElement('span',{},'图片占位')})) : React.createElement(React.Fragment,{},React.createElement('p',{'data-testid':'saved'},saved),memory?React.createElement(RecognitionDialog,{media:files[0],onClose:()=>{},onMatched:setSaved}):React.createElement(MediaCorrectionDialog,{files:candidates,sourceWorkId:'s1',initialTarget:diagnostic?'s2':undefined,initialMode:filename||diagnostic?'parsed':'keep',initialSelected:filename||diagnostic?candidates.map(f=>f.id):[],onClose:()=>{},onSaved:setSaved}));
} createRoot(document.getElementById('root')).render(React.createElement(App));`;
// Static fixtures do not need file watching (the workspace may contain large build snapshots).
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "lucide-react"] }, server: { host: "127.0.0.1", port: 4193, strictPort: true, watch: null }, plugins: [{
  name: "isolated-recognition-ui", resolveId(id) { if (id === "virtual:recognition-qa") return "\0recognition-qa"; },
  load(id) { if (id === "\0recognition-qa") return harness; },
  configureServer(vite) { vite.middlewares.use("/__qa_recognition", async (_req,res) => {
    res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml('/__qa_recognition','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><div id="portal-root"></div><script type="module" src="/@id/__x00__recognition-qa"></script></body></html>'));
  }); },
}] });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(10000); await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4193/')?route.continue():route.abort()); const errors=[]; page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
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
      const diagnostic=new URLSearchParams(location.search).has('diagnostic');
      const diagnosticRow=(id)=>{
        const n=Number(id.slice(1)); const season=n===2?1:2;
        const eligible=n!==2&&n!==4;
        return {id,fileName:'Show '+id+'.mkv',fromTitle:'第一季',season,parsedSeason:season,parsedEpisode:n===4?'01-02':String(n+1),episode:n+1,episodeType:n===3?3:0,oldEpisode:'1',primaryProvider:'bangumi',officialEpisodeId:'ep'+n,officialTitle:n===3||n===4?null:'官方第'+(n+1)+'集',eligible,reliable:n===0,artworkSeason:n===0?1:null,artworkEpisode:n===0?13:null,artworkAvailable:n===0,issues:n===0?[]:[{code:n===1?'path_unavailable':n===2?'season_conflict':n===3?'special':n===4?'episode_unknown':'manual_existing',message:['','路径暂不可用','文件季度与目标作品不一致','片尾单独核对','一个文件包含多集','已有人工关联'][n],action:n===2?'choose_season':n===4?'sequence':'review'}]};
      };
      if(cmd==='inspect_media_correction') {
        if(diagnostic && args.input.targetWorkId==='s1') await new Promise(resolve=>setTimeout(resolve,150));
        return {token:'diagnosis-only',title:args.input.targetWorkId==='s1'?'第一季':'第二季',warnings:[],rows:args.input.mediaFileIds.map((id,i)=>diagnostic?{...diagnosticRow(id),reliable:args.input.targetWorkId==='s2'&&id==='f0'}:{id,fileName:'Show S0'+(i===2?2:1)+'E0'+(i+5)+'.mkv',episode:i+5,season:i===2?2:1,parsedSeason:i===2?2:1,parsedEpisode:String(i+5),primaryProvider:'bangumi',officialTitle:'官方分集',oldEpisode:'1',fromTitle:'第一季',episodeType:0,eligible:i!==2,reliable:i!==2&&args.input.season===1,issues:[]})};
      }
      if(cmd==='refresh_work_metadata') throw new Error('HTTP 502 请求失败，已有缓存保留');
      if(cmd==='refresh_episode_artwork') return {anchor:'bangumi:s2',source:null,images:{},cachedImages:{},sourceTitle:null,correspondence:[],warnings:['TMDB HTTP 502，保留旧剧照缓存']};
      if(cmd==='preview_media_correction' && diagnostic) return {token:'preview-token',title:'第二季',warnings:[],rows:args.input.mediaFileIds.map(diagnosticRow)};
      if(cmd==='preview_media_correction') return {token:'preview-token',title:args.input.targetWorkId==='s1'?'第一季':'第二季',warnings:['暂无官方分集，将保留人工集号。'],rows:args.input.mediaFileIds.map((id,i)=>({id,fileName:'Show ['+(i+1)+'].mkv',season:args.input.season,episode:args.input.mode==='parsed'?i+5:i+1,oldEpisode:'13',fromTitle:'第一季',officialTitle:null}))};
      if(cmd==='apply_media_correction') return args.input.targetWorkId;
      throw new Error('Unexpected mock command: '+cmd);
    }};
  });
  for(const [width,height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:4193/__qa_recognition',{waitUntil:'domcontentloaded'});
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
  for(const [width,height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:4193/__qa_recognition?filename',{waitUntil:'domcontentloaded'});
    await page.getByLabel('编号方式').selectOption('parsed');
    await page.getByRole('button',{name:'仅选第 1 季'}).click();
    await page.waitForFunction(()=>document.querySelector('.correction-selection-head')?.textContent.includes('已勾选 2 / 3'));
    assert.match(await page.locator('.correction-selection-head').first().innerText(),/已勾选 2 \/ 3/);
    await page.getByLabel('目标季度（可选）').fill('1');
    await page.getByRole('button',{name:'预览调整'}).click();
    await page.getByLabel('批量纠错预览').waitFor();
    assert.match(await page.locator('.correction-preview').innerText(),/第 1 季 · 第 5 集/);
    assert.match(await page.locator('.correction-preview').innerText(),/第 1 季 · 第 6 集/);
    assert.equal(await page.getByRole('button',{name:'确认保存'}).isEnabled(),false);
    assert.equal(await page.evaluate(()=>window.__qaCalls.some(c=>c.cmd==='apply_media_correction')),false);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('.modal,.modal-body,.media-correction')].some(e=>e.scrollWidth>e.clientWidth+2));
    assert.equal(overflow,false);
    await page.screenshot({path:artifactDir+'/filename-'+width+'x'+height+'.png'});
    await page.getByText('我已核对文件范围、目标作品与逐行集号').click();
    await page.getByRole('button',{name:'确认保存'}).click();
    await page.getByTestId('saved').filter({hasText:'s1'}).waitFor();
    const call=await page.evaluate(()=>window.__qaCalls.find(c=>c.cmd==='apply_media_correction'));
    assert.equal(call.args.input.mode,'parsed');
    assert.equal(call.args.input.season,1);
    assert.deepEqual(call.args.input.mediaFileIds,['f0','f1']);
  }
  for(const [width,height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    for(const theme of ['dark','light']) {
      await page.goto('http://127.0.0.1:4193/__qa_recognition?diagnostic',{waitUntil:'domcontentloaded'});
      await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
      await page.waitForFunction(()=>document.querySelector('.correction-selection-head')?.textContent.includes('已勾选 1 / 6'));
      assert.match(await page.locator('.correction-files').innerText(),/TMDB 第 1 季 · 第 13 集/);
      assert.equal(await page.locator('.correction-files input:disabled').count(),2,'mixed season and ambiguous range blocked');
      await page.getByLabel('分集诊断筛选').selectOption('review');
      assert.equal(await page.locator('.correction-files label').count(),5);
      await page.getByLabel('分集诊断筛选').selectOption('all');
      await page.getByRole('button',{name:'全选 / 清空'}).click();
      assert.match(await page.locator('.correction-selection-head').first().innerText(),/已勾选 4 \/ 6/);
      await page.getByRole('button',{name:'全选 / 清空'}).click();
      assert.match(await page.locator('.correction-selection-head').first().innerText(),/已勾选 0 \/ 6/);
      await page.getByRole('button',{name:'仅勾选可靠正片'}).click();
      await page.getByRole('button',{name:'刷新主源分集'}).click();
      await page.getByRole('alert').filter({hasText:'HTTP 502'}).waitFor();
      assert.match(await page.getByRole('alert').innerText(),/已有缓存、关联和观看进度保留/);
      assert.match(await page.locator('.correction-selection-head').first().innerText(),/已勾选 1 \/ 6/);
      await page.locator('.correction-files label').nth(1).locator('input').check();
      await page.getByRole('button',{name:'重新诊断',exact:true}).first().click();
      await page.waitForFunction(()=>!document.querySelector('[role="status"]'));
      assert.match(await page.locator('.correction-selection-head').first().innerText(),/已勾选 2 \/ 6/,'explicit offline choice survives reinspection');
      await page.getByRole('button',{name:'预览调整'}).click();
      await page.getByLabel('批量纠错预览').waitFor();
      assert.match(await page.locator('.correction-preview').innerText(),/TMDB 第 1 季 · 第 13 集/);
      assert.equal(await page.getByRole('button',{name:'确认保存'}).isEnabled(),false);
      assert.equal(await page.evaluate(()=>window.__qaCalls.some(c=>c.cmd==='apply_media_correction')),false);
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.modal,.modal-body,.media-correction,.correction-files')].some(e=>e.scrollWidth>e.clientWidth+2)),false);
      await page.getByText('我已核对文件范围、目标作品与逐行集号').scrollIntoViewIfNeeded();
      await page.screenshot({path:artifactDir+'/diagnostic-'+theme+'-'+width+'x'+height+'.png'});
      await page.getByText('我已核对文件范围、目标作品与逐行集号').click();
      await page.getByRole('button',{name:'确认保存'}).click();
      await page.getByTestId('saved').filter({hasText:'s2'}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.__qaCalls.find(c=>c.cmd==='apply_media_correction').args.input.mediaFileIds),['f0','f1']);
    }
  }
  // A late diagnosis for another target must not replace the current work's selection.
  await page.goto('http://127.0.0.1:4193/__qa_recognition?diagnostic',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('.correction-selection-head')?.textContent.includes('已勾选 1 / 6'));
  await page.getByLabel('纠错目标作品').selectOption('s1');
  await page.getByLabel('纠错目标作品').selectOption('s2');
  await page.waitForFunction(()=>window.__qaCalls.filter(c=>c.cmd==='inspect_media_correction').length>=3 && !document.querySelector('[role="status"]'));
  await page.waitForTimeout(200);
  assert.match(await page.locator('.correction-selection-head').first().innerText(),/已勾选 1 \/ 6/);
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
  console.log('PASS: three window sizes, unified file/primary/still diagnostics, reliable-only selection, mixed/special/range/manual/offline isolation, HTTP 502 preservation, late-response protection, explicit preview/save, conflicting recommendations/forget, cache fallback, changed-source recovery, failed-image retry without reloading valid images.');
} finally { await browser.close();await server.close(); }
