import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Heart,
  MoreHorizontal,
  Pencil,
  Play,
  Star,
  Trash2,
  Unlink,
  Lock,
  Unlock,
  Sparkles,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, Modal } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { WorkForm } from "../components/WorkForm";
import { useToasts } from "../store";
import type { ExternalTool, MediaFile, WorkDetail, WorkInput } from "../types";
import { RecognitionDialog } from "../components/RecognitionDialog";
import { coverUrl, formatDate, formatSize, getErrorMessage, mediaLabels, statusLabels } from "../utils";

export function WorkDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToasts((state) => state.push);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [tools, setTools] = useState<ExternalTool[]>([]);
  const [unassigned, setUnassigned] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [attachSearch, setAttachSearch] = useState("");
  const [recognizingMedia, setRecognizingMedia] = useState<MediaFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [workData, toolData] = await Promise.all([api.getWork(id), api.listTools()]);
      setWork(workData);
      setTools(toolData);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const availableFiles = useMemo(() => {
    const search = attachSearch.trim().toLocaleLowerCase("zh-CN");
    return unassigned.filter((file) => !search || file.fileName.toLocaleLowerCase("zh-CN").includes(search) || file.path.toLocaleLowerCase("zh-CN").includes(search));
  }, [attachSearch, unassigned]);

  const openAttach = async () => {
    setAttachOpen(true);
    try {
      setUnassigned(await api.listUnassignedMedia());
    } catch (loadError: unknown) {
      toast(getErrorMessage(loadError), "error");
    }
  };

  const update = async (input: WorkInput) => {
    setSaving(true);
    try {
      setWork(await api.updateWork(id, input));
      setEditOpen(false);
      toast("作品信息已保存", "success");
    } catch (updateError: unknown) {
      toast(getErrorMessage(updateError), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.deleteWork(id);
      toast("作品记录已删除，本地文件未作修改", "success");
      navigate("/library");
    } catch (deleteError: unknown) {
      toast(getErrorMessage(deleteError), "error");
      setSaving(false);
    }
  };

  const attach = async (mediaFileId: string) => {
    setBusyFile(mediaFileId);
    try {
      await api.attachMedia(id, mediaFileId);
      toast("文件已关联", "success");
      setUnassigned((files) => files.filter((file) => file.id !== mediaFileId));
      await load();
    } catch (attachError: unknown) {
      toast(getErrorMessage(attachError), "error");
    } finally {
      setBusyFile(null);
    }
  };

  const detach = async (mediaFileId: string) => {
    setBusyFile(mediaFileId);
    try {
      await api.detachMedia(mediaFileId);
      toast("已解除关联，本地文件未作修改", "success");
      await load();
    } catch (detachError: unknown) {
      toast(getErrorMessage(detachError), "error");
    } finally {
      setBusyFile(null);
    }
  };

  const launch = async (file: MediaFile, toolId: string | null = null, useSystem = false) => {
    setBusyFile(file.id);
    try {
      await api.launchMedia(file.id, toolId, useSystem);
      toast(`已请求打开“${file.fileName}”`, "success");
    } catch (launchError: unknown) {
      toast(getErrorMessage(launchError), "error");
    } finally {
      setBusyFile(null);
    }
  };

  const reveal = async (file: MediaFile) => {
    try {
      await api.openMediaDirectory(file.id);
    } catch (revealError: unknown) {
      toast(getErrorMessage(revealError), "error");
    }
  };

  if (loading) return <div className="page"><LoadingState label="正在读取作品详情" /></div>;
  if (error || !work) return <div className="page"><ErrorState message={error || "作品不存在"} retry={() => void load()} /></div>;
  const firstAvailable = work.mediaFiles.find((file) => !file.missing);
  const toggleLock = async (field: string) => {
    const locked = !work.fieldLocks.includes(field);
    try { await api.setFieldLock(work.id, field, locked); setWork({ ...work, fieldLocks: locked ? [...work.fieldLocks, field] : work.fieldLocks.filter((item) => item !== field) }); toast(locked ? "字段已锁定，刷新元数据时不会覆盖" : "字段已解锁", "success"); }
    catch (lockError: unknown) { toast(getErrorMessage(lockError), "error"); }
  };

  return (
    <div className={`page detail-page ${work.coverPath ? "has-detail-artwork" : ""}`} style={work.coverPath ? { "--detail-artwork": `url("${coverUrl(work.coverPath)}")` } as CSSProperties : undefined}>
      <div className="detail-topbar">
        <Link className="back-link" to="/library"><ArrowLeft size={17} />媒体库</Link>
        <div className="page-actions">
          <button type="button" className="button secondary icon-text" onClick={() => setEditOpen(true)}><Pencil size={16} />编辑</button>
          <IconButton tooltip="删除作品记录" className="danger-ghost" onClick={() => setDeleteOpen(true)}><Trash2 size={17} /></IconButton>
        </div>
      </div>

      <section className="detail-hero">
        <div className="detail-cover"><MediaVisual type={work.type} coverPath={work.coverPath} alt={`${work.title} 封面`} /></div>
        <div className="detail-copy">
          <div className="detail-kicker"><span>{mediaLabels[work.type]}</span><span>{statusLabels[work.status]}</span>{work.favorite ? <span className="favorite-label"><Heart size={13} fill="currentColor" />已收藏</span> : null}<span className={`metadata-status metadata-${work.metadataStatus}`}>{work.metadataStatus === "matched" ? "已识别" : work.metadataStatus === "candidate_pending" ? "待确认" : work.metadataStatus === "error" ? "识别失败" : "未识别"}</span></div>
          <h1>{work.title}</h1>
          {work.originalTitle ? <p className="original-title">{work.originalTitle}</p> : null}
          <div className="detail-facts">
            {work.rating !== null ? <span><Star size={15} fill="currentColor" />{work.rating.toFixed(1)} / 10</span> : <span>尚未评分</span>}
            <span>{work.mediaFiles.length} 个本地文件</span>
            <span>更新于 {formatDate(work.updatedAt)}</span>
          </div>
          {work.tags.length ? <div className="tag-row">{work.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
          <p className="detail-description">{work.description || "暂无简介。"}</p>
          <div className="detail-actions">
            <button type="button" className="button primary icon-text" disabled={!firstAvailable || busyFile !== null} onClick={() => firstAvailable && void launch(firstAvailable)}>
              <Play size={17} fill="currentColor" />{work.type === "game" ? "启动" : "打开"}
            </button>
            <button type="button" className="button secondary icon-text" onClick={() => void openAttach()}><FilePlus2 size={17} />关联文件</button>
            {firstAvailable?.mediaType === "video" ? <button type="button" className="button secondary icon-text" onClick={() => setRecognizingMedia(firstAvailable)}><Sparkles size={16} />识别作品</button> : null}
          </div>
        </div>
      </section>

      <section className="detail-section metadata-section">
        <div className="section-heading"><div><h2>元数据匹配</h2><span>来自 Bangumi 官方 API；用户锁定的字段不会被刷新覆盖</span></div></div>
        <div className="metadata-panel">
          <div className="metadata-source">{work.metadata ? <><strong>Bangumi</strong><span>#{work.metadata.externalId}</span><span>{work.metadata.year || "年份未知"}</span><small>更新于 {formatDate(work.metadata.fetchedAt)}</small></> : <><strong>尚未关联公共元数据</strong><span>可从本地动漫文件开始识别</span></>}</div>
          <div className="lock-grid">
            {([['title', '标题'], ['originalTitle', '原始标题'], ['description', '简介'], ['coverPath', '封面'], ['metadataYear', '年份'], ['tags', '标签']] as const).map(([field, label]) => { const locked = work.fieldLocks.includes(field); return <button type="button" className={`lock-chip ${locked ? "locked" : ""}`} key={field} onClick={() => void toggleLock(field)} title={locked ? `解锁${label}` : `锁定${label}`}><span>{locked ? <Lock size={13} /> : <Unlock size={13} />}{label}</span></button>; })}
          </div>
        </div>
      </section>

      <section className="detail-section">
        <div className="section-heading"><div><h2>本地文件</h2><span>文件只会被打开或关联，不会被应用修改</span></div></div>
        {work.mediaFiles.length === 0 ? (
          <EmptyState title="尚未关联文件" description="从扫描结果中选择文件，将它们归入这部作品。" action={<button type="button" className="button primary" onClick={() => void openAttach()}>关联文件</button>} />
        ) : (
          <div className="file-table">
            <div className="file-table-head"><span>文件名</span><span>类型</span><span>大小</span><span>状态</span><span>操作</span></div>
            {work.mediaFiles.map((file) => {
              const compatibleTools = tools.filter((tool) => tool.supportedMediaTypes.includes(file.mediaType));
              return (
                <div className="file-row" key={file.id}>
                  <div className="file-name"><strong title={file.fileName}>{file.fileName}</strong><small title={file.path}>{file.path}</small></div>
                  <span>{mediaLabels[file.mediaType]}</span>
                  <span>{formatSize(file.size)}</span>
                  <span className={file.missing ? "warning-text" : "available-text"}>{file.missing ? <><AlertTriangle size={14} />缺失</> : "可用"}</span>
                  <div className="file-actions">
                    <button type="button" className="button compact primary" disabled={file.missing || busyFile === file.id} onClick={() => void launch(file)}>{work.type === "game" ? "启动" : "打开"}</button>
                    <details className="action-menu">
                      <summary aria-label="更多打开方式" data-tooltip="更多打开方式"><MoreHorizontal size={18} /></summary>
                      <div className="menu-popover">
                        {compatibleTools.map((tool) => <button type="button" key={tool.id} onClick={() => void launch(file, tool.id)}><ExternalLink size={15} />使用 {tool.name}</button>)}
                        <button type="button" onClick={() => void launch(file, null, true)}><ExternalLink size={15} />系统默认程序</button>
                        <button type="button" onClick={() => void reveal(file)}><FolderOpen size={15} />打开所在目录</button>
                        <button type="button" onClick={() => void detach(file.id)}><Unlink size={15} />解除关联</button>
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="detail-section notes-section">
        <div className="section-heading"><div><h2>个人备注</h2><span>仅保存在本机</span></div></div>
        <p>{work.notes || "暂无个人备注。"}</p>
      </section>

      {editOpen ? <Modal title="编辑作品" width="large" onClose={() => setEditOpen(false)}><WorkForm work={work} busy={saving} onCancel={() => setEditOpen(false)} onSubmit={update} /></Modal> : null}
      {attachOpen ? (
        <Modal title="关联本地文件" width="large" onClose={() => setAttachOpen(false)}>
          <div className="search-box modal-search"><input value={attachSearch} onChange={(e) => setAttachSearch(e.target.value)} placeholder="搜索未归档文件" /></div>
          <div className="attach-list">
            {availableFiles.length ? availableFiles.map((file) => (
              <div key={file.id} className="attach-row">
                <div><strong>{file.fileName}</strong><small>{file.path}</small></div>
                <span>{mediaLabels[file.mediaType]}</span>
                <button type="button" className="button compact secondary" disabled={busyFile === file.id} onClick={() => void attach(file.id)}>关联</button>
              </div>
            )) : <EmptyState title="没有可关联的文件" description="请先添加并扫描本地目录，或调整搜索条件。" />}
          </div>
        </Modal>
      ) : null}
      {deleteOpen ? <ConfirmDialog title="删除作品记录？" description="这只会删除 Genzo 数据库中的作品记录，并解除文件关联。任何本地媒体文件都不会被删除、移动或修改。" busy={saving} onCancel={() => setDeleteOpen(false)} onConfirm={() => void remove()} /> : null}
      {recognizingMedia ? <RecognitionDialog media={recognizingMedia} initialCandidates={work.candidates.filter((candidate) => candidate.mediaFileId === recognizingMedia.id)} onClose={() => setRecognizingMedia(null)} onMatched={(workId) => { setRecognizingMedia(null); if (workId === work.id) void load(); else navigate(`/library/${workId}`); }} onChanged={() => void load()} /> : null}
    </div>
  );
}
