import { AlertTriangle, Check, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { dataProvider as api } from "../data";
import type { MatchCandidate, MediaFile } from "../types";
import { getErrorMessage } from "../utils";
import { EmptyState, Modal } from "./common";

interface Props {
  media: MediaFile;
  initialCandidates?: MatchCandidate[];
  onClose: () => void;
  onMatched: (workId: string) => void;
  onChanged?: () => void;
  onManualCreate?: () => void;
}

export function RecognitionDialog({ media, initialCandidates = [], onClose, onMatched, onChanged, onManualCreate }: Props) {
  const [query, setQuery] = useState(media.parsedTitle || media.fileName.replace(/\.[^.]+$/, ""));
  const [candidates, setCandidates] = useState(initialCandidates);
  const [busy, setBusy] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(!initialCandidates.length);
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

  const search = async (manual: boolean) => {
    setBusy(true); setError("");
    try {
      const result = await api.recognizeMedia(media.id, manual ? query : null);
      setCandidates(result.candidates);
      if (result.parsedTitle && !manual) setQuery(result.parsedTitle);
      if (result.status === "matched") {
        onChanged?.(); onClose();
      } else if (result.error) setError(result.error);
      else if (!result.candidates.length) setError("未找到足够相似的候选，请换一个关键词或手动创建作品。");
      onChanged?.();
    } catch (searchError: unknown) { setError(getErrorMessage(searchError)); }
    finally { setBusy(false); }
  };

  const confirm = async (candidate: MatchCandidate) => {
    setBusy(true); setError(""); setConfirmingId(candidate.id);
    try { const workId = await api.confirmMatch(candidate.mediaFileId, candidate.id); onMatched(workId); }
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
      {media.workId ? <p className="quiet-inline">同组的季度或特别篇文件将一起匹配。选择其他作品后，这组文件会移入对应详情页。</p> : null}
      <div className="recognition-search">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 Bangumi 搜索关键词" /></div>
        <button type="button" className="button primary icon-text" disabled={busy || loadingCandidates || !query.trim()} onClick={() => void search(true)}><Search size={16} />搜索</button>
        <button type="button" className="button secondary icon-text" disabled={busy || loadingCandidates} onClick={() => void search(false)}><RefreshCw size={16} className={busy ? "spin" : ""} />按文件名识别</button>
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
              <button type="button" className="button primary compact icon-text" disabled={busy || loadingCandidates} onClick={() => void confirm(candidate)}><Check size={15} />{confirmingId === candidate.id ? "正在保存…" : "确认匹配"}</button>
            </article>
          ))}
        </div>
      ) : !busy && !loadingCandidates && !error ? <EmptyState title="尚无候选" description="先按文件名识别，或输入更准确的作品标题搜索。" /> : null}
      <div className="recognition-footer"><span>{media.workId ? "确认前保留现有作品关联，本地文件不会移动。" : "季度与特别篇分别整理；取消候选后仍保留在待整理区。"}</span><div>{onManualCreate ? <button type="button" className="button secondary" disabled={busy || loadingCandidates} onClick={onManualCreate}>手动整理</button> : null}<button type="button" className="button secondary icon-text" disabled={busy || loadingCandidates} onClick={() => void cancel()}><X size={15} />取消候选</button></div></div>
    </Modal>
  );
}
