import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderOpen, Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import { dataProvider as api } from "../data";
import { remoteApi } from "../api";
import { RemoteStoragePanel } from "../components/RemoteStoragePanel";
import { ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, Modal } from "../components/common";
import { useToasts } from "../store";
import type { LibraryRoot, RootKind, ScanResult } from "../types";
import { formatDate, getErrorMessage, rootKindLabels } from "../utils";

export function ScanPage() {
  const toast = useToasts((state) => state.push);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [jobs, setJobs] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [rootKind, setRootKind] = useState<RootKind>("auto");
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LibraryRoot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rootData, jobData] = await Promise.all([api.listRoots(), api.listScanJobs()]);
      setRoots(rootData.filter(root => root.sourceType !== "webdav"));
      setJobs(jobData);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const latestByRoot = useMemo(() => {
    const map = new Map<string, ScanResult>();
    for (const job of jobs) if (!map.has(job.libraryRootId)) map.set(job.libraryRootId, job);
    return map;
  }, [jobs]);

  const chooseDirectory = async () => {
    const result = await open({ directory: true, multiple: false, title: "选择扫描目录" });
    if (typeof result === "string") {
      setSelectedPath(result);
      setShowAdd(true);
    }
  };

  const addRoot = async () => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      const root = await api.addRoot(selectedPath, rootKind);
      if (mounted) await remoteApi.sourceType(root.id, "mounted");
      setShowAdd(false);
      setSelectedPath("");
      toast("扫描目录已添加", "success");
      await load();
      await scan(root.id);
    } catch (addError: unknown) {
      toast(getErrorMessage(addError), "error");
    } finally {
      setSaving(false);
    }
  };

  const updateRoot = async (root: LibraryRoot, kind: RootKind, enabled: boolean) => {
    try {
      await api.updateRoot(root.id, kind, enabled);
      setRoots((current) => current.map((item) => item.id === root.id ? { ...item, kind, enabled } : item));
      toast(enabled ? "目录已启用" : "目录已停用", "success");
    } catch (updateError: unknown) {
      toast(getErrorMessage(updateError), "error");
    }
  };

  const scan = async (id: string) => {
    setScanningId(id);
    try {
      const result = await api.scanRoot(id);
      toast(result.errors.length ? `扫描完成，记录了 ${result.errors.length} 个错误` : "扫描完成", result.errors.length ? "info" : "success");
      await load();
    } catch (scanError: unknown) {
      toast(getErrorMessage(scanError), "error");
    } finally {
      setScanningId(null);
    }
  };

  const scanAll = async () => {
    for (const root of roots.filter((item) => item.enabled)) {
      await scan(root.id);
    }
  };

  const deleteRoot = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await api.deleteRoot(deleting.id);
      toast("目录配置已删除，本地文件未作修改", "success");
      setDeleting(null);
      await load();
    } catch (deleteError: unknown) {
      toast(getErrorMessage(deleteError), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scan-page scan-embedded">
      <div className="section-heading gnz-source-heading"><div><h2>本地与挂载目录</h2><span>添加本地文件夹，或 RaiDrive、rclone 等工具提供的挂载目录。</span></div><div className="page-actions"><button type="button" className="button secondary icon-text" disabled={scanningId !== null || !roots.some((root) => root.enabled)} onClick={() => void scanAll()}><ScanSearch size={17} />扫描全部目录</button><button type="button" className="button primary icon-text" onClick={() => void chooseDirectory()}><Plus size={17} />添加目录</button></div></div>
      {loading ? <LoadingState label="正在读取扫描目录" /> : null}
      {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
      {!loading && !error && roots.length === 0 ? (
        <EmptyState title="尚未添加扫描目录" description="选择包含动漫、漫画、小说或游戏的本地文件夹。" action={<button type="button" className="button primary icon-text" onClick={() => void chooseDirectory()}><FolderOpen size={17} />选择文件夹</button>} />
      ) : null}
      {!loading && !error && roots.length > 0 ? (
        <div className="root-list">
          {roots.map((root) => {
            const latest = latestByRoot.get(root.id);
            return (
              <section className={`root-row ${root.enabled ? "" : "disabled"}`} key={root.id}>
                <div className="root-main">
                  <FolderOpen size={21} />
                  <div><strong title={root.path}>{root.path}</strong><span>上次扫描：{formatDate(root.lastScannedAt)}{root.availability === "unavailable" ? " · 连接或扫描不完整，已保留索引" : ""}</span><label><input type="checkbox" checked={root.sourceType === "mounted"} disabled={scanningId !== null} onChange={e => { void remoteApi.sourceType(root.id, e.target.checked ? "mounted" : "local").then(load).catch(error => toast(getErrorMessage(error), "error")); }} /> 系统挂载目录（跳过内容读取）</label></div>
                </div>
                <select value={root.kind} aria-label="目录类型" onChange={(e) => void updateRoot(root, e.target.value as RootKind, root.enabled)}>
                  {(Object.keys(rootKindLabels) as RootKind[]).map((kind) => <option key={kind} value={kind}>{rootKindLabels[kind]}</option>)}
                </select>
                <label className="switch-field"><input type="checkbox" checked={root.enabled} onChange={(e) => void updateRoot(root, root.kind, e.target.checked)} /><span className="switch" /><span>{root.enabled ? "已启用" : "已停用"}</span></label>
                <div className="root-actions">
                  <button type="button" className="button secondary compact icon-text" disabled={!root.enabled || scanningId !== null} onClick={() => void scan(root.id)}><RefreshCw size={15} className={scanningId === root.id ? "spin" : ""} />{scanningId === root.id ? "扫描中" : "扫描"}</button>
                  <IconButton tooltip="删除目录配置" className="danger-ghost" onClick={() => setDeleting(root)}><Trash2 size={17} /></IconButton>
                </div>
                {latest ? (
                  <div className="root-result">
                    <span>发现 <b>{latest.discoveredCount}</b></span><span>新增 <b>{latest.addedCount}</b></span><span>更新 <b>{latest.updatedCount}</b></span><span className={latest.missingCount ? "warning-text" : ""}>缺失 <b>{latest.missingCount}</b></span>
                    {latest.errors.length ? <details><summary><AlertTriangle size={14} />{latest.errors.length} 个错误</summary><div className="error-log">{latest.errors.map((item, index) => <p key={`${latest.id}-${index}`}>{item}</p>)}</div></details> : <span className="available-text">无错误</span>}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}

      <RemoteStoragePanel />
      {jobs.length ? (
        <section className="content-section">
          <div className="section-heading"><div><h2>扫描记录</h2><span>保留最近 50 次扫描摘要</span></div></div>
          <div className="history-table">
            <div className="history-head"><span>完成时间</span><span>状态</span><span>发现</span><span>新增</span><span>更新</span><span>缺失</span></div>
            {jobs.slice(0, 10).map((job) => <div className="history-row" key={job.id}><span>{formatDate(job.finishedAt)}</span><span>{job.status === "completed" ? "完成" : job.status === "completed_with_errors" ? "完成，有错误" : job.status}</span><span>{job.discoveredCount}</span><span>{job.addedCount}</span><span>{job.updatedCount}</span><span>{job.missingCount}</span></div>)}
          </div>
        </section>
      ) : null}

      {showAdd ? <Modal title="添加媒体源" width="small" onClose={() => setShowAdd(false)}><div className="form-grid"><div className="field span-2"><span>本地或挂载目录</span><div className="readonly-path">{selectedPath}</div></div><label className="field span-2"><span>目录类型</span><select value={rootKind} onChange={(e) => setRootKind(e.target.value as RootKind)}>{(Object.keys(rootKindLabels) as RootKind[]).map((kind) => <option key={kind} value={kind}>{rootKindLabels[kind]}</option>)}</select></label><label className="field span-2"><span><input type="checkbox" checked={mounted} onChange={e => setMounted(e.target.checked)} /> 这是网盘或网络挂载目录（RaiDrive / rclone / NAS）</span></label><p className="field-hint span-2">自动识别和混合目录会记录无法分类的文件为“其他”；指定类型的目录只导入该类型。</p><div className="form-actions span-2"><button type="button" className="button secondary" onClick={() => setShowAdd(false)}>取消</button><button type="button" className="button primary" disabled={saving} onClick={() => void addRoot()}>{saving ? "正在添加…" : "添加并扫描"}</button></div></div></Modal> : null}
      {deleting ? <ConfirmDialog title="删除媒体源配置？" description="这只会删除 Genzo 中的目录配置。磁盘上的文件不会被删除、移动或修改；已经扫描到的文件记录也会保留。" busy={saving} onCancel={() => setDeleting(null)} onConfirm={() => void deleteRoot()} /> : null}
    </div>
  );
}
