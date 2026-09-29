import { recentlyAdded } from "../workSelection";
import { usePlaybackProgress } from "../usePlaybackProgress";
import { latestPlayback } from "../playback";
import { useToasts } from "../store";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PlaybackHistory } from "../components/PlaybackHistory";
import "../home-hero-sizing.css";
import { Bookmark, Library, Play, RefreshCw, Settings, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { dataProvider as api } from "../data";
import { ErrorState, IconButton, LoadingState } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { useUi } from "../store";
import type { Dashboard, MediaType, WorkListItem } from "../types";
import { coverUrl, getErrorMessage, mediaLabels, workCategoryLabel, statusLabels } from "../utils";

type ShelfFilter = "all" | MediaType;

const shelfFilterOptions: { key: ShelfFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "video", label: mediaLabels.video },
  { key: "game", label: mediaLabels.game },
];

const demoLandscape = ["/demo/video-1.jpg", "/demo/video-2.jpg", "/demo/video-3.jpg"];
const previewWorks: WorkListItem[] = [
  ["1", "葬送的芙莉莲", "Frieren: Beyond Journey's End", "video", 28, true, "in_progress"],
  ["2", "星海列车", "Starlight Railway", "video", 12, true, "in_progress"],
  ["3", "边境回声", "Echoes of the Frontier", "game", 4, false, "in_progress"],
  ["4", "蓝色时期", "Blue Period", "comic", 12, true, "in_progress"],
  ["5", "海边的卡夫卡", "Kafka on the Shore", "novel", 1, false, "planned"],
  ["6", "雨巷画集", "Rain Alley", "comic", 8, true, "completed"],
  ["7", "夜航手记", "Night Flight Notes", "novel", 3, false, "in_progress"],
].map(([id, title, originalTitle, type, mediaCount, favorite, status]) => ({
  id: String(id),
  title: String(title),
  originalTitle: String(originalTitle),
  type: type as WorkListItem["type"],
  mediaCount: Number(mediaCount),
  favorite: Boolean(favorite),
  status: status as WorkListItem["status"],
  coverPath: null,
  description: "",
  rating: null,
  notes: "",
  tags: [],
  missingCount: 0,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  metadataStatus: "matched",
  metadataYear: 2026,
  lastRecognizedAt: "2026-09-11T00:00:00.000Z",
}));

const previewDashboard: Dashboard = {
  totalWorks: 85,
  videoCount: 46,
  comicCount: 19,
  novelCount: 12,
  gameCount: 8,
  otherCount: 0,
  favoriteCount: 28,
  missingFileCount: 3,
  recentWorks: previewWorks,
  favoriteWorks: previewWorks.filter((work) => work.favorite),
  lastScan: null,
};

function artwork(work: WorkListItem, index: number, previewMode = false) {
  return work.coverPath ?? (previewMode ? demoLandscape[index % demoLandscape.length] : null);
}

/**
 * 首页横幅背景：只使用后端缓存的**横版横幅**（`Work.bannerPath`，迁移 0006 / 契约 009）。
 * 不再回退到竖版封面 —— 2:3 竖图铺进宽横幅会被放大到只剩中间一块，看上去就是
 * 「首页背景里一张大海报」；没有横版横幅时改走无海报的中性页头（`.seanime-banner.no-artwork`）。
 * 主题预览（`?preview=theme`）没有真实数据，保留内置自制占位图。
 */
const homeBackdrops = ["/design/reference-primary.png", "/design/reference-secondary.png"];

function bannerArtwork(work: WorkListItem | undefined): string | null {
  return work ? coverUrl(work.bannerPath ?? null) : null;
}

function workBackdrop(work: WorkListItem | undefined, index: number, previewMode = false): string | null {
  if (!work) return null;
  return bannerArtwork(work) ?? (previewMode ? homeBackdrops[index % homeBackdrops.length] ?? null : null);
}

