import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Library, Play, RefreshCw, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, IconButton, LoadingState } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import type { Dashboard, WorkListItem } from "../types";
import { coverUrl, getErrorMessage, mediaLabels } from "../utils";

const demoLandscape = ["/demo/video-1.jpg", "/demo/video-2.jpg", "/demo/video-3.jpg"];
const demoPortrait = ["/demo/book-1.jpg", "/demo/book-2.jpg", "/demo/book-3.jpg"];
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

function artwork(work: WorkListItem, index: number, portrait = false, previewMode = false) {
  return coverUrl(work.coverPath) ?? (previewMode ? (portrait ? demoPortrait[index % demoPortrait.length] : demoLandscape[index % demoLandscape.length]) : null);
}

function ShelfArtwork({ work, index, portrait, previewMode }: { work: WorkListItem; index: number; portrait?: boolean; previewMode: boolean }) {
  const source = artwork(work, index, portrait, previewMode);
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

  const watching = useMemo(
    () => data?.recentWorks.filter((work) => work.type === "video" || work.status === "in_progress").slice(0, 3) ?? [],
    [data],
  );
  const reading = useMemo(
    () => data?.recentWorks.filter((work) => work.type === "comic" || work.type === "novel").slice(0, 7) ?? [],
    [data],
  );
  const featured = watching[featuredIndex] ?? watching[0] ?? data?.recentWorks[0];
  const featuredArtwork = featured ? artwork(featured, featuredIndex, false, previewMode) : (previewMode ? "/demo/backdrop.jpg" : null);

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
    <div className="seanime-home">
      <div className={`seanime-banner ${featuredArtwork ? "has-artwork" : "no-artwork"}`} style={featuredArtwork ? { "--banner-image": `url("${featuredArtwork}")` } as CSSProperties : undefined}>
        <div className="seanime-banner-image" />
        <div className="seanime-home-toolbar">
          <span className="seanime-library-count">{data.totalWorks} 部作品</span>
          <Link className="icon-button" aria-label="打开媒体库" data-tooltip="打开媒体库" to="/library"><Library size={19} /></Link>
          <IconButton tooltip="刷新概览" onClick={() => void load()}><RefreshCw size={19} /></IconButton>
          <Link className="icon-button" aria-label="打开设置" data-tooltip="打开设置" to="/settings"><Settings size={19} /></Link>
        </div>
        {featured ? (
          <div className="seanime-banner-title">
            <span>最近收录</span>
            <h1>{featured.title}</h1>
          </div>
        ) : (
          <div className="seanime-banner-title"><span>GENZO LIBRARY</span><h1>你的本地媒体，都在这里。</h1></div>
        )}
      </div>

      <div className="seanime-home-content">
        {watching.length ? (
          <section className="seanime-section seanime-watch-section">
            <div className="seanime-watch-grid">
              {watching.map((work, index) => (
                <Link className="seanime-episode-card" to={`/library/${work.id}`} key={work.id} onMouseEnter={() => setFeaturedIndex(index)}>
                  <div className="seanime-episode-image">
                    <ShelfArtwork work={work} index={index} previewMode={previewMode} />
                    <span className="seanime-play"><Play size={22} fill="currentColor" /></span>
                  </div>
                  <strong>{work.originalTitle || work.title}</strong>
                  <p><b>{work.mediaCount} 个文件</b><span> · {work.title}</span></p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {reading.length ? (
          <section className="seanime-section">
            <div className="seanime-section-heading"><h2>漫画与小说</h2><Link to="/library">查看全部</Link></div>
            <div className="seanime-book-row">
              {reading.map((work, index) => (
                <Link className="seanime-book-card" to={`/library/${work.id}`} key={work.id}>
                  <div className="seanime-book-cover"><ShelfArtwork work={work} index={index} portrait previewMode={previewMode} /><span>{mediaLabels[work.type]}</span></div>
                  <strong>{work.title}</strong>
                  <p>{work.mediaCount} 个文件</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {data.recentWorks.length ? (
          <section className="seanime-section">
            <div className="seanime-section-heading"><h2>最近添加</h2><Link to="/library?scope=recent">查看全部</Link></div>
            <div className="seanime-book-row">
              {data.recentWorks.slice(0, 7).map((work, index) => (
                <Link className="seanime-book-card" to={`/library/${work.id}`} key={work.id}>
                  <div className="seanime-book-cover"><ShelfArtwork work={work} index={index} portrait previewMode={previewMode} /><span>{mediaLabels[work.type]}</span></div>
                  <strong>{work.title}</strong>
                  <p>{work.favorite ? "已收藏" : `${work.mediaCount} 个文件`}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <EmptyState title="媒体库还是空的" description="添加扫描目录，或手动创建第一条作品记录。" action={<Link className="button primary" to="/scan">添加扫描目录</Link>} />
        )}
      </div>
    </div>
  );
}
