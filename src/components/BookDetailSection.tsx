import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, RefreshCw, Search } from "lucide-react";
import { bookApi } from "../api";
import type { BookCandidate, BookEntry, BookEntryInput, EmbeddedBookMetadata } from "../bookData";
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
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<BookCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchError, setMatchError] = useState("");

  const load = useCallback(async () => {
    if (!isTauri()) return;
    try { setEntries(await bookApi.entries(workId)); setError(""); }
    catch (reason) { setError(getErrorMessage(reason)); }
  }, [workId]);
  useEffect(() => { void load(); }, [load]);

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

  if (!isTauri()) return <p className="quiet-inline">书籍卷册与刮削需要在 Genzo 桌面应用中使用。</p>;
  return <div className="book-detail" id="bookshelf-entries">
    <div className="book-detail-toolbar">
      <strong>书籍与阅读记录</strong>
      <button type="button" className="button compact secondary" onClick={() => void load()}><RefreshCw size={14} />刷新</button>
    </div>
    {error ? <p role="alert" className="gnz-inline-error">{error}</p> : null}
    {entries.length ? <div className="book-entry-list">{entries.map((entry) => <article className="book-entry" key={entry.id}>
      <div className="book-entry-main">
        <strong title={entry.title}>{entry.title}</strong>
        <small>{entry.volumeNumber != null ? `第 ${entry.volumeNumber} 卷 · ` : ""}{entry.chapterNumber != null ? `第 ${entry.chapterNumber} 话 · ` : ""}{entry.format === "images" ? `${entry.mediaFileIds.length} 页图片` : entry.format.toUpperCase()}{entry.missing ? " · 文件缺失" : ""}</small>
      </div>
      <div className="book-entry-actions">
        <select aria-label={`${entry.title}的阅读状态`} value={entry.readState} disabled={busy} onChange={(event) => void changeReadState(entry, event.target.value as BookEntry["readState"])}>
          {Object.entries(readLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="button" className="button compact secondary" onClick={() => { setEditing(entry); setDraft({ title: entry.title, volumeNumber: entry.volumeNumber, chapterNumber: entry.chapterNumber, readState: entry.readState }); }}>编辑卷册</button>
        <button type="button" className="button compact secondary" disabled={busy || entry.format === "images" || !["cbz", "zip", "epub"].includes(entry.format.toLowerCase())} onClick={async () => {
          try { setEmbedded({ id: entry.id, data: await bookApi.embedded(entry.id) }); setError(""); }
          catch (reason) { setError(getErrorMessage(reason)); }
        }}>本地资料</button>
        <button type="button" className="button compact primary" disabled={busy || entry.missing} onClick={async () => {
          try { await bookApi.open(workId, entry.id); setError(""); }
          catch (reason) { setError(getErrorMessage(reason)); }
        }}><BookOpen size={14} />打开</button>
      </div>
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
    </article>)}</div> : <p className="quiet-inline">这部作品还没有关联书籍文件。</p>}
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
