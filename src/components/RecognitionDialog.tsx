import { AlertTriangle, Check, ChevronRight, Link2, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { dataProvider as api } from "../data";
import type { MatchCandidate, MediaFile, RecognitionGroupInfo, RecognitionGroupScope } from "../types";
import { getErrorMessage } from "../utils";
import { EmptyState, Modal } from "./common";
import { MediaCorrectionDialog } from "./MediaCorrectionDialog";
import type { RecognitionPreference } from "../recognitionPreferences";
import { RecognitionFileSelection } from "./RecognitionFileSelection";
import { selectedVideo, selectionGroups } from "../recognitionSelection";
import { candidateKind, fileSeason, initialFilmSelection } from "../filmTvRecognition";
import type { RecognitionKind } from "../types";

interface Props {
  initialKind?: RecognitionKind;
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
  const season = fileSeason(file);
  return season != null ? `第 ${season} 季` : "季度未知";
};

export function RecognitionDialog({ media, scope = "season", initialCandidates = [], initialKind = "anime", queue = null, onClose, onMatched, onChanged, onManualCreate, onSkip }: Props) {
  const [kind, setKind] = useState<RecognitionKind>(initialCandidates.length ? candidateKind(initialCandidates[0]) : initialKind);
  const [season, setSeason] = useState(initialCandidates[0]?.season ?? fileSeason(media) ?? 1);
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
  const [preview, setPreview] = useState<MatchCandidate | null>(null);
  const [preferences, setPreferences] = useState<RecognitionPreference[]>([]);
  const [rememberedTarget, setRememberedTarget] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => {
    let active = true; setPreferences([]); setPreferenceError("");
    void api.recognitionPreferences?.(media.id, kind).then(value => { if (active) setPreferences(value); })
      .catch(e => { if (active) setPreferenceError(getErrorMessage(e)); });
    return () => { active = false; };
  }, [media.id, kind]);
  const forget = async (id: string) => {
    setBusy(true);
    try { await api.forgetRecognitionPreference?.(id); setPreferences(previous => previous.filter(p => p.id !== id)); }
    catch (e) { setPreferenceError(getErrorMessage(e)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (initialCandidates.length) return;
    let cancelled = false;
    setLoadingCandidates(true);
    void api.listMatchCandidates(media.id)
      .then(value => {
        if (cancelled) return;
        const visible = initialKind === "anime" ? value : value.filter(candidate => candidateKind(candidate) === initialKind);
        setCandidates(visible);
        if (visible.length) {
          setKind(candidateKind(visible[0]));
          setSeason(visible[0]?.season ?? fileSeason(media) ?? 1);
        }
      })
      .catch((loadError: unknown) => { if (!cancelled) setError(getErrorMessage(loadError)); })
      .finally(() => { if (!cancelled) setLoadingCandidates(false); });
    return () => { cancelled = true; };
  }, [initialCandidates.length, initialKind, media.id]);

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
  useEffect(() => {
    if (group) setSelectedIds(initialFilmSelection(group.members, media, kind, season));
    setPreview(null);
  }, [group, kind, season, media.id, media.workId]);
  const selectable = useMemo(
    () => members.filter(file => !file.workId || file.workId === media.workId),
    [members, media.workId],
  );
  const linkedMembers = useMemo(() => members.filter(file => file.workId && file.workId !== media.workId), [members, media.workId]);
  const seasons = useMemo(() => selectionGroups(selectable.filter(file => selectedIds.includes(file.id))), [selectable, selectedIds]);
  /* 只按实际勾选文件提示混季；查找候选不直接写入关联。 */
  const multiSeason = scope === "folder" && seasons.length > 1;
  const mergeTarget = !media.workId && group?.linkedWorkId ? (group.linkedWorkTitle ?? "已识别作品") : null;

  const representative = selectedVideo(selectable, selectedIds, media.id);

  const search = async (manual: boolean) => {
    if (!representative) { setError("请先勾选至少一个可用视频文件。"); return; }
    setPreview(null);
    setBusy(true); setError("");
    try {
      const result = await api.recognizeMedia(representative.id, manual ? query : representative.parsedTitle || representative.fileName.replace(/\.[^.]+$/, ""), kind, kind === "tv" ? season : undefined);
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
    <Modal title={kind === "anime" ? "识别动漫作品" : "识别影视作品"} width="large" onClose={() => { if (!busy) onClose(); }} footer={preview ? <div className="form-actions"><span>《{preview.title}》 · {selectedIds.length} 个文件</span><button type="button" className="button secondary" disabled={busy} onClick={() => setPreview(null)}>返回调整</button><button type="button" className="button primary" disabled={busy} onClick={() => void confirm(preview)}>{confirmingId ? "正在保存…" : "确认关联"}</button></div> : undefined}>
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
        {selectable.length ? <RecognitionFileSelection files={selectable} selected={selectedIds} disabled={busy} onChange={ids => { setPreview(null); setSelectedIds(ids); }} /> : null}
        {linkedMembers.length ? <details><summary>保留其他作品的 {linkedMembers.length} 个已关联文件</summary>{linkedMembers.map(file => <p className="quiet-inline" key={file.id}>{file.fileName} · {seasonLabel(file)}</p>)}</details> : null}
        {linkedMembers.length && !mergeTarget ? <small className="quiet-inline">已识别过的文件作为参照列出，不会重复关联。</small> : null}
      </div>
      {preferences.length ? <section className="recognition-preview" aria-label="已确认识别推荐">
        <strong>同来源、同标题与季度的历史确认</strong>
        <p>{preferences.length > 1 ? "存在多个确认结果，可能同目录混装不同季度，请核对所选文件。" : "这只是推荐，不会自动修改关联。"}</p>
        {preferences.map(p => <div className="form-actions" key={p.id}><span>{p.title}</span><button type="button" className="button secondary compact" disabled={busy || !selectedIds.length || !api.previewMediaCorrection} onClick={() => setRememberedTarget(p.workId)}>核对并关联</button><button type="button" className="button secondary compact" disabled={busy} onClick={() => void forget(p.id)}>忘记推荐</button></div>)}
      </section> : null}
      {preferenceError ? <p className="warning-text" role="alert">识别记忆读取失败：{preferenceError}</p> : null}
      {rememberedTarget ? <MediaCorrectionDialog files={selectable.filter(f => selectedIds.includes(f.id))} sourceWorkId={media.workId} initialTarget={rememberedTarget} initialSelected={selectedIds} onClose={() => setRememberedTarget(null)} onSaved={onMatched} /> : null}
      <div className="recognition-search">
        <select aria-label="识别类型" disabled={busy || loadingCandidates} value={kind} onChange={event => { setKind(event.target.value as RecognitionKind); setCandidates([]); setPreview(null); setError(""); }}>
          <option value="anime">动漫 · Bangumi</option><option value="movie">电影 · TMDB</option><option value="tv">电视剧 · TMDB</option>
        </select>
        {kind === "tv" ? <label className="recognition-season">第 <input aria-label="电视剧季度" type="number" min="0" max="999" value={season} disabled={busy} onChange={event => { setSeason(Math.max(0, Math.min(999, Number(event.target.value) || 0))); setCandidates([]); }} /> 季</label> : null}
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "anime" ? "输入 Bangumi 搜索关键词" : "输入电影或电视剧名称"} /></div>
        <button type="button" className="button primary icon-text" disabled={busy || loadingCandidates || loadingGroup || !representative || !query.trim()} onClick={() => void search(true)}><Search size={16} />搜索</button>
        <button type="button" className="button secondary icon-text" disabled={busy || loadingCandidates || loadingGroup || !!groupError || !representative} onClick={() => void search(false)}><RefreshCw size={16} className={busy ? "spin" : ""} />按文件名识别</button>
      </div>
      {kind !== "anime" ? <p className="quiet-inline">需要在设置中配置 TMDB API Read Access Token。{kind === "movie" ? "默认只选择当前视频，可勾选同一电影的其他版本与字幕。" : "请核对季度和勾选文件；0 表示特别篇。未标注季度的文件需要人工核对。"}</p> : null}
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
                <div className="candidate-meta"><span>{candidate.year || "年份未知"}</span><span>{candidate.subjectType.toUpperCase()}</span>{candidate.season != null ? <span>第 {candidate.season} 季</span> : null}<span>{candidate.provider === "tmdb" ? "TMDB" : "Bangumi"} #{candidate.externalId}</span></div>
                <p>{candidate.matchReasons.join(" · ")}</p>
              </div>
              <button type="button" className="button primary compact icon-text" disabled={busy || loadingCandidates || loadingGroup || !!groupError || !selectedIds.includes(candidate.mediaFileId)} onClick={() => setPreview(candidate)}><Check size={15} />预览关联</button>
            </article>
          ))}
        </div>
      ) : !busy && !loadingCandidates && !error ? <EmptyState title="尚无候选" description="先按文件名识别，或输入更准确的作品标题搜索。" /> : null}
      {preview ? <section className="recognition-preview" aria-label="关联预览">
        <strong>将 {selectedIds.length} 个文件关联到《{preview.title}》</strong>
        <p>{preview.provider === "tmdb" ? "TMDB" : "Bangumi"} #{preview.externalId}{preview.season != null ? ` · 第 ${preview.season} 季` : ""} · {selectable.length - selectedIds.length} 个未勾选文件保留原归属。请核对文件范围后确认。</p>
        <ul>{members.filter(file => selectedIds.includes(file.id)).map(file => <li key={file.id} title={file.path}>{file.fileName}</li>)}</ul>
      </section> : null}
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
