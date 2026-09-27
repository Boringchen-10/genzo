import { useEffect, useState } from "react";
import { dataProvider as api } from "../data";
import { candidateKind, initialFilmSelection } from "../filmTvRecognition";
import { selectionGroups } from "../recognitionSelection";
import type { RecognitionTarget } from "../recognitionSelection";
import type { MatchCandidate, MediaFile, RecognitionKind } from "../types";
import { getErrorMessage } from "../utils";
import { Modal } from "./common";
import { RecognitionFileSelection } from "./RecognitionFileSelection";

interface Item { target: RecognitionTarget; files: MediaFile[]; candidates: MatchCandidate[]; candidateId: string; ids: string[]; checked: boolean; done: boolean; error: string }

/** Reads candidates first. No file association changes before explicit confirmation. */
export function BatchRecognitionDialog({ targets, kind, onClose, onChanged }: {
  targets: RecognitionTarget[]; kind: RecognitionKind; onClose: () => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const target of targets) {
        if (cancelled) break;
        let item: Item = { target, files: [], candidates: [], candidateId: "", ids: [], checked: false, done: false, error: "" };
        try {
          const group = await api.listRecognitionGroupMembers(target.media.id, "season");
          item.files = group.members.filter(file => !file.workId || file.workId === target.media.workId);
          let candidates = await api.listMatchCandidates(target.media.id);
          candidates = candidates.filter(candidate => candidateKind(candidate) === kind);
          if (!candidates.length && !cancelled) {
            const result = await api.recognizeMedia(target.media.id, target.media.parsedTitle || target.label, kind, kind === "tv" ? target.media.parsedSeason ?? 1 : undefined);
            candidates = result.candidates.filter(candidate => candidateKind(candidate) === kind);
            item.error = result.error || "";
          }
          item.candidates = candidates;
          item.candidateId = candidates[0]?.id || "";
          item.ids = initialFilmSelection(item.files, target.media, kind, candidates[0]?.season ?? target.media.parsedSeason ?? 1);
          if (!candidates.length && !item.error) item.error = "没有可确认的候选，请单独搜索或手动整理。";
        } catch (e) { item.error = getErrorMessage(e); }
        if (!cancelled) { setItems(previous => [...previous, item]); setProgress(value => value + 1); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [targets, kind]);
  const update = (index: number, patch: Partial<Item>) => setItems(previous => previous.map((item, i) => i === index ? { ...item, ...patch } : item));
  const ready = (item: Item) => !item.done && !!item.candidateId && item.ids.includes(item.target.media.id);
  const selected = items.filter(item => item.checked && ready(item));
  const save = async () => {
    const ids = selected.flatMap(item => item.ids);
    if (new Set(ids).size !== ids.length) { setError("所选组包含重复文件，请调整文件范围后重试。"); return; }
    setBusy(true); setError("");
    let changed = false;
    for (const item of selected) {
      const index = items.indexOf(item);
      try {
        const candidate = item.candidates.find(value => value.id === item.candidateId)!;
        await api.confirmMatch(candidate.mediaFileId, candidate.id, item.ids, "season");
        changed = true;
        update(index, { done: true, checked: false, error: "" });
      } catch (e) { update(index, { error: getErrorMessage(e) }); }
    }
    setBusy(false);
    if (changed) onChanged();
  };
  return <Modal title="批量预览与确认" width="large" onClose={() => { if (!busy) onClose(); }} footer={<div className="form-actions">
    <span>{selected.length} 组 · {selected.reduce((sum, item) => sum + item.ids.length, 0)} 个文件</span>
    <button type="button" className="button secondary" disabled={busy} onClick={onClose}>{loading ? "停止查找并关闭" : "关闭"}</button>
    <button type="button" className="button primary" disabled={busy || loading || !selected.length} onClick={() => void save()}>{busy ? "正在逐组保存…" : "确认勾选的关联"}</button>
  </div>}>
    <p className="quiet-inline">按季度 / 特别篇组分别查找候选。先核对候选及文件范围，再勾选确认；不会移动真实文件。每组独立保存，失败项可以重试，已成功的不会重复提交。</p>
    {loading ? <p role="status">正在查找候选 {progress} / {targets.length}，尚未修改任何关联。</p> : null}
    {error ? <p role="alert" className="warning-text">{error}</p> : null}
    <div className="recognition-selection-tools"><button type="button" className="button secondary compact" disabled={loading || busy} onClick={() => setItems(previous => previous.map(item => ({ ...item, checked: ready(item) })))}>勾选全部可确认项</button><button type="button" className="button secondary compact" disabled={busy} onClick={() => setItems(previous => previous.map(item => ({ ...item, checked: false })))}>清空勾选</button></div>
    {items.map((item, index) => <article key={item.target.media.id} className="recognition-batch-row">
      <label className="recognition-batch-heading"><input type="checkbox" disabled={busy || loading || !ready(item)} checked={item.checked} onChange={event => update(index, { checked: event.target.checked })} /><strong>{item.target.label}</strong><span className="recognition-batch-status">{item.done ? "已关联" : `${item.ids.length} 个文件`}</span></label>
      {item.candidates.length ? <select aria-label={`${item.target.label}的候选`} value={item.candidateId} disabled={busy || item.done} onChange={event => {
        const candidate = item.candidates.find(value => value.id === event.target.value)!;
        update(index, { candidateId: candidate.id, ids: initialFilmSelection(item.files, item.target.media, kind, candidate.season ?? 1), checked: false });
      }}>{item.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.year ?? "年份未知"}{candidate.season != null ? ` · 第 ${candidate.season} 季` : ""} · {candidate.provider} #{candidate.externalId} · {Math.round(candidate.confidence * 100)}%</option>)}</select> : null}
      <p className="quiet-inline">{selectionGroups(item.files.filter(file => item.ids.includes(file.id))).map(group => `${group.label} ${group.files.length} 个`).join(" · ")}</p>
      {item.error ? <p className="warning-text" role="alert">{item.error}</p> : null}
      <details><summary>核对 / 调整文件范围（未勾选 {item.files.length - item.ids.length} 个）</summary><RecognitionFileSelection files={item.files} selected={item.ids} disabled={busy || item.done} onChange={ids => update(index, { ids, checked: false })} /></details>
    </article>)}
  </Modal>;
}
