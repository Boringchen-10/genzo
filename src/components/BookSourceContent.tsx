import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, BookOpen, Download, FolderOpen, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { appendSourcePage, bookContentApi, type CachedContent, type ReadingKind, type SourcePage } from "../bookContent";
import { ErrorState, IconButton, LoadingState } from "./common";
import { getErrorMessage } from "../utils";
import "../book-content.css";

export function BookSourceContent({ kind, pathWord }: { kind: ReadingKind; pathWord: string }) {
  const identity = `${kind}:${pathWord}`;
  const current = useRef(identity); current.current = identity;
  const [group, setGroup] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<SourcePage | null>(null);
  const [cached, setCached] = useState<Record<string, CachedContent>>({});
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reverse, setReverse] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const query = useRef(0);
  useEffect(() => {
    const request = ++query.current;
    setLoading(true); setError(""); setPage(null); setMenu(null); setExpanding(false);
    void bookContentApi.entries(kind, pathWord, group, 0, attempt > 0).then(value => {
      if (query.current === request) setPage(value);
    }).catch(reason => { if (query.current === request) setError(getErrorMessage(reason)); })
      .finally(() => { if (query.current === request) setLoading(false); });
    return () => { query.current++; };
  }, [kind, pathWord, group, attempt]);
  useEffect(() => {
    let cancelled = false;
    if (page) void bookContentApi.cached(kind, pathWord, page.entries.map(e => e.id)).then(values => {
      if (!cancelled) setCached(Object.fromEntries(values.map(v => [v.entryId, v])));
    }).catch(reason => { if (!cancelled) setError(getErrorMessage(reason)); });
    return () => { cancelled = true; };
  }, [kind, pathWord, page]);
  const expand = async () => {
    if (!page || expanding) return;
    const request = query.current; setExpanding(true); setError("");
    try {
      const next = await bookContentApi.entries(kind, pathWord, page.group, page.offset + page.entries.length);
      if (query.current === request) setPage(appendSourcePage(page, next));
    } catch (reason) { if (query.current === request) setError(getErrorMessage(reason)); }
    finally { if (query.current === request) setExpanding(false); }
  };
  const action = async (id: string, operation: "cache" | "refresh" | "open" | "folder" | "clear") => {
    if (busy) return;
    const owner = identity; setBusy(id); setMenu(null); setError(""); setNotice("");
    try {
      if (operation === "cache" || operation === "refresh") {
        const value = await bookContentApi.cache(kind, pathWord, id, page?.group ?? "", operation === "refresh");
        if (current.current === owner) { setCached(values => ({ ...values, [id]: value })); setNotice("完整缓存已保存，可以打开阅读。"); }
      } else if (operation === "clear") {
        await bookContentApi.clear(kind, pathWord, id);
        if (current.current === owner) { setCached(values => { const next = { ...values }; delete next[id]; return next; }); setNotice("已清除此章卷的生成缓存，作品和个人记录保留。"); }
      } else {
        await bookContentApi.open(kind, pathWord, id, operation === "folder");
        if (current.current === owner) setNotice(operation === "folder" ? "已打开缓存目录。" : "已交给外部阅读器；阅读状态请在书架手动记录。");
      }
    } catch (reason) { if (current.current === owner) setError(getErrorMessage(reason)); }
    finally { if (current.current === owner) setBusy(null); }
  };
  const entries = page ? reverse ? [...page.entries].reverse() : page.entries : [];
  return <section className="detail-section book-source-content" aria-label={kind === "novel" ? "来源分卷" : "来源章节"}>
    <div className="detail-section-head"><h2>{kind === "novel" ? "来源分卷" : "来源章节"}</h2>
      <div className="book-content-controls">
        {!!page?.groups.length && <select aria-label="章节分组" value={page.group} disabled={!!busy} onChange={e => setGroup(e.target.value)}>{page.groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>}
        <IconButton tooltip={reverse ? "当前倒序，切换顺序" : "当前顺序，切换倒序"} onClick={() => setReverse(v => !v)}><ArrowDownUp size={17} /></IconButton>
        <IconButton tooltip="刷新来源目录" disabled={loading || !!busy} onClick={() => setAttempt(v => v + 1)}><RefreshCw size={17} /></IconButton>
      </div>
    </div>
    <p className="quiet-inline">按需获取有权访问的内容，完整缓存后以 {kind === "novel" ? "EPUB（含章节目录与插图，同时保留 TXT）" : "CBZ"} 交给工具中心的默认阅读器。打开不会自动标记已读。</p>
    {loading && <LoadingState label="正在加载来源目录" />}
    {error && <ErrorState message={error} retry={() => setAttempt(v => v + 1)} />}
    {page?.stale && <p role="status" className="quiet-inline">显示上次缓存的目录，来源更新暂不可用。</p>}
    {notice && <p role="status" className="quiet-inline">{notice}</p>}
    {!loading && page && <>
      <p className="quiet-inline">已显示 {page.entries.length} / {page.total} {kind === "novel" ? "卷" : "章"}{page.total === 0 ? " · 来源暂未提供目录" : ""}</p>
      <div className="book-content-entries">{entries.map(entry => <div className="book-content-row" key={entry.id}>
        <div className="book-content-title"><strong>{entry.title}</strong><span>{busy === entry.id ? "正在处理…请稍候" : cached[entry.id] ? `已缓存 · ${cached[entry.id]!.format} · ${(cached[entry.id]!.bytes / 1024 / 1024).toFixed(1)} MB` : "尚未缓存"}</span></div>
        <button type="button" className="button secondary compact icon-text" disabled={!!busy} onClick={() => void action(entry.id, cached[entry.id] ? "open" : "cache")}>{cached[entry.id] ? <BookOpen size={16} /> : <Download size={16} />}{cached[entry.id] ? "打开" : "获取"}</button>
        <div className="book-content-menu-holder">
          <IconButton tooltip={`${entry.title} 更多操作`} disabled={!!busy} onClick={() => setMenu(v => v === entry.id ? null : entry.id)}><MoreHorizontal size={17} /></IconButton>
          {menu === entry.id && <><button className="book-content-dismiss" aria-label="关闭章节菜单" onClick={() => setMenu(null)} /><div className="book-content-menu" role="menu">
            <button role="menuitem" disabled={!cached[entry.id]} onClick={() => void action(entry.id, "folder")}><FolderOpen size={15} />打开缓存目录</button>
            <button role="menuitem" onClick={() => void action(entry.id, "refresh")}><RefreshCw size={15} />重新获取</button>
            <button role="menuitem" disabled={!cached[entry.id]} onClick={() => void action(entry.id, "clear")}><Trash2 size={15} />清除本章卷缓存</button>
          </div></>}
        </div>
      </div>)}</div>
      {page.entries.length < page.total && <div className="gnz-explore-more"><button className="button secondary" disabled={expanding || !!busy} onClick={() => void expand()}>{expanding ? "正在展开…" : "展开更多章节"}</button></div>}
    </>}
  </section>;
}
