import { useEffect, useRef, useState, type ReactNode } from "react";
import { dataProvider } from "../data";
import type { EpisodeArtwork } from "../episodeArtwork";
import { getErrorMessage } from "../utils";
import { Modal, SafeImage } from "./common";
import { ResilientImage } from "./ResilientImage";
import "./EpisodeArtwork.css";

/** Read cache first; network supplementation never blocks work/files/episode loading. */
export function useEpisodeArtwork(workId: string, episodeSignature: string) {
  const revision = useRef(0);
  const [state, setState] = useState<{ key: string; value: EpisodeArtwork | null; warning: string; pending: boolean }>({ key: "", value: null, warning: "", pending: false });
  const key = `${workId}:${episodeSignature}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    let disposed = false;
    const started = revision.current;
    const provider = dataProvider.episodeArtwork;
    if (!provider || !episodeSignature) return;
    const load = async () => {
      try {
        const cached = await provider.get(workId);
        if (!disposed && started === revision.current) setState({ key, value: cached, warning: "", pending: true });
        const value = await provider.refresh(workId);
        if (!disposed && started === revision.current) setState({ key, value, warning: "", pending: false });
      } catch (error) {
        if (!disposed && started === revision.current) setState(previous => ({ key, value: previous.key === key ? previous.value : null, warning: getErrorMessage(error), pending: false }));
      }
    };
    void load();
    return () => { disposed = true; };
  }, [key, workId, episodeSignature]);
  return {
    artwork: state.key === key ? state.value : null,
    warning: state.key === key ? state.warning : "",
    pending: Boolean(dataProvider.episodeArtwork && episodeSignature && (state.key !== key || state.pending)),
    update: (value: EpisodeArtwork) => { if (currentKey.current !== key) return; revision.current += 1; setState({ key, value, warning: "", pending: false }); },
  };
}

export function EpisodeStill({ workId, episodeKey, url, cachedUrl, fallback }: { workId: string; episodeKey: string; url?: string | null; cachedUrl?: string | null; fallback: ReactNode }) {
  const holder = useRef<HTMLSpanElement>(null);
  const identity = `${workId}:${episodeKey}:${url ?? ""}`;
  const [cache, setCache] = useState<{ identity: string; path: string | null }>({ identity: "", path: null });
  const local = cachedUrl ?? (cache.identity === identity ? cache.path : null);
  useEffect(() => {
    const provider = dataProvider.episodeArtwork;
    if (!provider || !url || cachedUrl || !holder.current) return;
    let disposed = false;
    let requested = false;
    const request = () => {
      if (requested) return;
      requested = true;
      void provider.cache(workId, episodeKey).then(path => { if (!disposed) setCache({ identity, path }); }).catch(() => {});
    };
    if (typeof IntersectionObserver === "undefined") { request(); return () => { disposed = true; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { observer.disconnect(); request(); }
    }, { rootMargin: "160px" });
    observer.observe(holder.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [identity, workId, episodeKey, url, cachedUrl]);
  return <span ref={holder} className="episode-snapshot-visual" title={url || local ? "优先显示 TMDB 分集剧照；不可用时回退文件缩略图" : "文件缩略图"}>
    <ResilientImage sources={[local, url]} alt="分集剧照" fallback={fallback} />
  </span>;
}

export function EpisodeArtworkControl({ workId, artwork, warning, onChange }: { workId: string; artwork: EpisodeArtwork | null; warning: string; onChange: (value: EpisodeArtwork) => void }) {
  const [open, setOpen] = useState(false);
  const [series, setSeries] = useState("");
  const [season, setSeason] = useState("1");
  const [preview, setPreview] = useState<EpisodeArtwork | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const provider = dataProvider.episodeArtwork;
  if (!provider) return null;
  const run = async (save: boolean) => {
    setBusy(true); setError("");
    try {
      const result = save && preview ? await provider.set(workId, Number(series), Number(season), preview.anchor) : await provider.preview(workId, Number(series), Number(season));
      if (save) { onChange(result); setOpen(false); } else setPreview(result);
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return <div className="episode-artwork-control">
    <span>{artwork?.source ? `分集剧照：TMDB · 第 ${artwork.source.seasonNumber} 季${artwork.source.method === "manual" ? "（手动）" : ""}` : "分集封面：文件缩略图"}</span>
    <button type="button" className="button secondary compact" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { onChange(await provider.refresh(workId, true)); } catch (e) { setError(getErrorMessage(e)); } finally { setBusy(false); } }}>更新剧照</button>
    {artwork?.anchor.startsWith("bangumi:") ? <button type="button" className="button secondary compact" disabled={busy} onClick={() => { setSeries(artwork.source?.seriesId.toString() ?? ""); setSeason(artwork.source?.seasonNumber.toString() ?? "1"); setPreview(null); setError(""); setOpen(true); }}>选择剧照来源</button> : null}
    {(warning || artwork?.warnings.length || (!open && error)) ? <p role="status">{warning || artwork?.warnings.join("；") || error}</p> : null}
    {open ? <Modal title="选择分集剧照来源" onClose={() => { if (!busy) setOpen(false); }} footer={<div className="form-actions episode-artwork-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className="button secondary" disabled={busy} onClick={() => void run(false)}>预览剧照</button><button className="button primary" type="button" disabled={busy || !preview} onClick={() => void run(true)}>使用此来源</button></div>}>
      <p>只补充正片分集图片。请核对作品与季度；作品资料、分集名称、文件关联和观看进度保持原样。</p>
      <div className="episode-artwork-inputs"><label className="field">TMDB 电视剧 ID<input aria-label="TMDB 电视剧 ID" type="number" min="1" value={series} disabled={busy} onChange={e => { setSeries(e.target.value); setPreview(null); }} /></label><label className="field">TMDB 季数<input aria-label="TMDB 季数" type="number" min="1" max="999" value={season} disabled={busy} onChange={e => { setSeason(e.target.value); setPreview(null); }} /></label></div>
      <p className="quiet-inline">ID 位于 TMDB 电视剧页面地址中的 /tv/ 后面。仅按同号的唯一正片分集补图，特别篇与不一致的集号使用文件缩略图。</p>
      {error ? <p className="gnz-inline-error" role="alert">{error}</p> : null}
      {preview ? <><strong>{preview.sourceTitle} · {Object.keys(preview.images).length} 集有剧照</strong><div className="episode-artwork-preview">{Object.entries(preview.images).slice(0, 4).map(([key, url]) => <SafeImage key={key} src={url} alt="TMDB 剧照预览" fallback={<span>剧照不可用</span>} />)}</div>{preview.warnings.map(w => <p key={w}>{w}</p>)}</> : null}
    </Modal> : null}
  </div>;
}
