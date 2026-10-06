import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import { correctionApi } from "../api";
import { correctionAdvice, type CorrectionInput, type CorrectionPreview } from "../recognitionPreferences";
import type { WorkDetail, WorkListItem } from "../types";

export default function CorrectionEditor({ work, works, onSaved, onBusyChange }: { work: WorkDetail; works: WorkListItem[]; onSaved: (workId: string) => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const files = work.mediaFiles.filter(file => file.mediaType === "video");
  const availableIds = files.filter(file => !file.missing).map(file => file.id);
  const [input, setInput] = useState<CorrectionInput>({ sourceWorkId: work.id, targetWorkId: work.id, mediaFileIds: availableIds.length <= 500 ? availableIds : [], mode: "parsed", startEpisode: 1, season: null, episodeType: 0 });
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  function change(patch: Partial<CorrectionInput>) { setInput(previous => ({ ...previous, ...patch })); setPreview(null); setChecked(false); setError(""); }
  async function inspect() {
    setBusy(true); setError(""); setPreview(null); setChecked(false);
    try { setPreview(await correctionApi.preview(input)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!preview || !checked) return;
    setBusy(true); setError("");
    try { await onSaved(await correctionApi.apply(input, preview.token)); }
    catch (reason) { setError(String(reason)); setPreview(null); setChecked(false); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    {error && <p className="gz-error" role="alert">{error}<br />{correctionAdvice(error).text}</p>}
    <fieldset disabled={busy} className="gz-form-fields">
      <label>目标作品<select value={input.targetWorkId} onChange={event => change({ targetWorkId: event.target.value })}>{works.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>分集方式<select value={input.mode} onChange={event => change({ mode: event.target.value as CorrectionInput["mode"] })}><option value="parsed">按文件名季集</option><option value="keep">保留集号</option><option value="sequence">连续编号</option><option value="unlink">取消分集关联</option></select></label>
      {input.mode === "sequence" && <label>起始集号<input type="number" min={1} max={99999} value={input.startEpisode} onChange={event => change({ startEpisode: Number(event.target.value) })} /></label>}
      {input.mode !== "unlink" && <label>目标季度<input type="number" min={0} max={999} value={input.season ?? ""} onChange={event => change({ season: event.target.value === "" ? null : Number(event.target.value) })} /></label>}
      <div className="gz-section-head"><strong>文件范围 · {input.mediaFileIds.length}/{files.length}</strong><button type="button" className="gz-link" disabled={!input.mediaFileIds.length && availableIds.length > 500} onClick={() => change({ mediaFileIds: input.mediaFileIds.length ? [] : availableIds })}>{input.mediaFileIds.length ? "清空选择" : "选择可用文件"}</button></div>
      {files.length > 500 && <p className="gz-meta">单次最多 500 个文件</p>}
      {files.map(file => <label className="gz-file-choice" key={file.id}><input type="checkbox" checked={input.mediaFileIds.includes(file.id)} onChange={event => change({ mediaFileIds: event.target.checked ? [...input.mediaFileIds, file.id] : input.mediaFileIds.filter(id => id !== file.id) })} /><span className="gz-file-name">{file.fileName}{file.missing ? " · 文件缺失" : ""}</span></label>)}
      <button type="button" className="gz-btn" disabled={!input.mediaFileIds.length || input.mediaFileIds.length > 500} onClick={() => void inspect()}><Search size={16} />预览纠错</button>
      {preview && <section aria-label="分集纠错预览">
        <h3>{preview.title}</h3>
        {preview.warnings.map(warning => <p className="gz-error" key={warning}>{warning}</p>)}
        {preview.rows.map(row => <div className="gz-correction-row" key={row.id}><strong className="gz-file-name">{row.fileName}</strong><p className="gz-meta">{row.fromTitle || "待整理"} → {preview.title} · {row.episode == null ? "不关联分集" : `第 ${row.episode} 集`}</p><p className="gz-meta">{row.officialTitle || "暂无唯一官方分集"}</p>{row.issues?.map(issue => <p className="gz-meta" key={issue.code}>{issue.message}</p>)}</div>)}
        <label className="gz-file-choice"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />已核对文件范围、目标作品与集号</label>
      </section>}
      <button className="gz-btn primary" type="submit" disabled={!preview || !checked}><Check size={18} />保存纠错</button>
    </fieldset>
  </form>;
}
