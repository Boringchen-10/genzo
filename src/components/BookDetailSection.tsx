import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown01, ArrowDown10, BookOpen, BookOpenCheck, Check, ChevronRight, Circle, CircleCheck, FileText, GripVertical, MoreHorizontal, Pencil, RefreshCw, Search, Sparkles, Trash2, Unlink } from "lucide-react";
import { bookApi } from "../api";
import type { BookCandidate, BookEntry, BookEntryInput, BookEntryOrder, BookVolumeBatchPreview, BookVolumeBatchResult, BookVolumeCandidate, EmbeddedBookMetadata } from "../bookData";
import { ConfirmDialog, Modal } from "./common";
import { ResilientImage } from "./ResilientImage";
import { getErrorMessage } from "../utils";
import "../book-detail.css";

const readLabels: Record<BookEntry["readState"], string> = { unread: "未读", reading: "阅读中", read: "已读" };

export function BookDetailSection({ workId, onMetadataChanged }: { workId: string; onMetadataChanged: () => void }) {
  const [entries, setEntries] = useState<BookEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<BookEntry | null>(null);
  const [draft, setDraft] = useState<BookEntryInput>({ title: null, volumeNumber: null, chapterNumber: null, readState: "unread" });
  const [embedded, setEmbedded] = useState<{ id: string; data: EmbeddedBookMetadata } | null>(null);
  const [volumeMetadata, setVolumeMetadata] = useState<Record<string, EmbeddedBookMetadata>>({});
  const requestedMetadata = useRef(new Set<string>());
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<BookCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [volumeSearch, setVolumeSearch] = useState<{ entryId: string; query: string; candidates: BookVolumeCandidate[]; error: string; loading: boolean } | null>(null);
  const volumeSearchRequest = useRef(0);
  const [batchPreview, setBatchPreview] = useState<BookVolumeBatchPreview | null>(null);
  const [batchEntryIds, setBatchEntryIds] = useState<string[]>([]);
  const [batchResult, setBatchResult] = useState<BookVolumeBatchResult | null>(null);
  const [batchError, setBatchError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [readResult, setReadResult] = useState("");
  const [sortMode, setSortMode] = useState<BookEntryOrder["mode"]>("asc");
  const [manualOrderIds, setManualOrderIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const entryIds = entries.map(entry => entry.id).join("|");
  const manualPositions = new Map(manualOrderIds.map((id, index) => [id, index]));
  const visibleEntries = sortMode === "desc" ? [...entries].reverse() : sortMode === "custom"
    ? [...entries].sort((left, right) => (manualPositions.get(left.id) ?? entries.length) - (manualPositions.get(right.id) ?? entries.length))
    : entries;

  const load = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const [nextEntries, order] = await Promise.all([bookApi.entries(workId), bookApi.order(workId)]);
      setEntries(nextEntries); setSortMode(order.mode); setManualOrderIds(order.entryIds); setError("");
    }
    catch (reason) { setError(getErrorMessage(reason)); }
  }, [workId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelectedEntryIds(ids => ids.filter(id => entries.some(entry => entry.id === id))); }, [entryIds]);
  useEffect(() => {
    requestedMetadata.current.clear();
    setVolumeMetadata({});
  }, [workId]);
  useEffect(() => {
    if (!isTauri()) return;
    const pending = entries.filter(entry => !entry.missing && ["cbz", "zip", "epub"].includes(entry.format.toLowerCase()) && !requestedMetadata.current.has(entry.id));
    pending.forEach(entry => requestedMetadata.current.add(entry.id));
    let cancelled = false;
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length && !cancelled) {
        const entry = pending[cursor++];
        if (!entry) break;
        try {
          const data = await bookApi.embedded(entry.id);
          if (!cancelled) setVolumeMetadata(previous => ({ ...previous, [entry.id]: data }));
        } catch { /* 远程、缺失或无内嵌资料的单册仍可手动编辑。 */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    return () => { cancelled = true; };
  }, [entryIds]);

  const changeReadState = async (entry: BookEntry, readState: BookEntry["readState"]) => {
    setBusy(true);
    try {
      setEntries(await bookApi.saveReadState(workId, [entry.id], readState));
      setReadResult("");
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const changeSelectedReadState = async (readState: "read" | "unread") => {
    if (!selectedEntryIds.length) return;
    setBusy(true); setReadResult("");
    try {
      setEntries(await bookApi.saveReadState(workId, selectedEntryIds, readState));
      setReadResult(`已将 ${selectedEntryIds.length} 卷标记为${readLabels[readState]}`);
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try { setEntries(await bookApi.saveEntry(workId, editing.id, draft)); setEditing(null); setError(""); }
    catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const search = async () => {
    setSearching(true); setMatchError("");
    try { setCandidates(await bookApi.search(workId, query.trim() || undefined)); }
    catch (reason) { setMatchError(getErrorMessage(reason)); }
    finally { setSearching(false); }
  };

  const confirm = async (candidate: BookCandidate) => {
    setBusy(true); setMatchError("");
    try { await bookApi.confirm(workId, candidate.externalId); setCandidates([]); onMetadataChanged(); }
    catch (reason) { setMatchError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const searchVolume = async (entryId: string, query?: string) => {
    const request = ++volumeSearchRequest.current;
    setVolumeSearch({ entryId, query: query ?? "", candidates: [], error: "", loading: true });
    try {
      const found = await bookApi.searchVolume(workId, entryId, query?.trim() || undefined);
      if (request === volumeSearchRequest.current) setVolumeSearch({ entryId, query: query ?? "", candidates: found, error: "", loading: false });
    } catch (reason) {
      if (request === volumeSearchRequest.current) setVolumeSearch({ entryId, query: query ?? "", candidates: [], error: getErrorMessage(reason), loading: false });
    }
  };

  const confirmVolume = async (entry: BookEntry, candidate: BookVolumeCandidate) => {
    setBusy(true);
    try {
      await bookApi.confirmVolume(workId, entry.id, candidate.externalId);
      setEntries(await bookApi.entries(workId));
      volumeSearchRequest.current++;
      setVolumeSearch(null);
      setError("");
    } catch (reason) {
      setVolumeSearch(previous => previous?.entryId === entry.id ? { ...previous, error: getErrorMessage(reason) } : previous);
    } finally { setBusy(false); }
  };

  const previewBatch = async (entryIds?: string[]) => {
    setBusy(true); setBatchError(""); setBatchResult(null);
    try {
      const preview = await bookApi.previewVolumeBatch(workId, entryIds);
      setBatchPreview(preview); setBatchEntryIds(preview.proposals.map(item => item.entryId));
    }
    catch (reason) { setBatchPreview(null); setBatchError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const confirmBatch = async () => {
    if (!batchPreview || !batchEntryIds.length) return;
    setBusy(true); setBatchError("");
    try {
      const result = await bookApi.confirmVolumeBatch(workId, batchPreview, batchEntryIds);
      setEntries(await bookApi.entries(workId));
      setBatchResult(result);
      setBatchPreview(null);
    } catch (reason) { setBatchError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const removeSelected = async () => {
    if (!selectedEntryIds.length) return;
    setBusy(true);
    try {
      setEntries(await bookApi.removeEntries(workId, selectedEntryIds));
      setSelectedEntryIds([]);
      setSelecting(false);
      setDeleteOpen(false);
      setError("");
      onMetadataChanged();
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const saveOrder = async (mode: BookEntryOrder["mode"], ids?: string[]) => {
    setBusy(true);
    try {
      const saved = await bookApi.saveOrder(workId, mode, ids);
      setSortMode(saved.mode); setManualOrderIds(saved.entryIds); setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const moveEntry = (fromId: string, toId: string) => {
    if (fromId === toId || busy || selecting) return;
    const ids = visibleEntries.map(entry => entry.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    void saveOrder("custom", ids);
  };

  if (!isTauri()) return <p className="quiet-inline">书籍卷册与刮削需要在 Genzo 桌面应用中使用。</p>;
  return <div className="book-detail" id="bookshelf-entries">
    <div className="book-detail-toolbar">
      <strong>书籍与阅读记录</strong>
      <div className="book-entry-actions">{selecting ? <>
        <span className="quiet-inline">已选 {selectedEntryIds.length} 卷</span>
        <button type="button" className="button compact secondary" disabled={busy} onClick={() => setSelectedEntryIds(selectedEntryIds.length === entries.length ? [] : entries.map(entry => entry.id))}>{selectedEntryIds.length === entries.length ? "取消全选" : "全选"}</button>
        <button type="button" className="book-read-toggle read" aria-label="标记所选为已读" title="标记所选为已读" disabled={busy || selectedEntryIds.length === 0} onClick={() => void changeSelectedReadState("read")}><CircleCheck size={18} /></button>
        <button type="button" className="book-read-toggle unread" aria-label="标记所选为未读" title="标记所选为未读" disabled={busy || selectedEntryIds.length === 0} onClick={() => void changeSelectedReadState("unread")}><Circle size={18} /></button>
        <button type="button" className="button compact secondary" disabled={busy || selectedEntryIds.length === 0} onClick={() => void previewBatch(selectedEntryIds)}><Sparkles size={14} />识别所选</button>
        <button type="button" className="button compact danger" disabled={busy || selectedEntryIds.length === 0} onClick={() => setDeleteOpen(true)}><Trash2 size={14} />删除所选</button>
        <button type="button" className="button compact secondary" disabled={busy} onClick={() => { setSelecting(false); setSelectedEntryIds([]); }}>取消</button>
      </> : <>
        <div className="book-order-controls" role="group" aria-label="卷册排序">
          <button type="button" aria-label="按卷号升序" title="按卷号升序" aria-pressed={sortMode === "asc"} disabled={busy || entries.length === 0} onClick={() => void saveOrder("asc")}><ArrowDown01 size={17} /></button>
          <button type="button" aria-label="按卷号降序" title="按卷号降序" aria-pressed={sortMode === "desc"} disabled={busy || entries.length === 0} onClick={() => void saveOrder("desc")}><ArrowDown10 size={17} /></button>
        </div>
        {sortMode === "custom" ? <span className="book-order-label">自定义顺序</span> : null}
        <button type="button" className="button compact secondary" disabled={busy || entries.length === 0} onClick={() => void previewBatch()}>批量识别卷册</button>
        <button type="button" className="button compact secondary" disabled={busy || entries.length === 0} onClick={() => setSelecting(true)}><Check size={14} />多选</button>
        <button type="button" className="button compact secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={14} />刷新</button>
      </>}</div>
    </div>
    {error ? <p role="alert" className="gnz-inline-error">{error}</p> : null}
    {readResult ? <p role="status" className="quiet-inline">{readResult}</p> : null}
    {batchError ? <p role="alert" className="gnz-inline-error">{batchError}</p> : null}
    {batchResult ? <div role="status" className="quiet-inline">已匹配 {batchResult.matched} 卷；跳过 {batchResult.skipped.length} 卷，可按需逐卷核对。{batchResult.skipped.length ? <div className="book-volume-batch-list">{batchResult.skipped.map(item => <div key={item.entryId}><span>{item.entryTitle}</span><small>{item.reason}</small></div>)}</div> : null}</div> : null}
    {batchPreview ? <div className="book-volume-batch">
      <strong>批量匹配预览 · {batchPreview.proposals.length} 卷可关联，{batchPreview.skipped.length} 卷待核对</strong>
      <p>仅按本地唯一卷号对应已关联 Bangumi 系列中的唯一单行本；保存前会再次核实每卷的类型和编号。</p>
      <div className="book-volume-review-list">{batchPreview.proposals.map(item => {
        const entry = entries.find(entry => entry.id === item.entryId);
        return <div className="book-volume-review" key={item.entryId}>
          <label className="book-entry-select"><input type="checkbox" aria-label={`匹配${item.entryTitle}`} disabled={busy} checked={batchEntryIds.includes(item.entryId)} onChange={() => setBatchEntryIds(ids => ids.includes(item.entryId) ? ids.filter(id => id !== item.entryId) : [...ids, item.entryId])} /></label>
          <div className="book-volume-review-local"><small>本地文件{entry?.format === "images" ? `夹 · ${entry.mediaFileIds.length} 页` : ""}</small><strong title={entry?.fileName ?? item.entryTitle}>{entry?.fileName ?? item.entryTitle}</strong><span>第 {item.volumeNumber} 卷</span></div>
          <ChevronRight className="book-volume-review-arrow" size={16} />
          <div className="book-volume-review-match"><small>Bangumi 单行本 · #{item.candidate.externalId}{item.candidate.stale ? " · 离线缓存" : ""}</small><strong title={item.candidate.title}>{item.candidate.title}</strong><span>第 {item.candidate.volumeNumber} 卷 · 卷号一致</span></div>
          <ResilientImage sources={[item.candidate.coverUrl]} className="book-volume-review-cover" alt={`${item.candidate.title}的候选封面`} fallback={<span className="book-volume-review-cover placeholder"><BookOpen size={20} /><small>暂无封面</small></span>} />
        </div>;
      })}{batchPreview.skipped.map(item => {
        const entry = entries.find(entry => entry.id === item.entryId);
        return <div className="book-volume-review skipped" key={item.entryId}><div className="book-volume-review-local"><small>待核对{entry?.volumeNumber != null ? ` · 第 ${entry.volumeNumber} 卷` : ""}</small><strong title={entry?.fileName ?? item.entryTitle}>{entry?.fileName ?? item.entryTitle}</strong></div><span className="book-volume-review-reason">{item.reason}</span></div>;
      })}</div>
      <div className="book-detail-toolbar"><button type="button" className="button compact secondary" disabled={busy || !batchPreview.proposals.length} onClick={() => setBatchEntryIds(batchEntryIds.length === batchPreview.proposals.length ? [] : batchPreview.proposals.map(item => item.entryId))}>{batchEntryIds.length === batchPreview.proposals.length ? "取消全选" : "全选可关联"}</button><div className="book-entry-actions"><button type="button" className="button compact secondary" disabled={busy} onClick={() => setBatchPreview(null)}>取消</button><button type="button" className="button compact primary" disabled={busy || batchEntryIds.length === 0} onClick={() => void confirmBatch()}>{busy ? "核实中…" : `确认匹配 ${batchEntryIds.length} 卷`}</button></div></div>
    </div> : null}
    {entries.length ? <div className="book-entry-list">{visibleEntries.map((entry, index) => {
      const local = volumeMetadata[entry.id];
      const localNumber = local?.number && /^\d+(?:\.\d+)?$/.test(local.number.trim()) ? Number(local.number) : null;
      return <article className={`book-entry${dropTargetId === entry.id ? " drop-target" : ""}`} key={entry.id}
        onDragOver={event => { if (draggingId && draggingId !== entry.id) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTargetId(entry.id); } }}
        onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData("text/plain"); setDraggingId(null); setDropTargetId(null); moveEntry(sourceId, entry.id); }}>
      {selecting ? <label className="book-entry-select"><input type="checkbox" aria-label={`选择${entry.title}`} disabled={busy} checked={selectedEntryIds.includes(entry.id)} onChange={() => setSelectedEntryIds(ids => ids.includes(entry.id) ? ids.filter(id => id !== entry.id) : [...ids, entry.id])} /><span className="sr-only">选择{entry.title}</span></label> : null}
      {!selecting ? <button type="button" className="book-entry-drag" draggable={!busy} disabled={busy} aria-label={`拖动调整${entry.title}的位置`} title="拖动调整位置；聚焦后可按上下方向键微调"
        onDragStart={event => { event.dataTransfer.setData("text/plain", entry.id); event.dataTransfer.effectAllowed = "move"; setDraggingId(entry.id); }}
        onDragEnd={() => { setDraggingId(null); setDropTargetId(null); }}
        onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); const next = visibleEntries[index + (event.key === "ArrowUp" ? -1 : 1)]; if (next) moveEntry(entry.id, next.id); } }}><GripVertical size={16} /></button> : null}
      {entry.bangumiCoverPath || local?.coverPath ? <img className="book-entry-cover" src={entry.bangumiCoverPath ?? local?.coverPath ?? ""} alt={`${entry.title}的封面`} /> : null}
      <div className="book-entry-main">
        <strong title={entry.title}>{entry.title}</strong>
        <small>{entry.volumeNumber != null ? `第 ${entry.volumeNumber} 卷 · ` : localNumber != null ? `第 ${localNumber} 卷（内嵌） · ` : ""}{entry.chapterNumber != null ? `第 ${entry.chapterNumber} 话 · ` : ""}{entry.format === "images" ? `${entry.mediaFileIds.length} 页图片` : entry.format.toUpperCase()}{entry.missing ? " · 文件缺失" : ""}</small>
        {entry.bangumiId ? <small title={entry.bangumiTitle ?? undefined}>Bangumi 单册：{entry.bangumiTitle} · #{entry.bangumiId}</small> : null}
      </div>
      <div className="book-entry-actions">
        <button type="button" className={`book-read-toggle ${entry.readState}`} aria-label={`${entry.title}：${readLabels[entry.readState]}，标记为${entry.readState === "read" ? "未读" : "已读"}`} aria-pressed={entry.readState === "read"} title={`${readLabels[entry.readState]} · 点击标记为${entry.readState === "read" ? "未读" : "已读"}`} disabled={busy} onClick={() => void changeReadState(entry, entry.readState === "read" ? "unread" : "read")}>
          {entry.readState === "read" ? <CircleCheck size={18} /> : entry.readState === "reading" ? <BookOpenCheck size={18} /> : <Circle size={18} />}
        </button>
        <button type="button" className="button compact primary" disabled={busy || entry.missing} onClick={async () => {
          try { await bookApi.open(workId, entry.id); setError(""); }
          catch (reason) { setError(getErrorMessage(reason)); }
        }}><BookOpen size={14} />打开</button>
        <details className="action-menu book-entry-more">
          <summary aria-label={`${entry.title}的更多操作`} title="更多操作"><MoreHorizontal size={17} /></summary>
          <div className="menu-popover" onClick={event => { const details = event.currentTarget.parentElement; if (details instanceof HTMLDetailsElement) details.open = false; }}>
            <button type="button" disabled={busy} onClick={() => { setEditing(entry); setDraft({ title: entry.title, volumeNumber: entry.volumeNumber, chapterNumber: entry.chapterNumber, readState: entry.readState }); }}><Pencil size={15} />编辑卷册</button>
            <button type="button" disabled={busy} onClick={() => void searchVolume(entry.id)}><Sparkles size={15} />{entry.bangumiId ? "更换单册匹配" : "识别此卷"}</button>
            {entry.bangumiId ? <button type="button" disabled={busy} onClick={async () => { try { setBusy(true); await bookApi.clearVolume(workId, entry.id); setEntries(await bookApi.entries(workId)); setError(""); } catch (reason) { setError(getErrorMessage(reason)); } finally { setBusy(false); } }}><Unlink size={15} />清除单册匹配</button> : null}
            <button type="button" disabled={busy || entry.format === "images" || !["cbz", "zip", "epub"].includes(entry.format.toLowerCase())} onClick={async () => {
              try { setEmbedded({ id: entry.id, data: local ?? await bookApi.embedded(entry.id) }); setError(""); }
              catch (reason) { setError(getErrorMessage(reason)); }
            }}><FileText size={15} />本地资料</button>
          </div>
        </details>
      </div>
      {volumeSearch?.entryId === entry.id ? <div className="book-volume-search">
        <div className="book-match-search"><input aria-label={`${entry.title}的单册搜索词`} value={volumeSearch.query} onChange={(event) => setVolumeSearch({ ...volumeSearch, query: event.target.value })} onKeyDown={(event) => event.key === "Enter" && void searchVolume(entry.id, volumeSearch.query)} placeholder="按作品名和卷号搜索其他版本" /><button type="button" className="button compact secondary" disabled={volumeSearch.loading} onClick={() => void searchVolume(entry.id, volumeSearch.query)}><Search size={14} />搜索</button><button type="button" className="button compact secondary" onClick={() => { volumeSearchRequest.current++; setVolumeSearch(null); }}>收起</button></div>
        {volumeSearch.error ? <p role="alert" className="gnz-inline-error">{volumeSearch.error}</p> : null}
        {volumeSearch.loading ? <small>正在查找 Bangumi 单册…</small> : volumeSearch.candidates.length === 0 && !volumeSearch.error ? <small>没有找到单册候选，可换书名或卷号搜索。</small> : null}
        {volumeSearch.candidates.map((candidate) => {
          const mismatch = entry.volumeNumber != null && candidate.volumeNumber != null && Math.abs(entry.volumeNumber - candidate.volumeNumber) > 0.001;
          return <div className="book-candidate" key={candidate.externalId}>
            {candidate.coverUrl ? <img className="book-candidate-cover" src={candidate.coverUrl} alt="候选卷封面" /> : null}
            <div><strong>{candidate.title}</strong><small>{candidate.volumeNumber != null ? `第 ${candidate.volumeNumber} 卷` : "卷号待核对"} · {candidate.linkedToSeries ? "系列关联单行本" : "搜索结果"}{candidate.stale ? " · 离线缓存" : ""}{mismatch ? " · 与本地卷号不符" : ""}</small></div>
            <button type="button" className="button compact secondary" disabled={busy || mismatch} onClick={() => void confirmVolume(entry, candidate)}>核对并关联</button>
          </div>;
        })}
      </div> : null}
      {embedded?.id === entry.id ? <div className="book-embedded">
        {embedded.data.coverPath ? <img src={embedded.data.coverPath} alt="本地封面" /> : null}
        <div><strong>{embedded.data.series ?? embedded.data.title ?? "无内嵌标题"}</strong><p>{[embedded.data.creator, embedded.data.number ? `编号 ${embedded.data.number}` : null, embedded.data.isbn ? `ISBN ${embedded.data.isbn}` : null].filter(Boolean).join(" · ") || "无作者与编号资料"}</p>{embedded.data.description ? <p>{embedded.data.description}</p> : null}
          <button type="button" className="button compact secondary" onClick={() => {
            const number = embedded.data.number?.trim();
            setEditing(entry);
            setDraft({ title: embedded.data.title ?? entry.title, volumeNumber: number && /^\d+(?:\.\d+)?$/.test(number) ? Number(number) : entry.volumeNumber, chapterNumber: entry.chapterNumber, readState: entry.readState });
          }}>用作卷册信息并核对</button>
        </div>
      </div> : null}
    </article>; })}</div> : <p className="quiet-inline">这部作品还没有关联书籍文件。</p>}
    <div className="book-match">
      <div className="book-detail-toolbar"><strong>Bangumi 书籍资料</strong><button type="button" className="button compact secondary" disabled={busy} onClick={async () => { try { setBusy(true); await bookApi.refresh(workId); onMetadataChanged(); setMatchError(""); } catch (reason) { setMatchError(getErrorMessage(reason)); } finally { setBusy(false); } }}>刷新已匹配资料</button></div>
      <div className="book-match-search"><input aria-label="搜索书籍资料" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void search()} placeholder="搜索漫画或小说标题" /><button type="button" className="button compact secondary" disabled={searching} onClick={() => void search()}><Search size={14} />{searching ? "搜索中…" : "搜索候选"}</button></div>
      {matchError ? <p role="alert" className="gnz-inline-error">{matchError}</p> : null}
      {candidates.map((candidate) => <div className="book-candidate" key={candidate.externalId}>
        {candidate.coverUrl ? <img className="book-candidate-cover" src={candidate.coverUrl} alt="候选封面" /> : null}
        <div><strong>{candidate.title}</strong><small>{candidate.category === "comic" ? "漫画" : candidate.category === "novel" ? "小说" : "书籍类型待核对"} · {candidate.series === true ? "系列" : candidate.series === false ? "单册" : "系列状态待核对"}{candidate.stale ? " · 离线缓存" : ""}</small>{candidate.summary ? <p>{candidate.summary}</p> : null}</div>
        <button type="button" className="button compact secondary" disabled={busy} onClick={() => void confirm(candidate)}>核对并关联</button>
      </div>)}
    </div>
    {editing ? <Modal title="编辑书籍卷册" onClose={() => setEditing(null)} width="small">
      <div className="book-edit-form">
        <label>显示标题<input value={draft.title ?? ""} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>卷号<input type="number" min="0" step="0.5" value={draft.volumeNumber ?? ""} onChange={(event) => setDraft({ ...draft, volumeNumber: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <label>话数<input type="number" min="0" step="0.5" value={draft.chapterNumber ?? ""} onChange={(event) => setDraft({ ...draft, chapterNumber: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <button type="button" className="button primary" disabled={busy} onClick={() => void saveEdit()}>{busy ? "保存中…" : "保存卷册"}</button>
      </div>
    </Modal> : null}
    {deleteOpen ? <ConfirmDialog title={`移出所选 ${selectedEntryIds.length} 卷？`} description="所选卷册会从这部书架作品中移出，并回到书架待整理。磁盘上的原始书籍文件不会被删除、移动或修改；已有阅读状态和单册匹配会随扫描记录保留。" confirmLabel="确认移出" busy={busy} onCancel={() => setDeleteOpen(false)} onConfirm={() => void removeSelected()} /> : null}
  </div>;
}
