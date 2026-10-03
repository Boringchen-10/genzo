import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import type { ComicItem } from "../comicExplore";
import { comicCoverCache, type CachedComicCover } from "../comicCoverCache";
import { IMAGE_RETRY_EVENT, posterSources } from "../imageRecovery";
import { coverUrl } from "../utils";
import { ResilientImage } from "./ResilientImage";

export function ComicCover({ item, detail = false }: { item: ComicItem; detail?: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const failed = useRef(false);
  const key = JSON.stringify([item.pathWord, item.coverUrl]);
  const initial = (): CachedComicCover | undefined => item.coverUrl
    ? comicCoverCache.peek(item.pathWord, item.coverUrl) ?? (item.cachedCoverPath ? { coverPath: item.cachedCoverPath, thumbnailPath: item.cachedCoverThumbnailPath ?? null } : undefined) : undefined;
  const [state, setState] = useState(() => ({ key, cached: initial(), ready: !item.coverUrl, version: 0 }));
  const current = state.key === key ? state : { key, cached: initial(), ready: !item.coverUrl, version: 0 };
  const [pixels, setPixels] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      setPixels({ width: box.width * (window.devicePixelRatio || 1), height: box.height * (window.devicePixelRatio || 1) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let visible = detail;
    let started = false;
    failed.current = false;
    setState({ key, cached: initial(), ready: !item.coverUrl, version: 0 });
    const load = (refresh = false) => {
      if (!item.coverUrl || (!refresh && started)) return;
      started = true;
      if (!navigator.onLine) {
        failed.current = true;
        setState(previous => ({ ...previous, ready: true }));
        return;
      }
      void comicCoverCache.load(item.pathWord, item.coverUrl, refresh).then(cached => {
        if (!cancelled) {
          failed.current = false;
          setState(previous => ({ key, cached, ready: true, version: previous.version + (refresh ? 1 : 0) }));
        }
      }).catch(() => {
        if (!cancelled) { failed.current = true; setState(previous => ({ ...previous, ready: true })); }
      });
    };
    const retry = () => { if (visible && failed.current) load(true); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) load();
    }, { rootMargin: "120px" });
    if (detail || !observer) { visible = true; load(); }
    else if (holder.current) observer.observe(holder.current);
    window.addEventListener(IMAGE_RETRY_EVENT, retry);
    window.addEventListener("online", retry);
    return () => { cancelled = true; observer?.disconnect(); window.removeEventListener(IMAGE_RETRY_EVENT, retry); window.removeEventListener("online", retry); };
    // Cache lookup follows the source identity, not changes to unrelated work metadata.
  }, [key, detail]);

  const local = current.cached ? posterSources(current.cached.coverPath, current.cached.thumbnailPath, pixels.width, pixels.height).map(path => coverUrl(path)) : [];
  const sources = [...local, ...((current.cached || current.ready) && item.coverUrl ? [item.coverUrl] : [])];
  return <div ref={holder} className={`comic-explore-cover${detail ? " is-detail" : ""}`}>
    <ResilientImage key={`${key}:${current.version}`} sources={sources} alt={`${item.title} 封面`} onSourceError={() => {
      failed.current = true;
      if (item.coverUrl) comicCoverCache.invalidate(item.pathWord, item.coverUrl);
    }} fallback={<span className="comic-cover-placeholder"><BookOpen size={32} />{current.ready ? "暂无封面" : "正在加载封面"}</span>} />
  </div>;
}
