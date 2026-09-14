import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Heart, Library, Play, RefreshCw, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { dataProvider as api } from "../data";
import { EmptyState, ErrorState, IconButton, LoadingState } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import type { Dashboard, WorkListItem } from "../types";
import { coverUrl, getErrorMessage, mediaLabels } from "../utils";

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
  return coverUrl(work.coverPath) ?? (previewMode ? demoLandscape[index % demoLandscape.length] : null);
}

function ShelfArtwork({ work, index, previewMode }: { work: WorkListItem; index: number; previewMode: boolean }) {
  const source = artwork(work, index, previewMode);
  return source ? <img src={source} alt="" /> : <MediaVisual type={work.type} coverPath={null} alt="" />;
}

export function HomePage() {
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "theme";
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [featuredIndex, setFeaturedIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(previewMode ? previewDashboard : await api.dashboard());
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [previewMode]);

  useEffect(() => void load(), [load]);

  const carouselWorks = useMemo(() => data?.recentWorks.slice(0, 5) ?? [], [data]);
  const featured = carouselWorks[featuredIndex] ?? carouselWorks[0];
  const featuredArtwork = "/design/reference-primary.png";

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

  return (
    <div className="seanime-home gnz-home">
      <div className="seanime-banner has-artwork" style={{ "--banner-image": `url("${featuredArtwork}")` } as CSSProperties}>
        <div className="seanime-banner-image" />
        <div className="seanime-home-toolbar">
          <span className="seanime-library-count">{data.totalWorks} 部作品 · 最近同步于今天</span>
          <Link className="icon-button" aria-label="打开媒体库" data-tooltip="打开媒体库" to="/library"><Library size={19} /></Link>
          <IconButton tooltip="刷新概览" onClick={() => void load()}><RefreshCw size={19} /></IconButton>
          <Link className="icon-button" aria-label="打开设置" data-tooltip="打开设置" to="/settings"><Settings size={19} /></Link>
        </div>
        <div className="gnz-home-copy-mask" />
        <div className="seanime-banner-title">
          <span>CONTINUE YOUR JOURNEY</span>
          <h1>{featured?.title ?? "你的本地媒体，都在这里"}</h1>
          <p>{featured?.description || "从作品组识别到本地播放，Genzo 让动画、漫画、小说和游戏保持清晰有序。"}</p>
          <div className="gnz-home-facts"><span>{featured ? mediaLabels[featured.type] : "本地媒体库"}</span><span>{featured ? `${featured.mediaCount} 个文件` : `${data.totalWorks} 部作品`}</span>{featured?.favorite ? <span>已收藏</span> : null}<span>本地高清</span></div>
          <div className="gnz-home-actions">
            {featured ? <Link className="button primary icon-text" to={`/library/${featured.id}`}><Play size={17} fill="currentColor" />继续查看</Link> : <Link className="button primary icon-text" to="/library"><Library size={17}/>打开媒体库</Link>}
            {featured ? <Link className="button secondary" to={`/library/${featured.id}`}>作品详情</Link> : <Link className="button secondary" to="/scan">添加媒体源</Link>}
            {featured?.favorite ? <span className="gnz-bookmarked" title="已收藏"><Bookmark size={17} fill="currentColor"/></span> : null}
          </div>
        </div>
      </div>

      <div className="gnz-home-switcher">
        <div className="gnz-switcher-head"><div><strong>切换到其他作品</strong><span>精选 · {carouselWorks.length} 部</span></div><div><IconButton tooltip="上一个作品" disabled={!carouselWorks.length} onClick={() => setFeaturedIndex((index) => (index - 1 + carouselWorks.length) % carouselWorks.length)}><ChevronLeft size={16}/></IconButton><IconButton tooltip="下一个作品" disabled={!carouselWorks.length} onClick={() => setFeaturedIndex((index) => (index + 1) % carouselWorks.length)}><ChevronRight size={16}/></IconButton></div></div>
        {carouselWorks.length ? <div className="gnz-switcher-items">{carouselWorks.map((work, index) => <button type="button" className={featuredIndex === index ? "active" : ""} key={work.id} onClick={() => setFeaturedIndex(index)}><span className="gnz-switcher-thumb"><ShelfArtwork work={work} index={index} previewMode={previewMode}/></span><span><strong>{work.title}</strong><small>{mediaLabels[work.type]} · 本地</small></span></button>)}</div> : <EmptyState title="媒体库还是空的" description="添加扫描目录，或手动创建第一条作品记录。" action={<Link className="button primary" to="/scan">添加扫描目录</Link>} />}
      </div>
      {data.recentWorks.length ? <section className="gnz-home-shelf">
        <div className="section-heading"><div><h2>我的书架</h2><span>{data.totalWorks} 部作品</span></div><Link to="/library">查看全部</Link></div>
        <div className="gnz-shelf-filters"><span className="active">全部</span><span>动漫</span><span>漫画</span><span>小说</span><span>游戏</span></div>
        <div className="gnz-shelf-grid">{data.recentWorks.slice(0, 6).map((work, index) => {
          const shelfArtwork = artwork(work, index, previewMode) ?? (index % 2 ? "/design/reference-secondary.png" : "/design/reference-primary.png");
          return <Link className="gnz-shelf-card" to={`/library/${work.id}`} key={work.id} style={{ "--shelf-image": `url("${shelfArtwork}")` } as CSSProperties}><span>{mediaLabels[work.type]}</span>{work.favorite ? <Heart size={15} fill="currentColor"/> : null}<strong>{work.title}</strong><small>{work.mediaCount} 个文件 · 本地</small></Link>;
        })}</div>
      </section> : null}
    </div>
  );
}
