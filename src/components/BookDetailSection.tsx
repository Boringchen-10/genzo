import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight, RefreshCw, Search } from "lucide-react";
import { bookApi } from "../api";
import type { BookCandidate, BookEntry, BookEntryInput, BookVolumeBatchPreview, BookVolumeBatchResult, BookVolumeCandidate, EmbeddedBookMetadata } from "../bookData";
import { Modal } from "./common";
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
  const [batchResult, setBatchResult] = useState<BookVolumeBatchResult | null>(null);
  const [batchError, setBatchError] = useState("");
  const entryIds = entries.map(entry => entry.id).join("|");

  const load = useCallback(async () => {
    if (!isTauri()) return;
    try { setEntries(await bookApi.entries(workId)); setError(""); }
    catch (reason) { setError(getErrorMessage(reason)); }
  }, [workId]);
  useEffect(() => { void load(); }, [load]);
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
      setEntries(await bookApi.saveEntry(workId, entry.id, { title: entry.title, volumeNumber: entry.volumeNumber, chapterNumber: entry.chapterNumber, readState }));
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

  const previewBatch = async () => {
    setBusy(true); setBatchError(""); setBatchResult(null);
    try { setBatchPreview(await bookApi.previewVolumeBatch(workId)); }
    catch (reason) { setBatchPreview(null); setBatchError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const confirmBatch = async () => {
    if (!batchPreview) return;
    setBusy(true); setBatchError("");
    try {
      const result = await bookApi.confirmVolumeBatch(workId, batchPreview);
      setEntries(await bookApi.entries(workId));
      setBatchResult(result);
      setBatchPreview(null);
    } catch (reason) { setBatchError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  if (!isTauri()) return <p className="quiet-inline">书籍卷册与刮削需要在 Genzo 桌面应用中使用。</p>;
  return <div className="book-detail" id="bookshelf-entries">
    <div className="book-detail-toolbar">
      <strong>书籍与阅读记录</strong>
      <div className="book-entry-actions"><button type="button" className="button compact secondary" disabled={busy || entries.length === 0} onClick={() => void previewBatch()}>批量识别卷册</button><button type="button" className="button compact secondary" onClick={() => void load()}><RefreshCw size={14} />刷新</button></div>
    </div>
    {error ? <p role="alert" className="gnz-inline-error">{error}</p> : null}
    {batchError ? <p role="alert" className="gnz-inline-error">{batchError}</p> : null}
    {batchResult ? <div role="status" className="quiet-inline">已匹配 {batchResult.matched} 卷；跳过 {batchResult.skipped.length} 卷，可按需逐卷核对。{batchResult.skipped.length ? <div className="book-volume-batch-list">{batchResult.skipped.map(item => <div key={item.entryId}><span>{item.entryTitle}</span><small>{item.reason}</small></div>)}</div> : null}</div> : null}
    {batchPreview ? <div className="book-volume-batch">
      <strong>批量匹配预览 · {batchPreview.proposals.length} 卷可关联，{batchPreview.skipped.length} 卷待核对</strong>
      <p>仅按本地唯一卷号对应已关联 Bangumi 系列中的唯一单行本；保存前会再次核实每卷的类型和编号。</p>
      <div className="book-volume-batch-list">{batchPreview.proposals.map(item => <div key={item.entryId}><span>{item.entryTitle} · 第 {item.volumeNumber} 卷</span><ChevronRight size={14} /><span>{item.candidate.title} · #{item.candidate.externalId}{item.candidate.stale ? " · 离线缓存" : ""}</span></div>)}{batchPreview.skipped.map(item => <div key={item.entryId}><span>{item.entryTitle}</span><small>{item.reason}</small></div>)}</div>
      <div className="book-entry-actions"><button type="button" className="button compact secondary" onClick={() => setBatchPreview(null)}>取消</button><button type="button" className="button compact primary" disabled={busy || batchPreview.proposals.length === 0} onClick={() => void confirmBatch()}>{busy ? "核实中…" : `确认匹配 ${batchPreview.proposals.length} 卷`}</button></div>
    </div> : null}
    {entries.length ? <div className="book-entry-list">{entries.map((entry) => {
      const local = volumeMetadata[entry.id];
      const localNumber = local?.number && /^\d+(?:\.\d+)?$/.test(local.number.trim()) ? Number(local.number) : null;
      return <article className="book-entry" key={entry.id}>
      {entry.bangumiCoverPath || local?.coverPath ? <img className="book-entry-cover" src={entry.bangumiCoverPath ?? local?.coverPath ?? ""} alt={`${entry.title}的封面`} /> : null}
      <div className="book-entry-main">
        <strong title={entry.title}>{entry.title}</strong>
        <small>{entry.volumeNumber != null ? `第 ${entry.volumeNumber} 卷 · ` : localNumber != null ? `第 ${localNumber} 卷（内嵌） · ` : ""}{entry.chapterNumber != null ? `第 ${entry.chapterNumber} 话 · ` : ""}{entry.format === "images" ? `${entry.mediaFileIds.length} 页图片` : entry.format.toUpperCase()}{entry.missing ? " · 文件缺失" : ""}</small>
        {entry.bangumiId ? <small title={entry.bangumiTitle ?? undefined}>Bangumi 单册：{entry.bangumiTitle} · #{entry.bangumiId}</small> : null}
      </div>
      <div className="book-entry-actions">
        <select aria-label={`${entry.title}的阅读状态`} value={entry.readState} disabled={busy} onChange={(event) => void changeReadState(entry, event.target.value as BookEntry["readState"])}>
          {Object.entries(readLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="button" className="button compact secondary" onClick={() => { setEditing(entry); setDraft({ title: entry.title, volumeNumber: entry.volumeNumber, chapterNumber: entry.chapterNumber, readState: entry.readState }); }}>编辑卷册</button>
        <button type="button" className="button compact secondary" disabled={busy} onClick={() => void searchVolume(entry.id)}>{entry.bangumiId ? "更换单册匹配" : "识别此卷"}</button>
        {entry.bangumiId ? <button type="button" className="button compact secondary" disabled={busy} onClick={async () => { try { setBusy(true); await bookApi.clearVolume(workId, entry.id); setEntries(await bookApi.entries(workId)); setError(""); } catch (reason) { setError(getErrorMessage(reason)); } finally { setBusy(false); } }}>清除单册匹配</button> : null}
        <button type="button" className="button compact secondary" disabled={busy || entry.format === "images" || !["cbz", "zip", "epub"].includes(entry.format.toLowerCase())} onClick={async () => {
          try { setEmbedded({ id: entry.id, data: local ?? await bookApi.embedded(entry.id) }); setError(""); }
          catch (reason) { setError(getErrorMessage(reason)); }
        }}>本地资料</button>
        <button type="button" className="button compact primary" disabled={busy || entry.missing} onClick={async () => {
          try { await bookApi.open(workId, entry.id); setError(""); }
          catch (reason) { setError(getErrorMessage(reason)); }
        }}><BookOpen size={14} />打开</button>
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
  </div>;
}
