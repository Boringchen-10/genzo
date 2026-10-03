import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bookApi } from "../api";
import type { BookCandidate, BookImportFile, BookImportGroup, EmbeddedBookMetadata } from "../bookData";
import { getErrorMessage } from "../utils";
import "../book-import.css";

const groupKey = (group: BookImportGroup) => group.mediaType + ":" + (group.folderPath ?? group.mediaFileIds[0]);
const hasEmbeddedData = (file: BookImportFile) => ["cbz", "zip", "epub"].includes(file.extension.toLowerCase());

interface BookImportPanelProps {
  focusMediaFileId?: string | null;
  focusRequest?: number;
  variant?: "disclosure" | "pane";
  showGroupList?: boolean;
  selectedMediaFileIds?: string[];
  onSelectedMediaFileIdsChange?: (ids: string[]) => void;
  selectionTitle?: string;
}

export function BookImportPanel({ focusMediaFileId, focusRequest, variant = "disclosure", showGroupList = true, selectedMediaFileIds, onSelectedMediaFileIdsChange, selectionTitle }: BookImportPanelProps) {
  const navigate = useNavigate();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectionEpoch = useRef(0);
  const previewRequest = useRef(0);
  const searchRequest = useRef(0);
  const manualWasSelected = useRef(false);
  const lastManualTitle = useRef<string | undefined>(undefined);
  const [groups, setGroups] = useState<BookImportGroup[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupSearch, setGroupSearch] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"comic" | "novel">("comic");
  const [query, setQuery] = useState("");
  const [embedded, setEmbedded] = useState<{ id: string; data: EmbeddedBookMetadata } | null>(null);
  const [fileMetadata, setFileMetadata] = useState<Record<string, EmbeddedBookMetadata>>({});
  const requestedFiles = useRef(new Set<string>());
  const [inspecting, setInspecting] = useState(false);
  const [candidates, setCandidates] = useState<BookCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [matchError, setMatchError] = useState("");

  const manualMode = selectedMediaFileIds !== undefined;
  const manualFiles = useMemo(() => {
    if (!selectedMediaFileIds) return [];
    const ids = new Set(selectedMediaFileIds);
    return groups.flatMap(group => group.files.filter(file => ids.has(file.id)).map(file => ({ file, mediaType: group.mediaType })));
  }, [groups, selectedMediaFileIds]);
  const manualTypes = new Set(manualFiles.map(item => item.mediaType));
  const firstManualFile = manualFiles[0];
  const manualGroup: BookImportGroup | undefined = firstManualFile ? {
    title: selectionTitle || firstManualFile.file.fileName.replace(/\.[^.]+$/, ""),
    mediaType: firstManualFile.mediaType,
    folderPath: null,
    mediaFileIds: manualFiles.map(item => item.file.id),
    files: manualFiles.map(item => item.file),
  } : undefined;
  const selectedGroup = manualMode ? manualGroup : groups.find(group => groupKey(group) === selectedKey);
  const visibleGroups = useMemo(() => {
    const needle = groupSearch.trim().toLocaleLowerCase("zh-CN");
    return groups.filter(group => !needle || (group.title + " " + (group.folderPath ?? "")).toLocaleLowerCase("zh-CN").includes(needle));
  }, [groups, groupSearch]);
  const activeIds = manualMode ? new Set(selectedMediaFileIds) : selectedIds;
  const selectedFiles = selectedGroup?.files.filter(file => activeIds.has(file.id)) ?? [];
  const selectedFileKeys = selectedFiles.map(file => file.id).join("|");
  const updateSelectedIds = (next: Set<string>) => {
    if (manualMode) onSelectedMediaFileIdsChange?.([...next]);
    else setSelectedIds(next);
  };

  useEffect(() => {
    const pending = selectedFiles.filter(file => !file.missing && hasEmbeddedData(file) && !requestedFiles.current.has(file.id));
    pending.forEach(file => requestedFiles.current.add(file.id));
    let cancelled = false;
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length && !cancelled) {
        const file = pending[cursor++];
        if (!file) break;
        try {
          const data = await bookApi.embedded(file.id);
          if (!cancelled) setFileMetadata(previous => ({ ...previous, [file.id]: data }));
        } catch { /* 无内嵌资料时保留文件名与手动识别入口。 */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    return () => {
      cancelled = true;
      pending.forEach(file => { if (!fileMetadata[file.id]) requestedFiles.current.delete(file.id); });
    };
  }, [selectedFileKeys]);

  useEffect(() => {
    if (!manualMode) return;
    if (firstManualFile && (!manualWasSelected.current || (selectionTitle && selectionTitle !== lastManualTitle.current))) {
      const suggestedTitle = selectionTitle || firstManualFile.file.fileName.replace(/\.[^.]+$/, "");
      setTitle(suggestedTitle);
      setQuery(suggestedTitle);
      setKind(firstManualFile.mediaType);
      setCandidates([]);
      setSelectedCandidate(null);
    }
    if (!manualFiles.length && manualWasSelected.current) {
      setEmbedded(null);
      setCandidates([]);
      setSelectedCandidate(null);
    }
    manualWasSelected.current = manualFiles.length > 0;
    lastManualTitle.current = manualFiles.length ? selectionTitle : undefined;
  }, [manualMode, manualFiles.length, selectionTitle]);

  const readEmbedded = async (file: BookImportFile, epoch = selectionEpoch.current) => {
    const request = ++previewRequest.current;
    setEmbedded(null);
    setPreviewError("");
    setInspecting(true);
    try {
      const data = fileMetadata[file.id] ?? await bookApi.embedded(file.id);
      if (epoch === selectionEpoch.current && request === previewRequest.current) setEmbedded({ id: file.id, data });
    } catch (reason) {
      if (epoch === selectionEpoch.current && request === previewRequest.current) setPreviewError(getErrorMessage(reason));
    } finally {
      if (epoch === selectionEpoch.current && request === previewRequest.current) setInspecting(false);
    }
  };

  const selectGroup = (group: BookImportGroup) => {
    const epoch = ++selectionEpoch.current;
    ++previewRequest.current;
    ++searchRequest.current;
    setInspecting(false);
    setSearching(false);
    setSelectedKey(groupKey(group));
    const counts = new Map<string, number>();
    for (const file of group.files) if (file.volumeNumber != null) counts.set(String(file.volumeNumber), (counts.get(String(file.volumeNumber)) ?? 0) + 1);
    const numbered = group.files.some(file => file.volumeNumber != null);
    setSelectedIds(new Set(group.files.filter(file => !numbered || (file.volumeNumber != null && counts.get(String(file.volumeNumber)) === 1)).map(file => file.id)));
    setTitle(group.title);
    setKind(group.mediaType);
    setQuery(group.title);
    setEmbedded(null);
    setPreviewError("");
    setCandidates([]);
    setSelectedCandidate(null);
    setMatchError("");
    setError("");
    if (detailsRef.current) detailsRef.current.open = true;
    const preview = group.files.find(file => !file.missing && hasEmbeddedData(file));
    if (preview) void readEmbedded(preview, epoch);
  };

  const load = async () => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      const next = await bookApi.importGroups();
      ++selectionEpoch.current;
      ++previewRequest.current;
      ++searchRequest.current;
      setInspecting(false);
      setSearching(false);
      setGroups(next);
      setSelectedKey(null);
      setSelectedIds(new Set());
      setEmbedded(null);
      setCandidates([]);
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (manualMode || !focusMediaFileId) return;
    const group = groups.find(entry => entry.mediaFileIds.includes(focusMediaFileId));
    if (!group) return;
    selectGroup(group);
    detailsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusMediaFileId, focusRequest, groups, manualMode]);

  const search = async () => {
    const text = query.trim() || title.trim();
    if (!text) { setMatchError("请先填写要搜索的书名"); return; }
    const epoch = selectionEpoch.current;
    const request = ++searchRequest.current;
    setSearching(true);
    setMatchError("");
    setCandidates([]);
    setSelectedCandidate(null);
    try {
      const result = await bookApi.searchImport(kind, text);
      if (epoch === selectionEpoch.current && request === searchRequest.current) setCandidates(result);
    } catch (reason) {
      if (epoch === selectionEpoch.current && request === searchRequest.current) setMatchError(getErrorMessage(reason));
    } finally {
      if (epoch === selectionEpoch.current && request === searchRequest.current) setSearching(false);
    }
  };

  const create = async () => {
    if (!selectedGroup || !selectedFiles.length || selectedFiles.length > 1000 || manualTypes.size > 1) return;
    setLoading(true);
    setError("");
    try {
      const localCover = embedded && activeIds.has(embedded.id) && embedded.data.coverPath ? embedded.id : selectedFiles.find(file => fileMetadata[file.id]?.coverPath)?.id ?? null;
      const id = await bookApi.createWork(title, kind, selectedFiles.map(file => file.id), selectedCandidate, localCover);
      navigate("/bookshelf/" + encodeURIComponent(id));
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  };

  if (!isTauri()) return null;
  const body = <div className="book-import-body">
      <p>先核对文件与本地资料，再决定是否关联 Bangumi 书籍条目。只归档勾选的文件，不移动原文件。</p>
      {showGroupList && !manualMode ? <div className="book-import-toolbar"><input aria-label="搜索待读物组" value={groupSearch} onChange={event => setGroupSearch(event.target.value)} placeholder="筛选目录或书名" /><button type="button" className="button compact secondary" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : "刷新待整理"}</button></div> : null}
      {error ? <p className="gnz-inline-error" role="alert">{error}</p> : null}
      {groups.length ? <div className={showGroupList && !manualMode ? "book-import-grid" : "book-import-grid book-import-grid-single"}>
        {showGroupList && !manualMode ? <div className="book-import-list" role="list" aria-label="待整理读物组">{visibleGroups.map(group => <button type="button" key={groupKey(group)} className={selectedKey === groupKey(group) ? "active" : ""} onClick={() => selectGroup(group)}>
          <strong>{group.title}</strong><small>{group.mediaType === "comic" ? "漫画" : "小说"} · {group.files.length} 个文件{group.files.some(file => file.missing) ? " · 含缺失文件" : ""}</small>
        </button>)}{!visibleGroups.length ? <p className="quiet-inline">没有符合条件的读物组。</p> : null}</div> : null}
        {selectedGroup ? <div className="book-import-confirm">
          <strong>核对作品与文件</strong>
          <small className="book-import-path" title={manualMode ? undefined : selectedGroup.folderPath ?? selectedGroup.files[0]?.path}>{manualMode ? `已从目录选择 ${selectedFiles.length} 个文件` : selectedGroup.folderPath ?? selectedGroup.files[0]?.path}</small>
          <label>作品标题<input aria-label="新书架作品标题" value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>类型<select aria-label="新书架作品类型" value={kind} onChange={event => { ++searchRequest.current; setSearching(false); setKind(event.target.value as "comic" | "novel"); setCandidates([]); setSelectedCandidate(null); }}><option value="comic">漫画／画集</option><option value="novel">小说／轻小说</option></select></label>
          <div className="book-import-file-heading"><strong>归档文件 · {selectedFiles.length}/{selectedGroup.files.length}</strong><span>{!manualMode ? <button type="button" onClick={() => updateSelectedIds(new Set(selectedGroup.mediaFileIds))}>全选</button> : null}<button type="button" onClick={() => updateSelectedIds(new Set())}>清空</button></span></div>
          <div className="book-import-files">{selectedGroup.files.map(file => {
            const metadata = fileMetadata[file.id];
            return <label key={file.id} title={file.path}><input type="checkbox" checked={activeIds.has(file.id)} onChange={event => { const next = new Set(activeIds); if (event.target.checked) next.add(file.id); else next.delete(file.id); updateSelectedIds(next); }} />{metadata?.coverPath ? <img className="book-import-volume-cover" src={metadata.coverPath} alt={`${file.fileName}的内嵌封面`} /> : null}<span>{file.fileName}{file.volumeNumber != null ? <small>第 {file.volumeNumber} 卷（文件名）</small> : null}{metadata?.number ? <small>内嵌编号 {metadata.number}</small> : null}{file.missing ? " · 缺失" : ""}</span>{hasEmbeddedData(file) && !file.missing ? <button type="button" disabled={inspecting} onClick={() => void readEmbedded(file)}>本地资料</button> : null}</label>;
          })}</div>
          {inspecting ? <p className="quiet-inline">正在读取内嵌资料…</p> : null}
          {previewError ? <p className="gnz-inline-error" role="alert">{previewError}</p> : null}
          {embedded ? <div className="book-import-embedded">{embedded.data.coverPath ? <img src={embedded.data.coverPath} alt="本地书籍封面" /> : null}<div><strong>{embedded.data.series ?? embedded.data.title ?? "未找到内嵌标题"}</strong><small>{[embedded.data.creator, embedded.data.number ? "编号 " + embedded.data.number : null, embedded.data.isbn ? "ISBN " + embedded.data.isbn : null].filter(Boolean).join(" · ") || "未找到作者与编号"}</small>{embedded.data.description ? <p>{embedded.data.description}</p> : null}{embedded.data.series || embedded.data.title ? <button type="button" className="button compact secondary" onClick={() => { const value = embedded.data.series ?? embedded.data.title; if (value) { setTitle(value); setQuery(value); } }}>用作作品标题</button> : null}</div></div> : null}
          <div className="book-import-match"><strong>Bangumi 候选（可选）</strong><div className="book-import-search"><input aria-label="搜索待整理书籍资料" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void search(); }} placeholder="输入漫画或小说标题" /><button type="button" className="button compact secondary" disabled={searching} onClick={() => void search()}>{searching ? "搜索中…" : "搜索候选"}</button></div>
            {matchError ? <p className="gnz-inline-error" role="alert">{matchError}</p> : null}
            {candidates.length ? <div className="book-import-candidates"><label><input type="radio" name="book-import-candidate" checked={!selectedCandidate} onChange={() => setSelectedCandidate(null)} />暂不关联，手动建立作品</label>{candidates.map(candidate => <label key={candidate.externalId}><input type="radio" name="book-import-candidate" checked={selectedCandidate === candidate.externalId} onChange={() => setSelectedCandidate(candidate.externalId)} />{candidate.coverUrl ? <img src={candidate.coverUrl} alt="候选封面" /> : null}<span><strong>{candidate.title}</strong><small>{candidate.category === "comic" ? "漫画" : candidate.category === "novel" ? "小说" : "品类待核对"} · {candidate.series === true ? "系列" : candidate.series === false ? "单册" : "系列状态待核对"}{candidate.stale ? " · 离线缓存" : ""} · 匹配度 {Math.round(candidate.confidence * 100)}%</small>{candidate.originalTitle && candidate.originalTitle !== candidate.title ? <small>{candidate.originalTitle}</small> : null}{candidate.summary ? <small className="book-import-summary">{candidate.summary}</small> : null}</span></label>)}</div> : !searching && !matchError ? <p className="quiet-inline">可按标题搜索候选；资料不足时直接手动建立。</p> : null}
          </div>
          <p>{selectedFiles.length} 个文件将关联到作品。单册候选不能匹配多卷；确认时会重新核对候选与目录归属。{selectedCandidate ? "匹配成功后将采用 Bangumi 作品资料。" : ""}</p>
          {manualTypes.size > 1 ? <p className="gnz-inline-error" role="alert">漫画和小说不能归档到同一作品，请只勾选一种类型。</p> : null}
          {selectedFiles.length > 1000 ? <p className="gnz-inline-error" role="alert">一次最多归档 1000 个文件，请缩小勾选范围。</p> : null}
          <button type="button" className="button primary" disabled={loading || !title.trim() || selectedFiles.length < 1 || selectedFiles.length > 1000 || manualTypes.size > 1} onClick={() => void create()}>{loading ? "建立中…" : selectedCandidate ? "确认匹配并建立" : "手动建立作品"}</button>
        </div> : <p className="quiet-inline">{manualMode ? "勾选左侧文件，或使用目录末尾的识别按钮。" : "选择左侧读物组后核对文件与资料。"}</p>}
      </div> : <p className="quiet-inline">没有待整理的漫画或小说文件。</p>}
    </div>;
  if (variant === "pane") return <div className="book-import book-import-pane" id="book-import">{body}</div>;
  return <details ref={detailsRef} className="book-import" id="book-import">
    <summary>识别并整理书架文件{groups.length ? " · " + groups.length + " 组" : ""}</summary>
    {body}
  </details>;
}