function ShelfArtwork({ work, index, previewMode }: { work: WorkListItem; index: number; previewMode: boolean }) {
  const source = artwork(work, index, previewMode);
  return <MediaVisual type={work.type} coverPath={source ?? null} thumbnailPath={work.coverThumbnailPath} alt="" />;
}

export function HomePage() {
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "theme";
  const playback = usePlaybackProgress(undefined, !previewMode);
  const [resumeBusy, setResumeBusy] = useState(false);
  const toast = useToasts(state => state.push);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>("all");
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  const openSettings = useUi((state) => state.openSettings);

  /* 顶部工具条由 AppShell 的标题栏承载：这里取到 WindowTitleBar 提供的插槽，
     再用 portal 把工具栏渲染到窗口控制按钮左侧（布局在样式里，元素本身不属于首页内容流）。 */
  useLayoutEffect(() => {
    setToolsHost(document.getElementById("window-titlebar-tools"));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (previewMode) {
        setData(previewDashboard);
        setWorks(previewWorks);
      } else {
        const dashboard = await api.dashboard();
        setData(dashboard);
        try {
          setWorks(await api.listWorks());
        } catch {
          setWorks(dashboard.recentWorks);
        }
      }
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [previewMode]);

  useEffect(() => void load(), [load]);

  const mediaWorks = useMemo(() => works.filter((work) => {
    const category = work.category ?? work.type;
    return category !== "comic" && category !== "novel";
  }), [works]);
  const carouselWorks = useMemo(() => recentlyAdded(mediaWorks).slice(0, 5), [mediaWorks]);
  useEffect(() => {
    setFeaturedIndex((index) => (index < carouselWorks.length ? index : 0));
  }, [carouselWorks.length]);
  const featured = carouselWorks[featuredIndex] ?? carouselWorks[0];
  const featuredPlayback = usePlaybackProgress(featured?.id, !previewMode && Boolean(featured));
  const lastPlayed = featured ? latestPlayback(featuredPlayback.data.items, featured.id) : undefined;
  const resumeActive = featuredPlayback.data.sessions.some(session => session.mediaFileId === lastPlayed?.mediaFileId && ["connecting", "tracking"].includes(session.status));
  const resumeFeatured = async () => {
    if (!lastPlayed) return;
    setResumeBusy(true);
    try { await api.resumePlayback(lastPlayed.mediaFileId, false); }
    catch (err) { toast(getErrorMessage(err), "error"); }
    finally { setResumeBusy(false); }
  };
  const featuredArtwork = workBackdrop(featured, featuredIndex, previewMode);
  /** 背景是否来自真实横版横幅（决定用清晰横幅还是模糊封面铺底）。 */
  const featuredHasBanner = Boolean(bannerArtwork(featured));
  const shelfWorks = useMemo(
    () => recentlyAdded(shelfFilter === "all" ? mediaWorks : mediaWorks.filter((work) => work.type === shelfFilter)),
    [mediaWorks, shelfFilter],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("has-window-backdrop", Boolean(featuredArtwork));
    if (featuredArtwork) document.documentElement.style.setProperty("--genzo-backdrop", `url("${featuredArtwork}")`);
    else document.documentElement.style.removeProperty("--genzo-backdrop");
    return () => {
      document.documentElement.classList.remove("has-window-backdrop");
      document.documentElement.style.removeProperty("--genzo-backdrop");
    };
  }, [featuredArtwork]);

  if (loading) return <div className="seanime-home-state"><LoadingState label="正在读取媒体库" /></div>;
  if (error) return <div className="seanime-home-state"><ErrorState message={error} retry={() => void load()} /></div>;
  if (!data) return null;

  const homeToolbar = (
    <div className="seanime-home-toolbar">
      <span className="seanime-library-count">{mediaWorks.length} 部作品 · 最近同步于今天</span>
      <Link className="icon-button" aria-label="打开媒体库" data-tooltip="打开媒体库" to="/library"><Library size={16} /></Link>
      <IconButton tooltip="刷新概览" onClick={() => void load()}><RefreshCw size={16} /></IconButton>
      <IconButton tooltip="打开设置" onClick={openSettings}><Settings size={16} /></IconButton>
    </div>
  );

  return (
    <div className="seanime-home gnz-home">
      {toolsHost ? createPortal(homeToolbar, toolsHost) : null}
      <div className={`seanime-banner ${featuredArtwork ? "has-artwork" : "no-artwork"}${featuredHasBanner ? " has-banner" : ""}`} style={featuredArtwork ? ({ "--banner-image": `url("${featuredArtwork}")` } as CSSProperties) : undefined}>
        <div className="seanime-banner-image" />
        <div className="seanime-banner-title">
          <span>CONTINUE YOUR JOURNEY</span>
          <h1>{featured?.title ?? "你的本地媒体，都在这里"}</h1>
          <p>{featured?.description || "从作品组识别到本地播放，Genzo 让动画、漫画、小说和游戏保持清晰有序。"}</p>
          <div className="gnz-home-actions">
            {lastPlayed ? <button type="button" className="button primary icon-text" title={lastPlayed.fileName} disabled={resumeBusy || resumeActive || !lastPlayed.toolId} onClick={() => void resumeFeatured()}><Play size={17} fill="currentColor" />{resumeActive ? "播放中" : lastPlayed.completed ? "重新观看" : "继续观看"}</button> : featured ? <Link className="button primary icon-text" to={`/library/${featured.id}`}><Play size={17} fill="currentColor" />查看作品</Link> : <Link className="button primary icon-text" to="/library"><Library size={17}/>打开媒体库</Link>}
            {featured ? <Link className="button secondary" to={`/library/${featured.id}`}>作品详情</Link> : <Link className="button secondary" to="/library?tab=sources">添加媒体源</Link>}
            {featured?.favorite ? <span className="gnz-bookmarked" title="已收藏"><Bookmark size={17} fill="currentColor"/></span> : null}
          </div>
        </div>
        {carouselWorks.length ? <div className="gnz-home-switcher" role="group" aria-label="切换到其他作品">
          <div className="gnz-switcher-items">{carouselWorks.map((work, index) => <button type="button" className={featuredIndex === index ? "active" : ""} aria-pressed={featuredIndex === index} key={work.id} onClick={() => setFeaturedIndex(index)}><span className="gnz-switcher-thumb"><ShelfArtwork work={work} index={index} previewMode={previewMode}/></span><span><strong>{work.title}</strong><small>{workCategoryLabel(work)} · 本地</small></span></button>)}</div>
        </div> : null}
      </div>
      {!previewMode && <PlaybackHistory snapshot={playback} />}
      {mediaWorks.length ? <section className="gnz-home-shelf">
        <div className="section-heading"><div><h2>最近添加</h2><span>{shelfFilter === "all" ? `${mediaWorks.length} 部作品` : `${shelfWorks.length} 部作品`}</span></div><Link to="/library">查看全部</Link></div>
        <div className="gnz-shelf-filters" role="group" aria-label="作品分类筛选">
          {shelfFilterOptions.map((option) => <button key={option.key} type="button" className={shelfFilter === option.key ? "active" : ""} aria-pressed={shelfFilter === option.key} onClick={() => setShelfFilter(option.key)}>{option.label}</button>)}
        </div>
        {shelfWorks.length ? <div className="gnz-shelf-grid">{shelfWorks.slice(0, 6).map((work, index) => <Link className="gnz-shelf-card" to={`/library/${work.id}`} key={work.id}>
          <div className="gnz-shelf-poster"><ShelfArtwork work={work} index={index} previewMode={previewMode}/><span className="gnz-shelf-type">{workCategoryLabel(work)}</span>{work.favorite ? <span className="gnz-shelf-fav" aria-hidden="true"><Star size={15} fill="currentColor"/></span> : null}</div>
          <strong>{work.title}</strong>
          <small>{work.mediaCount} 个文件 · {statusLabels[work.status]}</small>
        </Link>)}</div> : <p className="gnz-shelf-empty">该分类下还没有作品。</p>}
      </section> : null}
    </div>
  );
}
