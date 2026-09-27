// Simulated IPC and images only: never opens a real library, account or video.
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const output = "artifacts/episode-artwork";
await mkdir(output, { recursive: true });
const imageMiddleware = (req, res, next) => {
  if (req.url === "/qa-broken") { res.statusCode = 404; return res.end(); }
  if (req.url?.startsWith("/qa-green") || req.url?.startsWith("/qa-blue")) {
    res.setHeader("Content-Type", "image/svg+xml");
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="780" height="439"><rect width="780" height="439" fill="${req.url.startsWith('/qa-green') ? '#3f8069' : '#4b638b'}"/><text x="40" y="230" font-size="36" fill="white">${req.url.startsWith('/qa-green') ? 'TMDB fixture' : 'File thumbnail fixture'}</text></svg>`);
  }
  next();
};
const server = await createServer({ server: { host: "127.0.0.1", port: 4194, strictPort: true }, plugins: [{ name: 'episode-fixture-images', configureServer(vite) { vite.middlewares.use(imageMiddleware); } }] });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
let failurePage;
try {
  const page = await browser.newPage(); const errors = [];
  failurePage = page;
  page.setDefaultTimeout(10000);
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__artCalls = []; window.__savedSource = null;
    const now = new Date().toISOString();
    const files = [1,2,3,4].map(n => ({ id:'f'+n, workId:'w', libraryRootId:'r', path:'\\\\?\\UNC\\server\\Show\\0'+n+'.mkv', fileName:'Show S02E0'+n+'.mkv', extension:'mkv', mediaType:'video', size:1000000, missing:false, createdAt:now, updatedAt:now, parsedEpisode:String(n), thumbnailPath:n===4?'/qa-blue':null, recognitionStatus:'matched' }));
    const work = { id:'w', title:'多源分集剧照回退测试', type:'video', category:'anime', status:'planned', favorite:false, rating:null, description:'', notes:'', tags:[], coverPath:null, mediaFiles:files, subtitleLinks:[], fieldLocks:[], candidates:[], metadataStatus:'matched', metadata:{provider:'bangumi',externalId:'subject',title:'主源作品'} };
    const structure = {workId:'w', bangumiId:'subject', seasons:[], staff:[], characters:[], warnings:[], unmatchedFiles:[], episodes:files.map((f,i)=>({provider:'bangumi',externalId:'ep'+(i+1),episodeNumber:i+1,sortNumber:i+1,episodeType:0,title:'官方分集 '+(i+1),description:'',airDate:'2024-01-01',fetchedAt:now,imageUrl:null,localFiles:[f]}))};
    const result = () => ({anchor:'bangumi:subject', source:window.__savedSource ?? {anchor:'bangumi:subject',seriesId:42,seasonNumber:2,method:'verified'}, images:window.__savedSource ? {'bangumi:ep1':'/qa-green','bangumi:ep2':'/qa-green'} : {'bangumi:ep1':'/qa-broken','bangumi:ep2':'/qa-broken'}, cachedImages:{'bangumi:ep1':'/qa-green'},warnings:[],sourceTitle:'测试来源'});
    window.__TAURI_INTERNALS__ = {convertFileSrc:p=>p, transformCallback:()=>1, unregisterCallback:()=>{}, invoke:async (cmd,args) => {
      window.__artCalls.push({cmd,args});
      if(cmd==='get_work') return args.id==='b'?{...work,id:'b',title:'另一作品',mediaFiles:[{...files[0],id:'bf',workId:'b',thumbnailPath:'/qa-blue'}]}:work;
      if(cmd==='get_anime_work_structure') return args.workId==='b'?{...structure,workId:'b',bangumiId:'other',episodes:[{...structure.episodes[0],externalId:'bep',localFiles:[{...files[0],id:'bf',workId:'b',thumbnailPath:'/qa-blue'}]}]}:structure;
      if(cmd==='get_episode_artwork'||cmd==='refresh_episode_artwork') {
        if(args.workId==='b') return {anchor:'bangumi:other',source:null,images:{},cachedImages:{},warnings:[],sourceTitle:null};
        if(cmd==='refresh_episode_artwork' && location.search.includes('delay')) await new Promise(r=>setTimeout(r,650));
        return result();
      }
      if(cmd==='get_media_thumbnail') return args.mediaFileId==='f2'?'/qa-blue':null;
      if(cmd==='cache_episode_artwork') return null;
      if(cmd==='preview_episode_artwork_source') return {...result(),source:{anchor:'bangumi:subject',seriesId:args.seriesId,seasonNumber:args.seasonNumber,method:'manual'},images:{'bangumi:ep1':'/qa-green','bangumi:ep2':'/qa-green'},sourceTitle:'已核对的测试作品 · 第 '+args.seasonNumber+' 季'};
      if(cmd==='set_episode_artwork_source') { if(location.search.includes('manual-delay')) await new Promise(r=>setTimeout(r,650)); window.__savedSource={anchor:args.expectedAnchor,seriesId:args.seriesId,seasonNumber:args.seasonNumber,method:'manual'}; return result(); }
      if(cmd==='get_playback_progress') return {items:[],sessions:[]};
      if(cmd==='get_setting') return 'dark';
      if(cmd.startsWith('list_')) return [];
      return null;
    }};
  });
  for (const [width,height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:4194/?size='+width+'#/library/w',{waitUntil:'domcontentloaded'});
    const cards=page.locator('.official-episode'); await cards.first().waitFor();
    if(width===1366) await page.evaluate(()=>document.documentElement.classList.add('dark'));
    await cards.first().scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelector('.official-episode img')?.getAttribute('src')==='/qa-green');
    assert.equal(await cards.nth(0).locator('img').first().getAttribute('src'),'/qa-green');
    await cards.nth(1).scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelectorAll('.official-episode')[1]?.querySelector('img')?.getAttribute('src')==='/qa-blue');
    await cards.nth(2).scrollIntoViewIfNeeded();
    await cards.nth(2).getByRole('button',{name:/重试 .* 的缩略图/}).waitFor();
    assert.equal(await cards.nth(2).locator('img').count(),0);
    assert.equal(await cards.nth(3).locator('img').evaluate(el=>el.getBoundingClientRect().width > el.closest('.episode-snapshot').getBoundingClientRect().width * .95),true,'file fallback must fill the episode frame');
    const calls=await page.evaluate(()=>window.__artCalls);
    assert.equal(calls.some(c=>c.cmd==='get_media_thumbnail'&&c.args.mediaFileId==='f1'),false,'TMDB cache prevents mount reads');
    assert.equal(calls.some(c=>c.cmd==='get_media_thumbnail'&&c.args.mediaFileId==='f4'),false,'existing thumbnail needs no extraction');
    await page.getByRole('button',{name:'选择剧照来源',exact:true}).click();
    await page.getByLabel('TMDB 电视剧 ID').fill('43');
    await page.getByLabel('TMDB 季数').fill('3');
    assert.equal(await page.getByRole('button',{name:'使用此来源'}).isEnabled(),false);
    await page.getByRole('button',{name:'预览剧照'}).click();
    await page.getByText('已核对的测试作品 · 第 3 季 · 2 集有剧照').waitFor();
    assert.equal(await page.evaluate(()=>window.__artCalls.some(c=>c.cmd==='set_episode_artwork_source')),false);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.modal,.modal-body')].some(e=>e.scrollWidth>e.clientWidth+2)),false);
    await page.screenshot({path:output+'/'+width+'x'+height+'.png'});
    await page.getByRole('button',{name:'使用此来源'}).click();
    await page.getByText('分集剧照：TMDB · 第 3 季（手动）',{exact:true}).waitFor();
    await page.screenshot({path:output+'/cards-'+width+'.png'});
    assert.equal(await page.evaluate(()=>window.__artCalls.filter(c=>c.cmd==='set_episode_artwork_source').at(-1).args.expectedAnchor),'bangumi:subject');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    console.log(width+'x'+height+': cache, thumbnail, placeholder and explicit source selection passed');
  }
  await page.goto('http://127.0.0.1:4194/?delay#/library/w',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__artCalls.some(c=>c.cmd==='refresh_episode_artwork'));
  await page.evaluate(()=>{location.hash='/library/b';});
  await page.getByText('另一作品',{exact:true}).first().waitFor();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.official-episode img').first().getAttribute('src'),'/qa-blue');
  assert.equal(await page.getByText('分集封面：文件缩略图',{exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  console.log('late work-A supplementation cannot replace work-B images');
  await page.goto('http://127.0.0.1:4194/?manual-delay#/library/w',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'选择剧照来源',exact:true}).click();
  await page.getByLabel('TMDB 电视剧 ID').fill('43');
  await page.getByRole('button',{name:'预览剧照'}).click();
  await page.getByRole('button',{name:'使用此来源'}).click();
  await page.evaluate(()=>{location.hash='/library/b';});
  await page.getByText('另一作品',{exact:true}).first().waitFor();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.official-episode img').first().getAttribute('src'),'/qa-blue');
  assert.equal(await page.getByText('分集封面：文件缩略图',{exact:true}).count(),1);
  console.log('late manual confirmation cannot overwrite work-B artwork');
} catch (error) {
  if (failurePage) { console.error(await failurePage.evaluate(()=>({calls:window.__artCalls,images:[...document.querySelectorAll('.official-episode img')].map(e=>e.getAttribute('src')),body:document.body.innerText.slice(-4000)}))); await failurePage.screenshot({path:output+'/failure.png'}); }
  throw error;
} finally { await browser.close(); await server.close(); }
