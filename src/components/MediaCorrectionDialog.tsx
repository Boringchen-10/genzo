import { useEffect, useMemo, useRef, useState } from "react";
import { dataProvider as api } from "../data";
import type { MediaFile, WorkListItem } from "../types";
import type { CorrectionInput, CorrectionPreview } from "../recognitionPreferences";
import { correctionAdvice, reliableCorrectionIds } from "../recognitionPreferences";
import { getErrorMessage } from "../utils";
import { fileSeason } from "../filmTvRecognition";
import { Modal } from "./common";
import "./MediaCorrectionDialog.css";

export function MediaCorrectionDialog({ files, sourceWorkId, initialTarget, initialSelected = [], initialMode = "keep", onClose, onSaved }: {
  files: MediaFile[]; sourceWorkId: string | null; initialTarget?: string; initialSelected?: string[];
  initialMode?: CorrectionInput["mode"];
  onClose: () => void; onSaved: (workId: string) => void;
}) {
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [selected, setSelected] = useState<string[]>(() => initialSelected.filter(id => files.some(f => f.id === id && f.mediaType === "video" && f.workId === sourceWorkId)));
  const [target, setTarget] = useState(initialTarget ?? sourceWorkId ?? "");
  const [mode, setMode] = useState<CorrectionInput["mode"]>(initialMode);
  const [start, setStart] = useState(1);
  const [season, setSeason] = useState("");
  const [episodeType, setEpisodeType] = useState(0);
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [assessment, setAssessment] = useState<CorrectionPreview | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("all");
  const selectionTouched = useRef(false);
  useEffect(() => {
    let active = true;
    void api.listWorks().then(value => { if (active) setWorks(value.filter(w => w.type === "video")); })
      .catch(e => { if (active) setError(getErrorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const videos = useMemo(() => files.filter(f => f.mediaType === "video" && f.workId === sourceWorkId), [files, sourceWorkId]);
  const diagnosed = new Map(assessment?.rows.map(row => [row.id, row]) ?? []);
  const seasons = [...new Set(videos.map(f => diagnosed.get(f.id)?.parsedSeason ?? fileSeason(f)).filter((value): value is number => value != null))].sort((a, b) => a - b);
  useEffect(() => {
    if (mode !== "parsed" || !target || !videos.length || !api.inspectMediaCorrection) { setAssessment(null); setDiagnosing(false); return; }
    let active = true;
    setDiagnosing(true); setAssessment(null); setPreview(null); setAcknowledged(false);
    // The backend reads one batch of index data. Never probe media files or fetch remote metadata here.
    void api.inspectMediaCorrection({ sourceWorkId, targetWorkId: target, mediaFileIds: videos.slice(0, 500).map(f => f.id), mode: "parsed", startEpisode: 1, season: season === "" ? null : Number(season), episodeType: 0 })
      .then(value => { if (active) { setAssessment(value); if (!selectionTouched.current) setSelected(reliableCorrectionIds(value.rows)); } })
      .catch(e => { if (active) setError(getErrorMessage(e)); })
      .finally(() => { if (active) setDiagnosing(false); });
    return () => { active = false; };
  }, [mode, target, season, sourceWorkId, videos, revision]);
  const input: CorrectionInput = { sourceWorkId, targetWorkId: target, mediaFileIds: selected, mode, startEpisode: mode === "sequence" ? start : 1, season: (mode === "sequence" || mode === "parsed") && season !== "" ? Number(season) : null, episodeType: mode === "sequence" ? episodeType : 0 };
  const invalidate = () => { setPreview(null); setAcknowledged(false); setError(""); };
  const retry = () => { invalidate(); setRevision(value => value + 1); };
  const refresh = async (artwork: boolean) => {
    invalidate(); setBusy(true);
    try {
      if (artwork && api.episodeArtwork) {
        const result = await api.episodeArtwork.refresh(target, true);
        if (result.warnings.length) setError(result.warnings.join("；"));
      } else if (api.refreshWorkMetadata) {
        const result = await api.refreshWorkMetadata(target);
        if (result.warnings.length) setError(result.warnings.join("；"));
      }
      setRevision(value => value + 1);
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const advice = error ? correctionAdvice(error) : null;
  const inspect = async () => {
    if (!api.previewMediaCorrection) { setError("当前运行环境不支持批量纠错。"); return; }
    setBusy(true); setError(""); setAcknowledged(false);
    try { setPreview(await api.previewMediaCorrection(input)); } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!preview || !acknowledged || !api.applyMediaCorrection) return;
    setBusy(true); setError("");
    try { onSaved(await api.applyMediaCorrection(input, preview.token)); }
    catch (e) { setError(getErrorMessage(e)); setPreview(null); setAcknowledged(false); }
    finally { setBusy(false); }
  };
  return <Modal title="批量纠正作品与分集" width="large" onClose={() => { if (!busy) onClose(); }} footer={<div className="form-actions">
    <button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button>
    <button type="button" className="button secondary" disabled={busy || diagnosing || loading || !target || !selected.length} onClick={() => void inspect()}>预览调整</button>
    <button type="button" className="button primary" disabled={busy || !preview || !acknowledged} onClick={() => void save()}>{busy ? "处理中…" : "确认保存"}</button>
  </div>}>
    <div className="media-correction">
      <p>只调整勾选的视频；原作品、未勾选文件与观看进度保留。可在识别记录中撤销，不改动真实文件。</p>
      <fieldset disabled={busy} className="correction-fields">
        <label>目标作品<select aria-label="纠错目标作品" value={target} onChange={e => { invalidate(); selectionTouched.current = false; setTarget(e.target.value); }}><option value="">请选择已加入媒体库的作品</option>{works.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
        <label>编号方式<select value={mode} onChange={e => { invalidate(); selectionTouched.current = false; setMode(e.target.value as CorrectionInput["mode"]); }}><option value="keep">保留集号，仅调整归属</option><option value="parsed">按文件名的季集标记关联</option><option value="sequence">按文件名自然排序重新编号</option><option value="unlink">清除分集关联，保留作品归属</option></select></label>
        {mode === "parsed" ? <label>目标季度（可选）<input type="number" min="0" max="999" value={season} onChange={e => { invalidate(); selectionTouched.current = false; setSeason(e.target.value); }} /><small>自动读取 S01E05、第二季等标记；混季请分批勾选。此处是主源季度，不是剧照季度。</small></label> : null}
        {mode === "sequence" ? <><label>起始集号<input type="number" min="0" max="9999" value={start} onChange={e => { invalidate(); setStart(Number(e.target.value)); }} /></label><label>季度（可选）<input type="number" min="0" max="999" value={season} onChange={e => { invalidate(); setSeason(e.target.value); }} /></label><label>分集类型<select value={episodeType} onChange={e => { invalidate(); setEpisodeType(Number(e.target.value)); }}><option value="0">正片</option><option value="1">特别篇 / OVA / OAD / SP</option><option value="2">OP / NCOP</option><option value="3">ED / NCED</option><option value="4">预告</option><option value="5">MAD</option><option value="6">其他</option></select></label></> : null}
      </fieldset>
      <div className="correction-selection-head"><strong>已勾选 {selected.length} / {videos.length} 个视频</strong><button type="button" className="button secondary compact" disabled={busy || diagnosing || videos.length > 500} onClick={() => { invalidate(); selectionTouched.current = true; const eligible = videos.filter(f => mode !== "parsed" || diagnosed.get(f.id)?.eligible !== false).map(f => f.id); setSelected(eligible.length && eligible.every(id => selected.includes(id)) ? [] : eligible); }}>全选 / 清空</button></div>
      {videos.length > 500 ? <p className="warning-text">本批只诊断前 500 个视频，其余需单独勾选、预览并分批处理；未诊断项目不会自动选中。</p> : null}
      {diagnosing ? <p role="status">正在读取分集索引并逐文件核对…</p> : null}
      {assessment ? <><div className="correction-selection-head"><span>可靠正片 {reliableCorrectionIds(assessment.rows).length} · 待核对 {assessment.rows.filter(r => !r.reliable).length}</span><button type="button" className="button secondary compact" disabled={busy || diagnosing} onClick={() => { invalidate(); selectionTouched.current = true; setSelected(reliableCorrectionIds(assessment.rows)); }}>仅勾选可靠正片</button><select aria-label="分集诊断筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部文件</option><option value="reliable">可靠正片</option><option value="review">待核对 / 异常</option></select></div><div className="correction-selection-head"><button type="button" className="button secondary compact" disabled={busy} onClick={retry}>重新诊断</button>{api.refreshWorkMetadata ? <button type="button" className="button secondary compact" disabled={busy} onClick={() => void refresh(false)}>刷新主源分集</button> : null}{api.episodeArtwork ? <button type="button" className="button secondary compact" disabled={busy} onClick={() => void refresh(true)}>更新剧照缓存</button> : null}</div>{assessment.warnings.map(w => <p key={w} className="warning-text">{w}</p>)}</> : null}
      {mode === "parsed" && seasons.length > 1 ? <div className="correction-selection-head">{seasons.map(value => <button type="button" key={value} className="button secondary compact" disabled={busy || diagnosing} onClick={() => { invalidate(); selectionTouched.current = !api.inspectMediaCorrection; setSeason(String(value)); setSelected(videos.filter(file => !file.missing && fileSeason(file) === value).slice(0, 500).map(file => file.id)); }}>仅选第 {value} 季</button>)}</div> : null}
      <div className="correction-files">{videos.filter(f => mode !== "parsed" || filter === "all" || (filter === "reliable" ? diagnosed.get(f.id)?.reliable === true : diagnosed.get(f.id)?.reliable !== true)).map(f => <label key={f.id}><input type="checkbox" checked={selected.includes(f.id)} disabled={busy || diagnosing || (mode === "parsed" && diagnosed.get(f.id)?.eligible === false) || (!selected.includes(f.id) && selected.length >= 500)} onChange={e => { invalidate(); selectionTouched.current = true; setSelected(previous => e.target.checked ? [...previous, f.id] : previous.filter(id => id !== f.id)); }} /><span title={f.path}>{f.fileName}{mode === "parsed" && diagnosed.has(f.id) ? <CorrectionMapping row={diagnosed.get(f.id)!} /> : <small>{f.missing ? "路径暂不可用 · " : ""}{mode === "parsed" ? "预览时重新读取季集标记" : f.parsedEpisode ? `解析集号 ${f.parsedEpisode}` : "集号未知"}</small>}</span></label>)}</div>
      {error ? <div role="alert" className="warning-text"><p>{error}</p><p>{advice?.text}</p><button type="button" className="button secondary compact" disabled={busy} onClick={() => { if (advice?.action === "sequence") { invalidate(); setMode("sequence"); } else if (advice?.action === "target") { document.querySelector<HTMLSelectElement>('[aria-label="纠错目标作品"]')?.focus(); } else retry(); }}>{advice?.action === "sequence" ? "切换人工编号" : advice?.action === "target" ? "核对目标作品" : "重新诊断"}</button></div> : null}
      {preview ? <section aria-label="批量纠错预览"><strong>将 {preview.rows.length} 个视频归入《{preview.title}》</strong>{preview.warnings.map(w => <p key={w} className="warning-text">{w}</p>)}<div className="correction-preview">{preview.rows.map(r => <div className="correction-preview-row" key={r.id}><span title={r.fileName}>{r.fileName}</span><small>{r.fromTitle ?? "待整理"} → {preview.title}</small><CorrectionMapping row={r} /></div>)}</div><label className="correction-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} />我已核对文件范围、目标作品与逐行集号</label></section> : null}
    </div>
  </Modal>;
}

function CorrectionMapping({ row: r }: { row: CorrectionPreview["rows"][number] }) {
  return <div className="correction-mapping"><small>文件解析：{r.parsedSeason != null ? `S${r.parsedSeason} · ` : ""}{r.parsedEpisode ?? "未知集号"}</small><small>主源 {r.primaryProvider ?? ""}：{r.season != null ? `第 ${r.season} 季 · ` : ""}{r.episode == null ? "不关联分集" : `第 ${r.episode} 集`} · {r.episodeType ? ["", "特别篇", "OP / NCOP", "ED / NCED", "预告", "MAD", "其他"][r.episodeType] + " · " : ""}{r.officialTitle ?? "暂无唯一官方分集"}</small><small>剧照：{r.artworkEpisode != null ? `TMDB 第 ${r.artworkSeason} 季 · 第 ${r.artworkEpisode} 集 · ` : ""}{r.artworkAvailable ? "缓存已核实" : "回退文件缩略图"}</small>{r.issues?.filter(i => i.code !== "still_missing").map(i => <small className="warning-text" key={i.code}>{i.message}{i.action === "choose_season" ? "；分季选择正确目标作品" : i.action === "sequence" ? "；单独勾选后切换人工编号" : i.action === "refresh" ? "；可刷新主源分集或人工确认" : i.action === "source" ? "；检查来源连接或恢复路径" : ""}</small>)}</div>;
}
