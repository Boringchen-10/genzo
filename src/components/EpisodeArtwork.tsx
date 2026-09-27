import { useEffect, useRef, useState, type ReactNode } from "react";
import { dataProvider } from "../data";
import type { ArtworkCandidate, ArtworkSeasons, EpisodeArtwork } from "../episodeArtwork";
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
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ArtworkCandidate[]>([]);
  const [series, setSeries] = useState("");
  const [seasons, setSeasons] = useState<ArtworkSeasons | null>(null);
  const [season, setSeason] = useState("");
  const [offset, setOffset] = useState("");
  const [preview, setPreview] = useState<EpisodeArtwork | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setOpen(false); setBusy(false); setPreview(null); setSeasons(null); setCandidates([]); setError(""); }, [workId]);
  const provider = dataProvider.episodeArtwork;
  if (!provider) return null;
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    const current = generation.current;
    try { await action(); }
    catch (e) { if (current === generation.current) setError(getErrorMessage(e)); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const search = (automatic = false) => perform(async () => {
    const current = generation.current;
    const result = await provider.search(workId, automatic || !query.trim() ? undefined : query);
    if (current !== generation.current) return;
    setCandidates(result.candidates); setError(result.warnings.join("；") || (result.candidates.length ? "" : "未找到候选，可尝试原名或填写 TMDB ID"));
  });
  const choose = (id: number) => perform(async () => {
    const current = generation.current;
    setSeries(String(id)); setSeasons(null); setSeason(""); setOffset(""); setPreview(null);
    const result = await provider.seasons(id);
    if (current !== generation.current) return;
    setSeasons(result); setError(result.warnings.join("；"));
    if (result.seasons.length === 1) setSeason(String(result.seasons[0]!.seasonNumber));
  });
  const run = (save: boolean) => perform(async () => {
    const current = generation.current;
    const result = save && preview?.source
      ? await provider.set(workId, preview.source.seriesId, preview.source.seasonNumber, preview.anchor, preview.source.episodeOffset ?? 0)
      : await provider.preview(workId, Number(series), Number(season), offset.trim() ? Number(offset) : undefined);
    if (current !== generation.current) return;
    if (save) { onChange(result); setOpen(false); } else setPreview(result);
  });
  const range = artwork?.correspondence;
  const first = range?.[0]; const last = range?.at(-1);
  return <div className="episode-artwork-control">
    <span>{artwork?.source ? `分集剧照：TMDB · 第 ${artwork.source.seasonNumber} 季${first && last ? ` · 第 ${first.tmdbNumber}–${last.tmdbNumber} 集` : ""}${artwork.source.method === "manual" ? "（手动）" : ""}` : "分集封面：文件缩略图"}</span>
    <button type="button" className="button secondary compact" disabled={busy} onClick={() => void perform(async () => { const current = generation.current; const result = await provider.refresh(workId, true); if (current === generation.current) onChange(result); })}>更新剧照</button>
    {artwork?.anchor.startsWith("bangumi:") ? <button type="button" className="button secondary compact" disabled={busy} onClick={() => { setQuery(""); setSeries(""); setSeason(""); setOffset(""); setSeasons(null); setPreview(null); setCandidates([]); setOpen(true); void search(true); }}>选择剧照来源</button> : null}
    {(warning || artwork?.warnings.length || (!open && error)) ? <p role="status">{warning || artwork?.warnings.join("；") || error}</p> : null}
    {open ? <Modal title="选择分集剧照来源" onClose={() => { if (!busy) setOpen(false); }} footer={<div className="form-actions episode-artwork-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className="button secondary" disabled={busy || !season || !seasons} onClick={() => void run(false)}>预览对应</button><button className="button primary" type="button" disabled={busy || !preview} onClick={() => void run(true)}>使用此来源</button></div>}>
      <p>TMDB 的季度划分可能与本作品不同。按播出日期核对分集，只补充图片，保留作品资料、文件关联和观看进度。</p>
      <div className="episode-artwork-search"><label className="field">查找 TMDB 作品<input aria-label="搜索 TMDB 剧照作品" placeholder="输入作品名称或原名" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} /></label><button className="button secondary" disabled={busy} onClick={() => void search()}>搜索作品</button></div>
      <div className="episode-artwork-candidates">{candidates.map(c => <button type="button" className={`button secondary${series === String(c.seriesId) ? " selected" : ""}`} disabled={busy} key={c.seriesId} onClick={() => void choose(c.seriesId)}><strong>{c.title}</strong><span>{c.originalTitle} · {c.airDate || "日期未知"} · ID {c.seriesId}</span></button>)}</div>
      <details className="episode-artwork-advanced"><summary>按 TMDB ID 指定来源</summary><div className="episode-artwork-search"><label className="field">TMDB 电视剧 ID<input aria-label="TMDB 电视剧 ID" type="number" min="1" value={series} disabled={busy} onChange={e => { setSeries(e.target.value); setSeasons(null); setSeason(""); setPreview(null); }} /></label><button className="button secondary" disabled={busy || !series} onClick={() => void choose(Number(series))}>读取季度</button></div></details>
      {seasons ? <><label className="field">{seasons.title} · TMDB 实际季度<select aria-label="TMDB 实际季度" value={season} disabled={busy} onChange={e => { setSeason(e.target.value); setPreview(null); setOffset(""); }}><option value="">选择季度</option>{seasons.seasons.map(s => <option key={s.seasonNumber} value={s.seasonNumber}>{s.name || `第 ${s.seasonNumber} 季`} · {s.episodeCount} 集 · {s.airDate || "日期未知"}</option>)}</select></label><details className="episode-artwork-advanced"><summary>日期不足时手动设置对应</summary><label className="field episode-artwork-offset">集号偏移（留空按日期核实）<input aria-label="TMDB 集号偏移" type="number" min="-9999" max="9999" placeholder="自动核实" value={offset} disabled={busy} onChange={e => { setOffset(e.target.value); setPreview(null); }} /></label><p className="quiet-inline">例如本作品第 1 集对应 TMDB 第 13 集，填 12；同号填 0。仅补充正片，请核对下面逐集对应。</p></details></> : null}
      {busy ? <p role="status">正在读取 TMDB 资料…</p> : null}
      {error ? <p className="gnz-inline-error" role="alert">{error}</p> : null}
      {preview ? <><strong>{preview.sourceTitle} · {Object.keys(preview.images).length} 集有剧照</strong><div className="episode-artwork-correspondence">{preview.correspondence?.map(row => <div key={row.episodeKey}><span>本作品第 {row.localNumber} 集 → TMDB 第 {preview.source?.seasonNumber} 季第 {row.tmdbNumber} 集</span><span>{row.hasStill ? "有剧照" : "使用文件缩略图"}</span></div>)}</div><div className="episode-artwork-preview">{Object.entries(preview.images).slice(0, 4).map(([key, url]) => <SafeImage key={key} src={url} alt="TMDB 剧照预览" fallback={<span>剧照不可用</span>} />)}</div>{preview.warnings.map(w => <p key={w}>{w}</p>)}</> : null}
    </Modal> : null}
  </div>;
}
