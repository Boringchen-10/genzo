import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Heart,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Sparkles,
  Star,
  Trash2,
  Unlink,
  Unlock,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { dataProvider as api } from "../data";
import { RecognitionDialog } from "../components/RecognitionDialog";
import { ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, Modal } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { WorkForm } from "../components/WorkForm";
import { useToasts } from "../store";
import type { ExternalTool, MediaFile, WorkDetail, WorkInput } from "../types";
import { coverUrl, formatDate, formatSize, getErrorMessage, mediaLabels, statusLabels } from "../utils";
import "../work-detail.css";

const metadataStatusLabels = {
  unmatched: "未识别",
  candidate_pending: "待确认",
  matched: "已匹配",
  manually_created: "手动创建",
  error: "识别失败",
} as const;

function workInput(work: WorkDetail, overrides: Partial<WorkInput> = {}): WorkInput {
  return {
    title: work.title,
    originalTitle: work.originalTitle,
    type: work.type,
    description: work.description,
    coverPath: work.coverPath,
    status: work.status,
    favorite: work.favorite,
    rating: work.rating,
    tags: work.tags,
    notes: work.notes,
    ...overrides,
  };
}

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
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [attachSearch, setAttachSearch] = useState("");
  const [recognizingMedia, setRecognizingMedia] = useState<MediaFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [workData, toolData] = await Promise.all([api.getWork(id), api.listTools()]);
      setWork(workData);
      setNotesDraft(workData.notes);
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
      const updated = await api.updateWork(id, input);
      setWork(updated);
      setNotesDraft(updated.notes);
      setEditOpen(false);
      toast("作品信息已保存", "success");
    } catch (updateError: unknown) {
      toast(getErrorMessage(updateError), "error");
    } finally {
      setSaving(false);
    }
  };

  const updateInline = async (input: WorkInput, successMessage: string) => {
    setSaving(true);
    try {
      const updated = await api.updateWork(id, input);
      setWork(updated);
      toast(successMessage, "success");
    } catch (updateError: unknown) {
      toast(getErrorMessage(updateError), "error");
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    if (!work) return;
    setNotesSaving(true);
    try {
      const updated = await api.updateWork(id, workInput(work, { notes: notesDraft }));
      setWork(updated);
      setNotesDraft(updated.notes);
      toast("点评已保存在本机", "success");
    } catch (updateError: unknown) {
      toast(getErrorMessage(updateError), "error");
    } finally {
      setNotesSaving(false);
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

  const sortedFiles = [...work.mediaFiles].sort((left, right) => left.fileName.localeCompare(right.fileName, "zh-CN", { numeric: true }));
  const firstAvailable = sortedFiles.find((file) => !file.missing);
  const recognitionFile = sortedFiles.find((file) => file.mediaType === "video" && !file.missing);
  const notesDirty = notesDraft !== work.notes;

  const toggleLock = async (field: string) => {
    const locked = !work.fieldLocks.includes(field);
    try {
      await api.setFieldLock(work.id, field, locked);
      setWork({ ...work, fieldLocks: locked ? [...work.fieldLocks, field] : work.fieldLocks.filter((item) => item !== field) });
      toast(locked ? "字段已锁定，刷新元数据时不会覆盖" : "字段已解锁", "success");
    } catch (lockError: unknown) {
      toast(getErrorMessage(lockError), "error");
    }
  };

  return (
    <div className={`detail-page ${work.coverPath ? "has-detail-artwork" : ""}`} style={work.coverPath ? { "--detail-artwork": `url("${coverUrl(work.coverPath)}")` } as CSSProperties : undefined}>
      <div className="detail-backdrop" aria-hidden="true" />
      <div className="detail-inner">
        <div className="detail-topbar">
          <Link className="icon-button detail-back" to="/library" aria-label="返回媒体库" data-tooltip="返回媒体库"><ArrowLeft size={17} /></Link>
          <strong>作品详情</strong>
          <span className="detail-topbar-fill" />
          <IconButton tooltip={work.favorite ? "取消收藏" : "加入收藏"} aria-pressed={work.favorite} onClick={() => void updateInline(workInput(work, { favorite: !work.favorite }), work.favorite ? "已取消收藏" : "已加入收藏")} disabled={saving}>
            <Heart size={17} fill={work.favorite ? "currentColor" : "none"} />
          </IconButton>
          <IconButton tooltip="编辑作品" onClick={() => setEditOpen(true)}><Pencil size={16} /></IconButton>
          <IconButton tooltip="删除作品记录" className="danger-ghost" onClick={() => setDeleteOpen(true)}><Trash2 size={16} /></IconButton>
        </div>

        <section className="detail-hero">
          <div className="detail-cover"><MediaVisual type={work.type} coverPath={work.coverPath} alt={`${work.title} 封面`} /></div>
          <div className="detail-copy">
            <span className="detail-eyebrow">{mediaLabels[work.type]}{work.metadataYear ? ` · ${work.metadataYear}` : ""}</span>
            <h1>{work.title}</h1>
            {work.originalTitle ? <p className="original-title">{work.originalTitle}</p> : null}
            <div className="detail-actions">
              <button type="button" className="button primary icon-text" disabled={!firstAvailable || busyFile !== null} onClick={() => firstAvailable && void launch(firstAvailable)}>
                <Play size={17} fill="currentColor" />{work.type === "game" ? "启动游戏" : "打开"}
              </button>
              <button type="button" className="button secondary" onClick={() => setEditOpen(true)}>{statusLabels[work.status]}</button>
              <button type="button" className="button secondary icon-text" onClick={() => void openAttach()}><FilePlus2 size={16} />关联文件</button>
            </div>
          </div>
        </section>

        <div className="detail-body">
          <main className="detail-main">
            <div className="detail-toprow">
              <div className="detail-toprow-left">
                <div className="ratings detail-rating">
                  <div className="rating-card unavailable">
                    <span className="rating-label">网络评分</span>
                    <div className="rating-value"><strong className="rating-score">暂无</strong><span className="rating-source">Future</span></div>
                  </div>
                  <div className="rating-card">
                    <span className="rating-label">我的评分</span>
                    <div className="rating-value">
                      <div className="reader-stars" role="radiogroup" aria-label="我的评分">
                        {[2, 4, 6, 8, 10].map((score) => (
                          <button key={score} type="button" className={`reader-star ${work.rating !== null && work.rating >= score ? "active" : ""}`} role="radio" aria-checked={work.rating === score} aria-label={`${score} 分`} disabled={saving} onClick={() => void updateInline(workInput(work, { rating: work.rating === score ? null : score }), work.rating === score ? "已清除评分" : `我的评分：${score} 分`)}>
                            <Star size={15} fill="currentColor" />
                          </button>
                        ))}
                      </div>
                    </div>
                    <small className="rating-hint">{work.rating === null ? "点击星星进行评分" : `${work.rating.toFixed(1)} / 10`}</small>
                  </div>
                </div>

                <div className="detail-about">
                  <p className="detail-description">{work.description || "暂无简介。可通过编辑作品补充本地简介。"}</p>
                  <div className="detail-tags">
                    {work.tags.map((tag) => <span className="detail-tag" key={tag}>{tag}</span>)}
                    {!work.tags.length ? <span className="detail-tag muted-tag">暂无标签</span> : null}
                  </div>
                </div>
              </div>

              <section className="notes-panel" aria-labelledby="notesTitle">
                <div className="notes-head"><h2 id="notesTitle">我的点评</h2><span className="notes-badge">{notesDirty ? "未保存" : "已保存"}</span></div>
                <label className="notes-label" htmlFor="notesInput">点评 / 备注</label>
                <textarea id="notesInput" rows={3} value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="写下你对这部作品的点评、观后感或备注…" />
                <div className="notes-foot"><small className="notes-hint">仅保存在本机。</small><button type="button" className="button primary" disabled={!notesDirty || notesSaving} onClick={() => void saveNotes()}>{notesSaving ? "保存中…" : "保存点评"}</button></div>
              </section>
            </div>

            <section className="detail-section files-section">
              <div className="detail-section-head"><h2>章节与文件</h2><span className="episode-summary"><strong>{work.mediaFiles.length}</strong> 个本地文件</span></div>
              {sortedFiles.length === 0 ? (
                <EmptyState title="尚未关联文件" description="从扫描结果中选择文件，将它们归入这部作品。" action={<button type="button" className="button primary" onClick={() => void openAttach()}>关联文件</button>} />
              ) : (
                <div className="episode-grid file-table">
                  {sortedFiles.map((file) => {
                    const compatibleTools = tools.filter((tool) => tool.supportedMediaTypes.includes(file.mediaType));
                    const subtitleCount = work.subtitleLinks.filter((link) => link.videoMediaFileId === file.id).length;
                    return (
                      <article className="file-row detail-file-card" key={file.id}>
                        <div className="detail-file-visual"><MediaVisual type={file.mediaType} coverPath={work.coverPath} alt="" /></div>
                        <div className="file-name"><strong title={file.fileName}>{file.parsedEpisode ? `第 ${file.parsedEpisode} 集` : file.fileName}</strong><small title={file.path}>{file.fileName}</small></div>
                        <div className="episode-card-meta">{mediaLabels[file.mediaType]} · {formatSize(file.size)}{subtitleCount ? ` · ${subtitleCount} 个字幕` : ""}</div>
                        <div className={file.missing ? "warning-text file-availability" : "available-text file-availability"}>{file.missing ? <><AlertTriangle size={13} />文件缺失</> : "本地可用"}</div>
                        <div className="file-actions">
                          <button type="button" className="button compact primary" disabled={file.missing || busyFile === file.id} onClick={() => void launch(file)}>{work.type === "game" ? "启动" : "打开"}</button>
                          <details className="action-menu">
                            <summary aria-label="更多打开方式" data-tooltip="更多打开方式"><MoreHorizontal size={17} /></summary>
                            <div className="menu-popover">
                              {compatibleTools.map((tool) => <button type="button" key={tool.id} onClick={() => void launch(file, tool.id)}><ExternalLink size={15} />使用 {tool.name}</button>)}
                              <button type="button" onClick={() => void launch(file, null, true)}><ExternalLink size={15} />系统默认程序</button>
                              <button type="button" onClick={() => void reveal(file)}><FolderOpen size={15} />打开所在目录</button>
                              <button type="button" onClick={() => void detach(file.id)}><Unlink size={15} />解除关联</button>
                            </div>
                          </details>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="credits-panel" aria-labelledby="creditsTitle">
              <div className="credits-head"><h2 id="creditsTitle">制作人员与角色</h2><span className="future-badge">Future</span></div>
              <div className="future-empty">当前元数据模型尚未包含制作人员与角色信息，因此这里不展示虚构数据。</div>
            </section>
          </main>

          <aside className="detail-side">
            <section className={`match-panel ${work.metadataStatus === "candidate_pending" ? "busy" : ""}`} aria-labelledby="matchTitle">
              <div className="match-head"><h2 id="matchTitle">元数据识别</h2><span className="match-badge">{metadataStatusLabels[work.metadataStatus]}</span></div>
              <p className="match-desc">{work.metadata ? <>当前匹配：<strong>{work.metadata.title}</strong> · 来源 {work.metadata.provider}</> : "尚未关联公共元数据。"}</p>
              <p className="match-result">{recognitionFile ? "识别结果有误时，可重新搜索并选择正确作品。" : "当前作品没有可用于动画识别的视频文件。"}</p>
              <div className="match-panel-actions">
                <button type="button" className="button secondary icon-text" disabled={!recognitionFile} onClick={() => recognitionFile && setRecognizingMedia(recognitionFile)}><Sparkles size={15} />{work.metadata ? "重新识别" : "识别作品"}</button>
              </div>
            </section>

            <section className="metadata-panel detail-metadata-panel" aria-labelledby="metadataTitle">
              <div className="metadata-head"><h2 id="metadataTitle">作品信息</h2><span className="metadata-source">{work.metadata ? work.metadata.provider : "本地记录"}</span></div>
              <dl className="metadata-grid">
                <div><dt>原作名</dt><dd>{work.originalTitle || "暂无"}</dd></div>
                <div><dt>年份</dt><dd>{work.metadataYear || work.metadata?.year || "暂无"}</dd></div>
                <div><dt>媒体类型</dt><dd>{mediaLabels[work.type]}</dd></div>
                <div><dt>库内状态</dt><dd>{statusLabels[work.status]}</dd></div>
                <div><dt>最近更新</dt><dd>{formatDate(work.updatedAt)}</dd></div>
                <div><dt>文件数量</dt><dd>{work.mediaFiles.length} 个</dd></div>
              </dl>
              <div className="lock-grid">
                {([["title", "标题"], ["originalTitle", "原作名"], ["description", "简介"], ["coverPath", "封面"], ["metadataYear", "年份"], ["tags", "标签"]] as const).map(([field, label]) => {
                  const locked = work.fieldLocks.includes(field);
                  return <button type="button" className={`lock-chip ${locked ? "locked" : ""}`} key={field} onClick={() => void toggleLock(field)} title={locked ? `解锁${label}` : `锁定${label}`}><span>{locked ? <Lock size={12} /> : <Unlock size={12} />}{label}</span></button>;
                })}
              </div>
              <p className="metadata-note">{work.metadata ? `Bangumi #${work.metadata.externalId} · 更新于 ${formatDate(work.metadata.fetchedAt)}` : "可从本地动画文件开始识别；锁定字段不会被后续刷新覆盖。"}</p>
            </section>

            <aside className="detail-aside">
              <div className="fact"><span>来源</span><strong>本地媒体库</strong></div>
              <div className="fact"><span>识别状态</span><strong>{metadataStatusLabels[work.metadataStatus]}</strong></div>
              <div className="fact"><span>创建时间</span><strong>{formatDate(work.createdAt)}</strong></div>
              <div className="fact"><span>文件状态</span><strong>{work.mediaFiles.some((file) => file.missing) ? "存在缺失文件" : "本地文件已同步"}</strong></div>
            </aside>
          </aside>
        </div>
      </div>

      {editOpen ? <Modal title="编辑作品" width="large" onClose={() => setEditOpen(false)}><WorkForm work={work} busy={saving} onCancel={() => setEditOpen(false)} onSubmit={update} /></Modal> : null}
      {attachOpen ? (
        <Modal title="关联本地文件" width="large" onClose={() => setAttachOpen(false)}>
          <div className="search-box modal-search"><input value={attachSearch} onChange={(event) => setAttachSearch(event.target.value)} placeholder="搜索未归档文件" /></div>
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
