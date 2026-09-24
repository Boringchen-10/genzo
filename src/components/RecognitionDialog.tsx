import { AlertTriangle, Check, ChevronRight, Link2, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { dataProvider as api } from "../data";
import type { MatchCandidate, MediaFile, RecognitionGroupInfo, RecognitionGroupScope } from "../types";
import { getErrorMessage } from "../utils";
import { EmptyState, Modal } from "./common";

interface Props {
  media: MediaFile;
  /** 识别范围：整个作品文件夹（含所有季度）或单个季度/特别篇。 */
  scope?: RecognitionGroupScope;
  initialCandidates?: MatchCandidate[];
  /** 连续处理时的进度；null 表示只处理当前这一项。 */
  queue?: { index: number; total: number } | null;
  onClose: () => void;
  onMatched: (workId: string) => void;
  onChanged?: () => void;
  onManualCreate?: () => void;
  /** 连续处理：跳到下一项。 */
  onSkip?: () => void;
}

const seasonLabel = (file: MediaFile) => {
  if (file.parsedSpecialType) return file.parsedSpecialType;
  return file.parsedSeason ? `第 ${file.parsedSeason} 季` : "季度未知";
};

export function RecognitionDialog({ media, scope = "season", initialCandidates = [], queue = null, onClose, onMatched, onChanged, onManualCreate, onSkip }: Props) {
  const [query, setQuery] = useState(media.parsedTitle || media.fileName.replace(/\.[^.]+$/, ""));
  const [candidates, setCandidates] = useState(initialCandidates);
  const [busy, setBusy] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(!initialCandidates.length);
  const [group, setGroup] = useState<RecognitionGroupInfo | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [groupError, setGroupError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialCandidates.length) return;
    let cancelled = false;
    setLoadingCandidates(true);
    void api.listMatchCandidates(media.id)
      .then(value => { if (!cancelled) setCandidates(value); })
      .catch((loadError: unknown) => { if (!cancelled) setError(getErrorMessage(loadError)); })
      .finally(() => { if (!cancelled) setLoadingCandidates(false); });
    return () => { cancelled = true; };
  }, [initialCandidates.length, media.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingGroup(true);
    setGroupError("");
    void api.listRecognitionGroupMembers(media.id, scope)
      .then((info) => {
        if (cancelled) return;
        setGroup(info);
        setSelectedIds(info.members.filter(file => !file.workId || file.workId === media.workId).map(file => file.id));
        if (!info.members.length) setGroupError("识别组已变化，请关闭后重新打开。");
      })
      .catch((loadError: unknown) => { if (!cancelled) setGroupError(getErrorMessage(loadError)); })
      .finally(() => { if (!cancelled) setLoadingGroup(false); });
    return () => { cancelled = true; };
  }, [media.id, media.workId, scope]);

  const members = group?.members ?? [];
  const selectable = useMemo(
    () => members.filter(file => !file.workId || file.workId === media.workId),
    [members, media.workId],
  );
  const linkedMembers = useMemo(() => members.filter(file => file.workId && file.workId !== media.workId), [members, media.workId]);
  const seasons = useMemo(() => new Set(selectable.map(file => file.parsedSpecialType ?? `season:${file.parsedSeason ?? 0}`)), [selectable]);
  /* 整部作品文件夹会跨季度：自动匹配无法判断该用哪一季的条目，必须人工确认。 */
  const multiSeason = scope === "folder" && seasons.size > 1;
  const mergeTarget = !media.workId && group?.linkedWorkId ? (group.linkedWorkTitle ?? "已识别作品") : null;
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;

  const search = async (manual: boolean) => {
    if (!manual && (!allSelected || multiSeason)) {
      setError(multiSeason
        ? "所选文件跨多个季度。请先手动搜索并确认候选，自动识别无法判断应该匹配哪一季。"
        : "已排除部分文件。请先手动搜索并确认候选，自动识别会处理整个识别组。");
      return;
    }
    setBusy(true); setError("");
    try {
      const result = await api.recognizeMedia(media.id, manual ? query : null);
      setCandidates(result.candidates);
      if (result.parsedTitle && !manual) setQuery(result.parsedTitle);
      if (result.status === "matched") {
        onChanged?.();
        if (onSkip) onSkip(); else onClose();
      } else if (result.error) setError(result.error);
      else if (!result.candidates.length) setError("未找到足够相似的候选，请换一个关键词或手动创建作品。");
      onChanged?.();
    } catch (searchError: unknown) { setError(getErrorMessage(searchError)); }
    finally { setBusy(false); }
  };

  const confirm = async (candidate: MatchCandidate) => {
    if (!selectedIds.includes(candidate.mediaFileId)) {
      setError("请勾选此候选对应的代表文件，再确认匹配。");
      return;
    }
    setBusy(true); setError(""); setConfirmingId(candidate.id);
    try { const workId = await api.confirmMatch(candidate.mediaFileId, candidate.id, selectedIds, scope); onMatched(workId); }
    catch (confirmError: unknown) { setError(getErrorMessage(confirmError)); }
    finally { setBusy(false); setConfirmingId(null); }
  };

  const cancel = async () => {
    setBusy(true);
    try { await api.cancelMatch(media.id); onChanged?.(); onClose(); }
    catch (cancelError: unknown) { setError(getErrorMessage(cancelError)); setBusy(false); }
  };

  return (
    <Modal title="识别动漫作品" width="large" onClose={onClose}>
      <div className="recognition-file"><strong>{media.fileName}</strong><small>{media.path}</small></div>
      <div className="recognition-members">
        <div className="recognition-members-head">
          <strong>{scope === "folder" ? "整个作品文件夹" : "当前季度/特别篇"} · 本次关联 {selectedIds.length} / {selectable.length} 个文件</strong>
          <small>{scope === "folder" ? "一个作品文件夹里的所有季度会显示在一起，请只勾选属于所选作品的文件。" : "请核对本次关联的文件；取消勾选的文件保留原有归属。"}</small>
        </div>
        {loadingGroup ? <span role="status">正在读取分组文件…</span> : null}
        {groupError ? <span className="warning-text" role="alert">{groupError}</span> : null}
        {mergeTarget ? <span className="recognition-merge"><Link2 size={13} />同目录已有《{mergeTarget}》；选择不同季度的条目时会分别归档。</span> : null}
        {media.workId ? <small className="quiet-inline">从未匹配文件重新识别时，已有官方分集或手动分集关联的文件会保留在原作品。</small> : null}
        {multiSeason && selectedIds.length > 1 ? <span className="warning-text"><AlertTriangle size={13} />所选文件跨多个季度，将一起关联到同一部作品。</span> : null}
        {members.length ? (
          <div className="recognition-member-list">
            {members.map((file) => {
              const selectableFile = !file.workId || file.workId === media.workId;
              return (
                <label key={file.id} className={`recognition-member ${selectableFile ? "" : "linked"}`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(file.id)}
                    disabled={busy || !selectableFile}
                    onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, file.id] : ids.filter((id) => id !== file.id))}
                  />
                  <span>
                    <strong>{file.fileName}{selectableFile ? null : <em className="recognition-linked-tag">已关联{file.workId === group?.linkedWorkId && group?.linkedWorkTitle ? `《${group.linkedWorkTitle}》` : ""}</em>}</strong>
                    <small title={file.path}>{file.path} · {seasonLabel(file)}{file.missing ? " · 文件缺失" : ""}</small>
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
        {linkedMembers.length && !mergeTarget ? <small className="quiet-inline">已识别过的文件作为参照列出，不会重复关联。</small> : null}
      </div>
      <div className="recognition-search">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 Bangumi 搜索关键词" /></div>
        <button type="button" className="button primary icon-text" disabled={busy || loadingCandidates || !query.trim()} onClick={() => void search(true)}><Search size={16} />搜索</button>
        <button type="button" className="button secondary icon-text" disabled={busy || loadingCandidates || loadingGroup || !!groupError || !allSelected || multiSeason} onClick={() => void search(false)}><RefreshCw size={16} className={busy ? "spin" : ""} />按文件名识别</button>
      </div>
      {error ? <div className="recognition-error"><AlertTriangle size={16} /><span>{error}</span></div> : null}
      {loadingCandidates ? <p role="status" className="quiet-inline">正在读取已保存的候选…</p> : null}
      {candidates.length ? (
        <div className="candidate-list">
          {candidates.map((candidate) => (
            <article className="candidate-row" key={candidate.id}>
              <div className="candidate-cover">{candidate.coverUrl ? <img src={candidate.coverUrl} alt="" /> : <span>无封面</span>}</div>
              <div className="candidate-copy">
                <div className="candidate-title"><strong>{candidate.title}</strong><span>{Math.round(candidate.confidence * 100)}%</span></div>
                <small>{candidate.originalTitle || "无原名"}</small>
                <div className="candidate-meta"><span>{candidate.year || "年份未知"}</span><span>{candidate.subjectType.toUpperCase()}</span>{candidate.season ? <span>第 {candidate.season} 季</span> : null}<span>Bangumi #{candidate.externalId}</span></div>
                <p>{candidate.matchReasons.join(" · ")}</p>
              </div>
              <button type="button" className="button primary compact icon-text" disabled={busy || loadingCandidates || loadingGroup || !!groupError || !selectedIds.includes(candidate.mediaFileId)} onClick={() => void confirm(candidate)}><Check size={15} />{confirmingId === candidate.id ? "正在保存…" : "确认匹配"}</button>
            </article>
          ))}
        </div>
      ) : !busy && !loadingCandidates && !error ? <EmptyState title="尚无候选" description="先按文件名识别，或输入更准确的作品标题搜索。" /> : null}
      <div className="recognition-footer">
        <span>{queue ? `连续处理 ${queue.index + 1} / ${queue.total}：确认或跳过后自动进入下一项。` : media.workId ? "确认前保留现有作品关联，本地文件不会移动。" : "季度与特别篇可以分别整理；取消候选后仍保留在待整理区。"}</span>
        <div>
          {onManualCreate ? <button type="button" className="button secondary" disabled={busy || loadingCandidates} onClick={onManualCreate}>手动整理</button> : null}
          {onSkip ? <button type="button" className="button secondary icon-text" disabled={busy} onClick={onSkip}><ChevronRight size={15} />跳过</button> : null}
          <button type="button" className="button secondary icon-text" disabled={busy || loadingCandidates} onClick={() => void cancel()}><X size={15} />取消候选</button>
        </div>
      </div>
    </Modal>
  );
}
