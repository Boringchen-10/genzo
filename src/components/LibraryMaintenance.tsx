import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataProvider as api } from "../data";
import { folderRelocations, locationFolders, type IssueGroup, type Location, type RelocationPair, type RelocationPreview } from "../libraryMaintenance";
import type { LibraryRoot } from "../types";
import { getErrorMessage, formatSize as formatBytes } from "../utils";
import { Modal } from "./common";
import "./LibraryMaintenance.css";

const labels: Record<string, string> = { offline: "来源不可用", missing: "失效路径", duplicate: "疑似重复", unlinked: "未关联分集", mixed: "疑似跨季混放" };
export function LibraryMaintenance({ onChanged }: { onChanged: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"issues" | "relocate">("issues");
  const [issues, setIssues] = useState<IssueGroup[]>([]);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [kind, setKind] = useState("missing");
  const [oldRoot, setOldRoot] = useState(""); const [newRoot, setNewRoot] = useState("");
  const [oldFiles, setOldFiles] = useState<Location[]>([]); const [newFiles, setNewFiles] = useState<Location[]>([]);
  const [oldId, setOldId] = useState(""); const [newId, setNewId] = useState("");
  const [mode, setMode] = useState("file");
  const [oldFolder, setOldFolder] = useState(""); const [newFolder, setNewFolder] = useState("");
  const [search, setSearch] = useState("");
  const [pairs, setPairs] = useState<RelocationPair[]>([]);
  const [preview, setPreview] = useState<RelocationPreview | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false); const [filesBusy, setFilesBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const available = !!api.inspectLibrary && !!api.relocationFiles && !!api.previewRelocation && !!api.applyRelocation;
  const invalidate = () => { setPreview(null); setChecked([]); setAck(false); setError(""); setNotice(""); };
  const show = async () => {
    setOpen(true); setTab("issues"); setBusy(true); setFilesBusy(false); invalidate();
    try { const [report, sources] = await Promise.all([api.inspectLibrary!(), api.listRoots()]); setIssues(report); setRoots(sources); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!open || tab !== "relocate") return;
    let cancelled = false;
    setOldFiles([]); setNewFiles([]); setOldId(""); setNewId(""); setOldFolder(""); setNewFolder(""); setFilesBusy(true);
    Promise.all([oldRoot ? api.relocationFiles!(oldRoot) : Promise.resolve([]), newRoot ? api.relocationFiles!(newRoot) : Promise.resolve([])])
      .then(([a,b]) => { if (!cancelled) { setOldFiles(a); setNewFiles(b); } })
      .catch(e => { if (!cancelled) setError(getErrorMessage(e)); })
      .finally(() => { if (!cancelled) setFilesBusy(false); });
    return () => { cancelled = true; };
  }, [open, tab, oldRoot, newRoot]);
  const makePreview = async () => {
    invalidate(); setBusy(true);
    try {
      const grouped = folderRelocations(oldFiles, newFiles, oldFolder, newFolder);
      const selected = mode === "file" ? [{ oldId, newId }] : grouped.pairs.slice(0, 1000);
      const result = await api.previewRelocation!(selected);
      setPairs(selected); setPreview(result); setChecked([]);
      if (mode === "folder") setNotice([
        grouped.unmatched ? `${grouped.unmatched} 个旧文件没有唯一目标，本次保留；可用单文件模式逐个定位。` : "",
        grouped.pairs.length > 1000 ? `本批先处理前 1000 个，剩余 ${grouped.pairs.length - 1000} 个可在本批完成后继续预览。` : "",
      ].filter(Boolean).join(" "));
    } catch(e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!preview || !ack || !checked.length) return;
    setBusy(true); setError("");
    try {
      // Re-preview selected rows so the token covers exactly the confirmed scope.
      const selected = pairs.filter(pair => checked.includes(pair.oldId));
      const current = selected.length === pairs.length ? preview : await api.previewRelocation!(selected);
      if (selected.length !== pairs.length && JSON.stringify(current.rows) !== JSON.stringify(preview.rows.filter(row => checked.includes(row.pair.oldId)))) throw new Error("预览后文件已变化，请重新预览");
      const count = await api.applyRelocation!(selected, current.token);
      setPreview(null); setChecked([]); setAck(false); setOldFiles([]); setNewFiles([]); setOldId(""); setNewId("");
      setNotice(`已恢复 ${count} 个文件的位置，保留原分集关联和观看进度。`);
      onChanged(); setIssues(await api.inspectLibrary!());
      const [a,b] = await Promise.all([api.relocationFiles!(oldRoot), api.relocationFiles!(newRoot)]); setOldFiles(a); setNewFiles(b);
    } catch (e) { setError(getErrorMessage(e)); setPreview(null); setChecked([]); setAck(false); }
    finally { setBusy(false); }
  };
  const group = issues.find(item => item.kind === kind);
  const targetFiles = newFiles.filter(file => !file.workId && !file.missing && file.id !== oldId && (!search || file.path.toLowerCase().includes(search.toLowerCase())));
  const rootLabel = (root: LibraryRoot) => root.displayName || root.path;
  return <div className="library-maintenance-entry"><button className="button secondary compact" disabled={!available} title={available ? "检查索引异常并恢复移动后的文件位置" : "桌面版提供媒体库维护"} onClick={() => void show()}>媒体库检查 / 路径恢复</button>
    {open ? <Modal title="媒体库检查与路径恢复" width="large" onClose={() => { if (!busy) setOpen(false); }} footer={tab === "relocate" && preview ? <div className="maintenance-confirm"><label><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} />我确认勾选的新旧路径对应同一文件，原位置已不再使用</label><button className="button primary" disabled={busy || !ack || !checked.length} onClick={() => void apply()}>确认恢复 {checked.length} 个文件</button></div> : undefined}>
      <div className="recognition-selection-tools"><button className="button secondary compact" disabled={busy} onClick={() => { setTab("issues"); invalidate(); }}>异常检查</button><button className="button secondary compact" disabled={busy} onClick={() => { setTab("relocate"); invalidate(); }}>路径恢复</button></div>
      <p className="quiet-inline">依据最近扫描的索引检查；不会移动、改名或删除真实媒体。来源不可用不等于文件已删除。</p>
      {busy || filesBusy ? <p role="status">正在处理…</p> : null}{error ? <p role="alert" className="warning-text">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
      {tab === "issues" ? <>
        <div className="maintenance-issue-tabs">{issues.map(item => <button className={`button ${kind === item.kind ? "primary" : "secondary"} compact`} disabled={busy} key={item.kind} onClick={() => setKind(item.kind)}>{labels[item.kind]} {item.total}</button>)}</div>
        <p className="quiet-inline">疑似重复只依据文件名、大小和类型，不能据此删除；跨季提示只依据明确的季数标记。每类最多显示 200 项。</p>
        {!busy && group && !group.total ? <p>此类暂无异常记录。</p> : null}
        {group?.items.map(item => <article key={item.id} className="maintenance-row"><div><strong>{item.title}</strong><small>{item.path}</small></div><div className="maintenance-row-actions">{item.workId ? <button className="button secondary compact" disabled={busy} onClick={() => { setOpen(false); navigate(`/library/${item.workId}`); }}>查看作品</button> : null}{item.kind === "offline" && item.rootId ? <button className="button secondary compact" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const scan = await api.scanRoot(item.rootId!); setIssues(await api.inspectLibrary!()); onChanged(); setNotice(scan.errors.length ? scan.errors.join("；") : "重新扫描完成"); } catch(e) { setError(getErrorMessage(e)); } finally { setBusy(false); } }}>扫描 / 重连</button> : item.kind === "missing" ? <button className="button secondary compact" disabled={busy} onClick={() => { setTab("relocate"); setOldRoot(item.rootId ?? ""); invalidate(); }}>恢复位置</button> : null}</div></article>)}
      </> : <>
        <p className="quiet-inline">先在媒体源添加并成功扫描新位置。目标应保持未归档；已有整理、进度、候选或远程缓存时不覆盖。大小相同不代表内容相同，请核对预览。</p>
        <div className="maintenance-inputs"><label>旧媒体源<select aria-label="旧媒体源" value={oldRoot} disabled={busy} onChange={e => { setOldRoot(e.target.value); invalidate(); }}><option value="">请选择</option>{roots.map(root => <option key={root.id} value={root.id}>{rootLabel(root)}</option>)}</select></label><label>新媒体源<select aria-label="新媒体源" value={newRoot} disabled={busy} onChange={e => { setNewRoot(e.target.value); invalidate(); }}><option value="">请选择</option>{roots.map(root => <option key={root.id} value={root.id}>{rootLabel(root)}</option>)}</select></label></div>
        <label>定位方式<select aria-label="定位方式" value={mode} disabled={busy} onChange={e => { setMode(e.target.value); invalidate(); }}><option value="file">单文件定位</option><option value="folder">文件夹批量定位</option></select></label>
        {mode === "file" ? <><label>旧文件<select aria-label="旧文件" value={oldId} disabled={busy || filesBusy} onChange={e => { setOldId(e.target.value); setNewId(""); invalidate(); }}><option value="">请选择</option>{oldFiles.map(file => <option key={file.id} value={file.id}>{file.path}</option>)}</select></label><label>查找新位置<input aria-label="查找新位置" value={search} disabled={busy} placeholder="搜索文件名或目录" onChange={e => { setSearch(e.target.value); setNewId(""); invalidate(); }} /></label><label>新文件<select aria-label="新文件" value={newId} disabled={busy || filesBusy} onChange={e => { setNewId(e.target.value); invalidate(); }}><option value="">请选择（只显示未归档文件）</option>{targetFiles.map(file => <option key={file.id} value={file.id}>{file.path} · {formatBytes(file.size)}</option>)}</select></label></> : <div className="maintenance-inputs"><label>旧文件夹<select aria-label="旧文件夹" value={oldFolder} disabled={busy || filesBusy} onChange={e => { setOldFolder(e.target.value); invalidate(); }}>{locationFolders(oldFiles).map(folder => <option key={folder} value={folder}>{folder || "整个来源"}</option>)}</select></label><label>新文件夹<select aria-label="新文件夹" value={newFolder} disabled={busy || filesBusy} onChange={e => { setNewFolder(e.target.value); invalidate(); }}>{locationFolders(newFiles).map(folder => <option key={folder} value={folder}>{folder || "整个来源"}</option>)}</select></label></div>}
        <button className="button secondary" disabled={busy || filesBusy || !oldRoot || !newRoot || (mode === "file" && (!oldId || !newId))} onClick={() => void makePreview()}>预览路径恢复</button>
        {preview ? <><p>找到 {preview.rows.length} 个对应文件；请勾选需要恢复的项目。每批最多 1000 个。</p><button className="button secondary compact" disabled={busy} onClick={() => setChecked(checked.length === preview.rows.length ? [] : preview.rows.map(row => row.pair.oldId))}>{checked.length === preview.rows.length ? "取消全选" : "全选预览项目"}</button>{preview.rows.map(row => <label className="maintenance-row" key={row.pair.oldId}><input type="checkbox" disabled={busy} checked={checked.includes(row.pair.oldId)} onChange={e => setChecked(previous => e.target.checked ? [...previous, row.pair.oldId] : previous.filter(id => id !== row.pair.oldId))} /><div><strong>{row.title} · {formatBytes(row.size)}</strong><small>旧：{row.oldPath}</small><small>新：{row.newPath}</small></div></label>)}</> : null}
      </>}
    </Modal> : null}
  </div>;
}
