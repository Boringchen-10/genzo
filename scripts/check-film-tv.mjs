// Isolated UI regression: mock Tauri only; never opens the user's database/media.
// Run pnpm run dev --host 127.0.0.1 --port 4175 first.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const now = "2026-09-24T00:00:00Z";
const root = String.raw`\\?\UNC\RaiDrive-Administrator\share\Breaking Bad`;
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#294b50"/><text x="200" y="190" fill="white" font-size="32">Episode still</text></svg>')}`;
const files = [["one","Breaking.Bad.S01E01.1080p.mkv",1], ["two","Breaking.Bad.S02E01.1080p.mkv",2], ["three","Breaking.Bad.S02E02.1080p.mkv",2]].map(([id,fileName,season]) => ({
  id, fileName, path:`${root}\\${fileName}`, libraryRootId:"r", workId:"tv", extension:"mkv", mediaType:"video", size:12345678, missing:false,
  createdAt:now, updatedAt:now, recognitionStatus:"matched", parsedTitle:"Breaking Bad", parsedSeason:season, parsedEpisode:"1", parsedEpisodeStart:1,
  parsedEpisodeEnd:null, parsedSpecialType:null, parsedMediaInfo:"[]", thumbnailPath:null,
}));
const base = { originalTitle:"Breaking Bad", type:"video", description:"隔离测试作品资料。", coverPath:null, bannerPath:null, status:"planned", favorite:false,
  rating:null, notes:"原作品笔记", tags:[], createdAt:now, updatedAt:now, metadataStatus:"matched", metadataYear:2008, fieldLocks:[], candidates:[], subtitleLinks:[],
  networkScore:9.2, networkScoreProvider:"tmdb", networkRatingCount:100,
};
const movieFile = {...files[0],id:"movie-file",workId:"movie",fileName:"Example.2020.2160p.mkv",parsedEpisode:"2020"};
const movie = {...base,id:"movie",title:"示例电影",mediaFiles:[movieFile],metadata:{provider:"tmdb",externalId:"movie/42",fetchedAt:now}};
const tv = {...base,id:"tv",title:"示例剧集 · 第 1 季",mediaFiles:files,metadata:{provider:"tmdb",externalId:"tv/42/season/1",fetchedAt:now}};
const candidate = {id:"c",mediaFileId:"two",provider:"tmdb",externalId:"tv/42/season/2",title:"示例剧集 · 第 2 季",originalTitle:"Breaking Bad",aliases:[],subjectType:"tv",year:2008,season:2,coverUrl:null,confidence:0.93,matchReasons:["TMDB 电视剧候选"],createdAt:now};
const episode = {provider:"tmdb",externalId:"tv/42/season/1/episode/1",episodeNumber:1,sortNumber:1,episodeType:0,title:"第一集",airDate:null,duration:"45 分钟",imageUrl:image,localFiles:[files[0]]};
const browser = await chromium.launch({executablePath:process.env.GENZO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",headless:true});
try {
  const page = await browser.newPage();
  const errors=[];
  page.on("pageerror", error=>errors.push(error.message));
  await page.addInitScript(({movie,tv,files,candidate,episode})=>{
    window.__filmCalls=[];
    Object.defineProperty(window,"__TAURI_INTERNALS__",{value:{
      convertFileSrc:value=>value, transformCallback:()=>1, unregisterCallback:()=>{},
      invoke:async(command,args)=>{
        if (command === "get_playback_progress") return { items: [], sessions: [] };
        if (command==="get_work") return args.id==="movie" ? movie : tv;
        if (command==="get_anime_work_structure" || command==="refresh_work_metadata") return {workId:args.workId,bangumiId:"",seasons:[],staff:[],characters:[],warnings:[],episodes:args.workId==="movie"?[]:[episode],unmatchedFiles:args.workId==="movie"?movie.mediaFiles:files.slice(1)};
        if (command==="list_recognition_group_members") return {scope:"season",title:"Show",members:files,linkedWorkId:null,linkedWorkTitle:null};
        if (command==="list_match_candidates") return [candidate];
        if (command==="list_recognition_preferences") return [];
        if (command==="recognize_media_file") {window.__filmCalls.push(args);return {mediaFileId:args.mediaFileId,status:"candidate_pending",candidates:[candidate],error:null};}
        if (command==="confirm_match_candidate") {window.__filmCalls.push(args);return "tv";}
        if (command==="list_external_tools" || command==="list_remote_sources" || command==="list_library_roots") return [];
        return null;
      },
    }});
  },{movie,tv,files,candidate,episode});
  await mkdir("artifacts/screenshots",{recursive:true});
  for (const [width,height] of [[1024,640],[1366,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.goto("http://127.0.0.1:4175/#/library/movie");
    await page.getByText("Example.2020.2160p.mkv",{exact:true}).first().waitFor();
    assert.equal(await page.getByText("第 2020 集",{exact:true}).count(),0);
    assert.equal(await page.locator(".official-episode").count(),0);
    await page.screenshot({path:path.resolve(`artifacts/screenshots/movie-${width}x${height}.png`)});
    await page.goto("http://127.0.0.1:4175/#/library/tv");
    await page.locator(".episode-snapshot img").waitFor();
    await page.getByRole("button",{name:"识别到其他作品",exact:true}).first().click();
    const dialog=page.getByRole("dialog");
    await dialog.getByRole("combobox",{name:"识别类型",exact:true}).waitFor();
    assert.equal(await dialog.getByRole("combobox",{name:"识别类型",exact:true}).inputValue(),"tv");
    assert.equal(await dialog.getByRole("spinbutton",{name:"电视剧季度"}).inputValue(),"2");
    assert.equal(await dialog.locator(".recognition-member input:checked").count(),2);
    await dialog.getByRole("button",{name:"预览关联",exact:true}).click();
    await dialog.getByRole("region",{name:"关联预览"}).waitFor();
    const overflow=await dialog.evaluate(node=>node.scrollWidth>node.clientWidth+1 || [...node.querySelectorAll(".recognition-search,.candidate-row,.recognition-preview")].some(row=>row.scrollWidth>row.clientWidth+1));
    assert.equal(overflow,false,`${width}x${height}: recognition overflow`);
    await page.screenshot({path:path.resolve(`artifacts/screenshots/film-tv-${width}x${height}.png`)});
    await dialog.getByRole("button",{name:"确认关联",exact:true}).click();
    await page.waitForFunction(()=>window.__filmCalls.some(call=>call.candidateId));
    const submission=await page.evaluate(()=>window.__filmCalls.filter(call=>call.candidateId).at(-1));
    assert.deepEqual(submission.selectedMediaIds,["two","three"]);
    console.log(`${width}x${height}: movie files, official stills, season selection and confirmation passed`);
    await page.reload();
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
