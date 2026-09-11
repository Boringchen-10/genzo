import { AlertTriangle, Check, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialCandidates.length || media.recognitionStatus !== "candidate_pending") return;
    void api.listMatchCandidates(media.id).then(setCandidates).catch((loadError: unknown) => setError(getErrorMessage(loadError)));
  }, [initialCandidates.length, media.id, media.recognitionStatus]);

  const search = async (manual: boolean) => {
    setBusy(true); setError("");
    try {
      const result = await api.recognizeMedia(media.id, manual ? query : null);
      setCandidates(result.candidates);
      if (result.status === "matched") {
        onChanged?.(); onClose();
      } else if (result.error) setError(result.error);
      else if (!result.candidates.length) setError("未找到足够相似的候选，请换一个关键词或手动创建作品。");
      onChanged?.();
    } catch (searchError: unknown) { setError(getErrorMessage(searchError)); }
    finally { setBusy(false); }
  };

  const confirm = async (candidate: MatchCandidate) => {
    setBusy(true); setError("");
    try { const workId = await api.confirmMatch(media.id, candidate.id); onMatched(workId); }
    catch (confirmError: unknown) { setError(getErrorMessage(confirmError)); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try { await api.cancelMatch(media.id); onChanged?.(); onClose(); }
    catch (cancelError: unknown) { setError(getErrorMessage(cancelError)); setBusy(false); }
  };

  return (
    <Modal title="识别动漫作品" width="large" onClose={onClose}>
      <div className="recognition-file"><strong>{media.fileName}</strong><small>{media.path}</small></div>
      <div className="recognition-search">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 Bangumi 搜索关键词" /></div>
        <button type="button" className="button primary icon-text" disabled={busy || !query.trim()} onClick={() => void search(true)}><Search size={16} />搜索</button>
        <button type="button" className="button secondary icon-text" disabled={busy} onClick={() => void search(false)}><RefreshCw size={16} className={busy ? "spin" : ""} />按文件名识别</button>
      </div>
      {error ? <div className="recognition-error"><AlertTriangle size={16} /><span>{error}</span></div> : null}
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
              <button type="button" className="button primary compact icon-text" disabled={busy} onClick={() => void confirm(candidate)}><Check size={15} />确认匹配</button>
            </article>
          ))}
        </div>
      ) : !busy && !error ? <EmptyState title="尚无候选" description="先按文件名识别，或输入更准确的作品标题搜索。" /> : null}
      <div className="recognition-footer"><span>确认前不会修改作品信息。取消后文件仍保留在待整理区。</span><div>{onManualCreate ? <button type="button" className="button secondary" disabled={busy} onClick={onManualCreate}>手动整理</button> : null}<button type="button" className="button secondary icon-text" disabled={busy} onClick={() => void cancel()}><X size={15} />取消候选</button></div></div>
    </Modal>
  );
}
