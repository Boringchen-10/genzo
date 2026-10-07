import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowDown, ArrowUp, Download, RefreshCw, X } from "lucide-react";
import { bookContentApi, type ReadingKind, type SourceEntry, type SourcePage, type ReadingResume } from "../bookContent";
import LoadingIndicator from "./LoadingIndicator";
import { androidSession, READING_NETWORK_CHANGED } from "./sessionCache";

export const CHAPTER_PAGE_SIZE = 100;
type ChapterView = { source: SourcePage; page: number; descending: boolean; groupTotals: Record<string, number> };
export function chapterPageRange(total: number, page: number, descending: boolean) {
  const start = (page - 1) * CHAPTER_PAGE_SIZE;
  return { offset: descending ? Math.max(0, total - start - CHAPTER_PAGE_SIZE) : start, length: Math.max(0, Math.min(CHAPTER_PAGE_SIZE, total - start)) };
}

export default function OnlineChapters({ kind, pathWord, selecting, onSelecting, onRead, onToast, onTotal }: {
  kind: ReadingKind; pathWord: string; selecting: boolean; onSelecting: (value: boolean) => void;
  onRead: (entry: SourceEntry, group: string) => void; onToast: (message: string) => void; onTotal?: (total: number) => void;
}) {
  const cachePrefix = `reading:chapters:${kind}:${pathWord}:`;
  const viewKey = `reading:chapter-view:${kind}:${pathWord}`;
  const saved = androidSession.peek<ChapterView>(viewKey);
  const [source, setSource] = useState<SourcePage | null>(() => saved?.source ?? null);
  const [page, setPage] = useState(() => saved?.page ?? 1);
  const [descending, setDescending] = useState(() => saved?.descending ?? false);
  const [loading, setLoading] = useState(() => !saved);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Map<string, SourceEntry>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [groupTotals, setGroupTotals] = useState<Record<string, number>>(() => saved?.groupTotals ?? {});
  const request = useRef(0);
  const lastRequest = useRef<{ group: string; page: number; reverse: boolean; total?: number }>({ group: "", page: 1, reverse: false });
  const downloadActive = useRef(false);
  const mounted = useRef(true);
  const [resume, setResume] = useState<ReadingResume | null>(null);
  useEffect(() => {
    let active = true;
    let revision = 0;
    let unlisten: (() => void) | undefined;
    void listen<ReadingResume & { kind: ReadingKind; pathWord: string }>("reading-progress-updated", event => {
      if (active && event.payload.kind === kind && event.payload.pathWord === pathWord) { revision++; setResume(event.payload); }
    }).then(value => { if (active) unlisten = value; else value(); }).catch(() => {});
    const refresh = () => { const current = revision; void bookContentApi.resume(kind, pathWord).then(value => { if (active && current === revision) setResume(value); }).catch(() => {}); };
    refresh(); window.addEventListener("focus", refresh);
    return () => { active = false; unlisten?.(); window.removeEventListener("focus", refresh); };
  }, [kind, pathWord]);

  async function readPage(group: string, offset: number, refresh: boolean) {
    const value = await androidSession.load(`${cachePrefix}${group}:${offset}`, () => bookContentApi.entries(kind, pathWord, group, offset, refresh), refresh);
    if (androidSession.peek(`${cachePrefix}${group}:${offset}`) === value) androidSession.set(`${cachePrefix}${value.group}:${offset}`, value);
    return value;
  }
  function readCached(entries: SourceEntry[], sequence: number) {
    void bookContentApi.cached(kind, pathWord, entries.map(entry => entry.id)).then(items => {
      if (mounted.current && sequence === request.current) setCached(previous => new Set([...previous].filter(id => !entries.some(entry => entry.id === id)).concat(items.map(item => item.entryId))));
    }).catch(() => {});
  }

  async function load(group = "", nextPage = 1, reverse = false, total?: number, refresh = false) {
    const sequence = ++request.current;
    lastRequest.current = { group, page: nextPage, reverse, total };
    setLoading(true); setError("");
    try {
      let value = await readPage(group, total == null ? 0 : chapterPageRange(total, nextPage, reverse).offset, refresh);
      if (reverse && total == null && value.total > CHAPTER_PAGE_SIZE) {
        value = await readPage(value.group, chapterPageRange(value.total, nextPage, true).offset, refresh);
      }
      if (sequence !== request.current) return;
      const length = chapterPageRange(value.total, nextPage, reverse).length;
      const entries = value.entries.slice(0, length);
      if (reverse) entries.reverse();
      setSource({ ...value, entries }); setPage(nextPage); setDescending(reverse); setLoading(false); onTotal?.(value.total);
      setGroupTotals(previous => ({ ...previous, [value.group]: value.total }));
      if (!group) void Promise.allSettled(value.groups.filter(candidate => candidate.id !== value.group).map(async candidate => {
        const other = await readPage(candidate.id, 0, refresh);
        if (mounted.current && sequence === request.current) setGroupTotals(previous => ({ ...previous, [candidate.id]: other.total }));
      }));
      readCached(entries, sequence);
    } catch (reason) {
      if (sequence === request.current) { setError(String(reason)); setLoading(false); }
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (saved) { lastRequest.current = { group: saved.source.group, page: saved.page, reverse: saved.descending, total: saved.source.total }; onTotal?.(saved.source.total); readCached(saved.source.entries, request.current); }
    else void load();
    const changed = () => { setSelected(new Map()); setGroupTotals({}); void load("", 1, lastRequest.current.reverse, undefined, true); };
    window.addEventListener(READING_NETWORK_CHANGED, changed);
    return () => { window.removeEventListener(READING_NETWORK_CHANGED, changed); mounted.current = false; request.current++; downloadActive.current = false; };
    // A new work mounts a fresh component; other controls request their own pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, pathWord]);
  useEffect(() => {
    if (source && !loading && !error) androidSession.set(viewKey, { source, page, descending, groupTotals } satisfies ChapterView);
  }, [source, page, descending, groupTotals, loading, error, viewKey]);
  useEffect(() => { if (!selecting) { setSelected(new Map()); downloadActive.current = false; } }, [selecting]);

  async function downloadSelected() {
    if (!source || !selected.size || downloadActive.current) return;
    const entries = [...selected.values()];
    const group = source.group;
    downloadActive.current = true;
    setProgress({ done: 0, total: entries.length });
    let done = 0;
    for (const entry of entries) {
      if (!downloadActive.current) break;
      try {
        await bookContentApi.cache(kind, pathWord, entry.id, group);
        done++;
        if (!mounted.current) return;
        setCached(previous => new Set([...previous, entry.id]));
        setSelected(previous => { const next = new Map(previous); next.delete(entry.id); return next; });
        setProgress({ done, total: entries.length });
      } catch (reason) {
        if (mounted.current) onToast(`${entry.title} 下载失败：${String(reason)}；未完成章节保留选择，可重试`);
        break;
      }
    }
    if (!mounted.current) return;
    downloadActive.current = false; setProgress(null);
    if (done === entries.length) { onSelecting(false); onToast(`已下载 ${done} 话，可离线阅读`); }
  }
  const busy = !!progress;
  const pages = Math.max(1, Math.ceil((source?.total ?? 0) / CHAPTER_PAGE_SIZE));
  const visiblePages = [...new Set([1, ...Array.from({ length: 5 }, (_, index) => page - 2 + index).filter(value => value > 0 && value <= pages), pages])].sort((a, b) => a - b);
  const allSelected = !!source?.entries.length && source.entries.every(entry => selected.has(entry.id));
  const groupPriority = (group: { id: string; title: string }) => group.id === "default" ? 0 : /单行本|單行本/.test(group.title) ? 1 : 2;
  const groups = [...(source?.groups ?? [])].sort((a, b) => groupPriority(a) - groupPriority(b));
  return <section className="gz-online-chapters" aria-label="在线章节">
    <div className="gz-section-head"><h2>在线章节</h2>{resume && !selecting && <button className="gz-btn" type="button" disabled={busy} onClick={() => onRead({ id: resume.entryId, title: "继续上次阅读", order: 0, count: 0 }, resume.group)}>继续上次阅读</button>}</div>
    {source && source.groups.length > 0 && <div className="gz-book-tabs" role="tablist" aria-label="章节分组">
      {groups.map(group => <button key={group.id} role="tab" className={source.group === group.id ? "active" : ""} aria-selected={source.group === group.id} disabled={busy || loading} onClick={() => { setSelected(new Map()); void load(group.id, 1, descending); }}>{group.id === "default" ? "默认" : group.title}{groupTotals[group.id] != null && <span>({groupTotals[group.id]})</span>}</button>)}
    </div>}
    {source && <div className="gz-chapter-pages">
      <div className="gz-book-groups">{visiblePages.map((value, index) => <span className="gz-chapter-page-item" key={value}>{index > 0 && value > (visiblePages[index - 1] ?? 0) + 1 && <span aria-hidden="true">…</span>}<button className={`gz-book-group${value === page ? " active" : ""}`} aria-label={`章节第 ${value} 页`} aria-current={value === page ? "page" : undefined} disabled={busy || loading} onClick={() => void load(source.group, value, descending, source.total)}>{value}</button></span>)}</div>
      <button type="button" className="gz-iconbtn gz-chapter-order" aria-label={descending ? "当前倒序，切换顺序" : "当前顺序，切换倒序"} title={descending ? "倒序" : "顺序"} disabled={busy || loading} onClick={() => void load(source.group, 1, !descending, source.total)}>{descending ? <ArrowDown size={18} /> : <ArrowUp size={18} />}</button>
    </div>}
    {selecting && source && <div className="gz-chapter-selection">
      <button className="gz-chip" disabled={busy || loading} onClick={() => setSelected(previous => { const next = new Map(previous); for (const entry of source.entries) { if (allSelected) next.delete(entry.id); else next.set(entry.id, entry); } return next; })}>{allSelected ? "取消本页全选" : "全选本页"}</button>
      <button className="gz-btn primary" disabled={busy || !selected.size} onClick={() => void downloadSelected()}><Download size={16} />{progress ? `下载 ${progress.done}/${progress.total}` : `下载 ${selected.size} 话`}</button>
      <button className="gz-chip" disabled={busy} onClick={() => onSelecting(false)}><X size={14} />取消</button>
    </div>}
    {loading && <LoadingIndicator label="正在读取章节目录…" compact={!!source} />}
    {error && <div className="gz-error" role="alert"><span>{error}</span><button className="gz-iconbtn" aria-label="重试章节目录" onClick={() => { const query = lastRequest.current; void load(query.group, query.page, query.reverse, query.total, true); }}><RefreshCw size={16} /></button></div>}
    {source && <div className="gz-chapter-grid">{source.entries.map(entry => <button type="button" data-chapter-id={entry.id} className={`gz-chapter${selected.has(entry.id) ? " selected" : ""}`} key={entry.id} disabled={busy || loading || !!error} aria-pressed={selecting ? selected.has(entry.id) : undefined} onClick={() => selecting ? setSelected(previous => { const next = new Map(previous); if (next.has(entry.id)) next.delete(entry.id); else next.set(entry.id, entry); return next; }) : onRead(entry, source.group)}><strong>{entry.title}</strong><span className="gz-chapter-badge">{cached.has(entry.id) ? "已下载" : entry.count ? `${entry.count}P` : "在线"}</span></button>)}</div>}
    {!loading && !error && source?.entries.length === 0 && <p className="gz-meta">暂无章节。</p>}
    {source?.stale && <p className="gz-meta">当前显示缓存目录，可重试刷新。</p>}
  </section>;
}
