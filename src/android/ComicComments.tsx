import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronUp, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { comicExploreApi, novelExploreApi, type CopyComment, type CopyCommentPage } from "../comicExplore";
import { androidSession } from "./sessionCache";
import LoadingIndicator from "./LoadingIndicator";

export default function ComicComments({ pathWord, kind = "comic", onClose }: { pathWord: string | null; kind?: "comic" | "novel"; onClose: () => void }) {
  const content = kind === "comic" ? comicExploreApi : novelExploreApi;
  const label = kind === "comic" ? "漫画" : "轻小说";
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const offset = useRef(0);
  const [items, setItems] = useState<CopyComment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<"source" | "newest" | "oldest">("source");

  async function load(first = false, force = false) {
    if (!pathWord || pending.current) return;
    const request = generation.current;
    pending.current = true;
    setLoading(true); setError("");
    try {
      const page = first
        ? await androidSession.load<CopyCommentPage>(`reading:comments:${kind}:${pathWord}`, () => content.comments(pathWord), force)
        : await content.comments(pathWord, offset.current);
      if (request !== generation.current) return;
      offset.current = page.offset + page.items.length;
      setItems(previous => [...new Map([...(first ? [] : previous), ...page.items].map(item => [item.id, item])).values()]);
      setTotal(page.total);
      setHasMore(page.items.length > 0 && offset.current < page.total);
    } catch {
      if (request === generation.current) setError("评论读取失败，请检查阅读网络设置后重试。");
    } finally {
      if (request === generation.current) { pending.current = false; setLoading(false); }
    }
  }

  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement as HTMLElement | null;
    generation.current++; pending.current = false; offset.current = 0;
    setItems([]); setTotal(0); setExpanded(new Set()); setSort("source"); setSortOpen(false);
    if (node && !node.open) node.showModal();
    if (pathWord) void load(true);
    else { setLoading(false); setError(`此作品尚未关联${label}来源，暂时无法读取评论。`); }
    return () => {
      generation.current++; pending.current = false;
      node?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [pathWord, kind]);

  const shown = sort === "source" ? items : [...items].sort((a, b) => {
    const left = Date.parse(a.createAt); const right = Date.parse(b.createAt);
    return Number.isFinite(left) && Number.isFinite(right) ? (sort === "newest" ? right - left : left - right) : 0;
  });

  return <dialog ref={dialog} className="gz-comments-dialog" aria-labelledby="gz-comments-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="gz-comments-panel">
      <span className="gz-comments-handle" aria-hidden="true" />
      <header className="gz-comments-header">
        <div><h2 id="gz-comments-title">{label}评论</h2><span className="gz-meta">来自{label}来源的评论</span></div>
        <span className="gz-meta">{items.length} / {total}</span>
        <button className="gz-iconbtn" type="button" aria-label="评论排序" aria-expanded={sortOpen} onClick={() => setSortOpen(value => !value)}><SlidersHorizontal size={20} /></button>
        <button className="gz-iconbtn" type="button" aria-label="关闭评论" onClick={onClose} autoFocus><X size={20} /></button>
      </header>
      {sortOpen && <div className="gz-comments-sort"><span className="gz-meta">仅排序已加载评论</span><div className="gz-seg" aria-label="已加载评论排序">{([["source", "来源顺序"], ["newest", "最新在前"], ["oldest", "最早在前"]] as const).map(([id, label]) => <button type="button" key={id} className={sort === id ? "active" : ""} aria-pressed={sort === id} onClick={() => setSort(id)}>{label}</button>)}</div></div>}
      <div className="gz-comments-list" ref={list}>
        {shown.map(item => <article className="gz-comment-card" key={item.id}>
          <div className="gz-comment-byline">
            <span className="gz-comment-avatar">{item.userName.slice(0, 1) || "匿"}{item.userAvatar && <img src={item.userAvatar} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true; }} />}</span>
            <span className="gz-comment-name">{item.userName || "匿名用户"}</span>
            {item.createAt && <time className="gz-meta">{item.createAt}</time>}
          </div>
          {item.parentUserName && <p className="gz-meta">回复 {item.parentUserName}</p>}
          <p className={`gz-comment-body ${!expanded.has(item.id) && (item.comment.length > 100 || item.comment.split("\n").length > 3) ? "is-collapsed" : ""}`}>{item.comment}</p>
          {(item.comment.length > 100 || item.comment.split("\n").length > 3) && <button type="button" className="gz-comment-expand" aria-expanded={expanded.has(item.id)} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{expanded.has(item.id) ? "收起正文" : "展开全文"}{expanded.has(item.id) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}
          {item.replyCount > 0 && <p className="gz-meta">{item.replyCount} 条回复 · 回复内容待接入</p>}
        </article>)}
        {loading && <LoadingIndicator label="正在读取评论…" compact />}
        {error && <div className="gz-comments-error" role="alert"><p>{error}</p>{pathWord && <button type="button" className="gz-btn" onClick={() => void load(items.length === 0, true)}><RefreshCw size={16} />重试</button>}</div>}
        {!loading && !error && !items.length && <div className="gz-empty"><h2>暂无评论</h2><p>这本{label}还没有来源评论。</p></div>}
        {!loading && !error && hasMore && <button type="button" className="gz-btn gz-comments-more" onClick={() => void load()}>加载更多评论</button>}
        {!loading && !error && items.length > 0 && !hasMore && <p className="gz-meta gz-comments-end">已显示全部可读取评论</p>}
      </div>
      <button type="button" className="gz-iconbtn gz-comments-top" aria-label="评论回到顶部" onClick={() => list.current?.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><ArrowUp size={20} /></button>
    </section>
  </dialog>;
}
