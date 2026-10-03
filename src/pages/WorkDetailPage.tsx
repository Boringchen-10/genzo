import { availableForWork, firstWorkFile } from "../workSelection";
import { usePlaybackProgress } from "../usePlaybackProgress";
import { latestPlayback } from "../playback";
import { EpisodePlaybackProgress } from "../components/EpisodePlaybackProgress";
import { EpisodeStill, EpisodeArtworkControl, useEpisodeArtwork } from "../components/EpisodeArtwork";
import { PlaybackHistory } from "../components/PlaybackHistory";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Heart,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Unlink,
  Unlock,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dataProvider as api, getAnimeDetailProvider, type GenzoAnimeDetailProvider } from "../data";
import { RecognitionHistory } from "../components/RecognitionHistory";
import { RecognitionDialog } from "../components/RecognitionDialog";
import { ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, Modal, SafeImage, useOffline } from "../components/common";
import { RemoteFileActions } from "../components/RemoteStoragePanel";
import { MediaVisual } from "../components/MediaVisual";
import { MediaCorrectionDialog } from "../components/MediaCorrectionDialog";
import { RetryImagesButton } from "../components/ResilientImage";
import { WorkForm } from "../components/WorkForm";
import { MediaFileBrowser } from "../components/MediaFileBrowser";
import { BookDetailSection } from "../components/BookDetailSection";
import { useToasts } from "../store";
import type { AnimeCharacter, AnimeCredit, AnimeEpisodeEntry, AnimeWorkStructure, ExternalTool, LibraryRoot, MediaFile, WorkDetail, WorkInput } from "../types";
import { coverUrl, formatDate, formatSize, getErrorMessage, mediaLabels, workCategoryLabel, statusLabels } from "../utils";
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

const episodeNumber = (episode: AnimeEpisodeEntry): number => episode.episodeNumber ?? episode.sortNumber;

/** Bangumi 分集类型：0 正片、1 特别篇、2 OP、3 ED、4 预告、5 MAD、6 其他。 */
const episodeTypeLabels: Record<number, string> = {
  1: "特别篇",
  2: "OP",
  3: "ED",
  4: "预告",
  5: "MAD",
  6: "其他",
};

const isMainEpisode = (episode: AnimeEpisodeEntry): boolean => (episode.episodeType ?? 0) === 0;

/** 正片显示「第 N 集 · 标题」，特别篇/OP/ED 按类型显示，不把 OP 写成「第 1 集」。 */
const episodeLabel = (episode: AnimeEpisodeEntry): string => {
  const type = episode.episodeType ?? 0;
  const head = type === 0
    ? `第 ${episodeNumber(episode)} 集`
    : `${episodeTypeLabels[type] ?? "其他"}${episode.episodeNumber ? ` ${episode.episodeNumber}` : ""}`;
  return episode.title.trim() ? `${head} · ${episode.title}` : head;
};

/** 从「1080p · HEVC · FLAC」这类解析文本里取分辨率数值用于排序，越大越清晰；识别不到返回 0。 */
const mediaResolutionScore = (file: MediaFile): number => {
  const info = file.parsedMediaInfo ?? "";
  if (/\b8k\b|4320p/i.test(info)) return 4320;
  if (/\b4k\b|2160p/i.test(info)) return 2160;
  if (/\b1440p\b|\b2k\b/i.test(info)) return 1440;
  const match = info.match(/(\d{3,4})\s*p/i);
  return match ? Number(match[1]) : 0;
};

/**
 * 一集可能关联多个本地版本（不同清晰度 / 字幕组 / 编码），它们**绝不去重或合并**。
 * 卡片外层只呈现「最正确」的那一个：优先可用（未缺失），其次清晰度更高，再次已解析媒体信息、文件更大。
 * 其余版本仍然完整保留，由卡片上的「⋯」详情面板切换。
 */
const pickPrimaryFile = (files: MediaFile[]): MediaFile | null => {
  if (!files.length) return null;
  const [best] = [...files].sort((left, right) => {
    const missing = Number(left.missing) - Number(right.missing);
    if (missing !== 0) return missing;
    const resolution = mediaResolutionScore(right) - mediaResolutionScore(left);
    if (resolution !== 0) return resolution;
    const parsed = Number(Boolean(right.parsedMediaInfo)) - Number(Boolean(left.parsedMediaInfo));
    if (parsed !== 0) return parsed;
    return right.size - left.size;
  });
  return best ?? null;
};

/**
 * 本地视频缩略图：只有滚动到可见范围才按需向 Provider 请求，每个文件最多请求一次。
 *
 * `null` 是合法结果（Windows Shell 对部分 MKV/HEVC 无法提取封面帧），此时渲染中性文件占位 ——
 * **绝不用作品海报冒充视频帧**；缩略图失败不影响打开文件或定位目录。
 */
function LocalFileThumb({ file, provider, className = "local-file-thumb" }: { file: MediaFile; provider: GenzoAnimeDetailProvider | null; className?: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  const requested = useRef(false);
  const cachedThumb = file.thumbnailPath?.includes("__unsupported__") ? null : file.thumbnailPath ?? null;
  const [thumb, setThumb] = useState<string | null>(cachedThumb);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setThumb(cachedThumb);
    setFailed(false);
    requested.current = false;
  }, [file.id, cachedThumb]);

  useEffect(() => {
    if (thumb || requested.current || !provider) return;
    const node = holder.current;
    if (!node) return;
    let disposed = false;
    let completed = false;
    const request = async () => {
      if (requested.current) return;
      requested.current = true;
      try {
        // 只有用户点过「重试缩略图」（retry > 0）才要求完整提取；
        // 滚动到可见时的自动加载在挂载盘上只查 Windows 缓存，避免长时间等待。
        const result = await provider.getMediaThumbnail(file.id, retry > 0);
        completed = true;
        if (!disposed) { setThumb(result); setFailed(!result); }
      } catch {
        completed = true;
        if (!disposed) { setThumb(null); setFailed(true); }
      }
    };
    if (typeof IntersectionObserver === "undefined") { void request(); return () => { disposed = true; if (!completed) requested.current = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); void request(); }
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => { disposed = true; if (!completed) requested.current = false; observer.disconnect(); };
  }, [file.id, provider, thumb, retry]);

  return (
    <span className={className} ref={holder}>
      {thumb
        ? <img src={thumb} alt="" loading="lazy" onError={() => { requested.current = true; setThumb(null); setFailed(true); }} />
        : <MediaVisual type={file.mediaType} coverPath={null} alt="无视频缩略图" />}
      {!thumb && failed && provider ? <button type="button" className="thumbnail-retry" aria-label={`重试 ${file.fileName} 的缩略图`} onClick={() => { requested.current = false; setFailed(false); setRetry((value) => value + 1); }}>重试缩略图</button> : null}
    </span>
  );
}

export function WorkDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const playback = usePlaybackProgress(id);
  const toast = useToasts((state) => state.push);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [tools, setTools] = useState<ExternalTool[]>([]);
  const [unassigned, setUnassigned] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSelection, setCorrectionSelection] = useState<string[] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [attachRoots, setAttachRoots] = useState<LibraryRoot[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [recognizingMedia, setRecognizingMedia] = useState<MediaFile | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutClipped, setAboutClipped] = useState(false);
  const aboutRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  /** 制作人员与角色默认只显示两行，超出时提供展开/收起。 */
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [creditsClipped, setCreditsClipped] = useState(false);
  const [creditsCollapsedHeight, setCreditsCollapsedHeight] = useState(0);
  const creditsRef = useRef<HTMLDivElement>(null);
  /** 动画详情能力（官方分集 / 刷新元数据 / 手动分集映射 / 视频缩略图）；未接入时为 null。 */
  const detailProvider = useMemo(() => getAnimeDetailProvider(), []);
  /** 离线只作低干扰提示：网络元数据 / 缩略图可能取不到，本地文件操作不受影响。 */
  const offline = useOffline();
  const [structure, setStructure] = useState<AnimeWorkStructure | null>(null);
  const episodeArtwork = useEpisodeArtwork(id, structure?.episodes.map(e => `${e.provider}:${e.externalId}:${e.episodeNumber}:${e.airDate}`).join("|") ?? "");
  const [structureError, setStructureError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  /** 分集结构（官方分集 / 关联作品 / 制作人员）单独加载：不阻塞本地作品详情的首屏。 */
  const [structureLoading, setStructureLoading] = useState(false);
  const [mappingBusy, setMappingBusy] = useState<string | null>(null);
  const [mapTargets, setMapTargets] = useState<Record<string, string>>({});
  /** 每个分集在卡片外层展示哪个本地版本（externalId → mediaFile.id）；未指定时用 pickPrimaryFile 的默认「最正确」版本。 */
  const [versionChoice, setVersionChoice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setStructureError("");
    setStructure(null);
    let workData: WorkDetail | null = null;
    try {
      /* 本地作品数据（标题 / 简介 / 封面 / 本地文件 / 已有缓存）先出现。 */
      const [nextWork, toolData] = await Promise.all([api.getWork(id), api.listTools()]);
      workData = nextWork;
      setWork(nextWork);
      setNotesDraft(nextWork.notes);
      setTools(toolData);
      setMapTargets({});
      setCreditsOpen(false);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
    /* 分集结构（官方分集 / 关联作品 / 制作人员 / 角色）单独加载，失败只做区块级提示，
       不再让整页停留在「正在读取作品详情」。 */
    if (!workData || !detailProvider || workData.type !== "video") return;
    setStructureLoading(true);
    try {
      setStructure(await detailProvider.getAnimeWorkStructure(id));
    } catch (structureLoadError: unknown) {
      setStructure(null);
      setStructureError(getErrorMessage(structureLoadError));
    } finally {
      setStructureLoading(false);
    }
  }, [detailProvider, id]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const subscription = listen<string>("work-metadata-updated", async ({ payload }) => {
      if (payload !== id || disposed) return;
      try {
        const next = await api.getWork(id);
        if (!disposed) setWork(next);
        if (detailProvider) {
          const nextStructure = await detailProvider.getAnimeWorkStructure(id);
          if (!disposed) setStructure(nextStructure);
        }
      } catch { /* Local matching remains valid; metadata can be refreshed later. */ }
    });
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, [detailProvider, id]);

  useEffect(() => {
    const node = notesRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [notesDraft, work?.id]);

  useEffect(() => {
    const node = aboutRef.current;
    if (!node) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const description = node.querySelector<HTMLElement>(".detail-description");
      const tags = node.querySelector<HTMLElement>(".detail-tags");
      const descriptionClipped = description ? description.scrollHeight > description.clientHeight + 1 : false;
      const tagsClipped = tags ? tags.scrollWidth > tags.clientWidth + 1 : false;
      setAboutClipped(descriptionClipped || tagsClipped);
    };
    measure();
    /* 挂载那一刻布局、字体与滚动条都可能还没稳定，只测一次会把「其实已经裁掉」误判成「没有裁掉」，
       「查看详情」入口就要等一次无关的重渲染才出现。这里在几个稳定时点各补测一次，并观察块与子元素自身的尺寸变化。 */
    const frame = requestAnimationFrame(measure);
    const settle = window.setTimeout(measure, 120);
    if (typeof document !== "undefined" && document.fonts) void document.fonts.ready.then(measure).catch(() => {});
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const description = node.querySelector<HTMLElement>(".detail-description");
    const tags = node.querySelector<HTMLElement>(".detail-tags");
    if (description) observer.observe(description);
    if (tags) observer.observe(tags);
    window.addEventListener("load", measure);
    window.addEventListener("resize", measure);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      observer.disconnect();
      window.removeEventListener("load", measure);
      window.removeEventListener("resize", measure);
    };
  }, [work]);

  useEffect(() => {
    const node = creditsRef.current;
    if (!node) return;
    const measure = () => {
      const grid = node.querySelector<HTMLElement>(".credits-grid");
      const cards = grid ? Array.from(grid.querySelectorAll<HTMLElement>(".credit-card")) : [];
      if (!grid || cards.length < 3) { setCreditsClipped(false); return; }
      const gridTop = grid.getBoundingClientRect().top;
      const rows = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top - gridTop)))].sort((a, b) => a - b);
      if (rows.length < 3) { setCreditsClipped(false); return; }
      const gap = parseFloat(getComputedStyle(grid).rowGap) || 10;
      setCreditsClipped(true);
      setCreditsCollapsedHeight(Math.max((rows[2] ?? 0) - gap, 0));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [structure]);

  /**
   * 折叠时只露出两行，所以顺序要有优先级：主要角色 → 制作人员 → 其余角色。
   * 后端返回的制作人员动辄上百位，若按原标题顺序（制作人员在前）渲染，前两行会全是制作人员，看不到角色。
   */
  const orderedCredits = useMemo(() => {
    type CreditEntry = { kind: "staff"; credit: AnimeCredit } | { kind: "character"; character: AnimeCharacter };
    if (!structure) return [] as CreditEntry[];
    const isMainRole = (role: string) => /主角|主要/.test(role);
    const entries: CreditEntry[] = [
      ...structure.characters.filter((character) => isMainRole(character.role)).map((character) => ({ kind: "character" as const, character })),
      ...structure.staff.map((credit) => ({ kind: "staff" as const, credit })),
      ...structure.characters.filter((character) => !isMainRole(character.role)).map((character) => ({ kind: "character" as const, character })),
    ];
    return entries;
  }, [structure]);

  const openAttach = async () => {
    setAttachOpen(true);
    setAttachLoading(true);
    setAttachError("");
    try {
      const [files, roots] = await Promise.all([api.listUnassignedMedia(), api.listRoots()]);
      setUnassigned(files);
      setAttachRoots(roots);
    } catch (loadError: unknown) {
      setAttachError(getErrorMessage(loadError));
    } finally {
      setAttachLoading(false);
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

  const attach = async (mediaFileIds: string[]) => {
    setBusyFile("attach-batch");
    try {
      await api.attachMediaFiles(id, mediaFileIds);
      toast(`已关联 ${mediaFileIds.length} 个文件`, "success");
      setUnassigned((files) => files.filter((file) => !mediaFileIds.includes(file.id)));
      await load();
    } catch (attachError: unknown) {
      toast(getErrorMessage(attachError), "error");
      throw attachError;
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
      const saved = playback.data.items.find(item => item.mediaFileId === file.id);
      if (!toolId && !useSystem && saved?.toolId) await api.resumePlayback(file.id, false);
      else await api.launchMedia(file.id, toolId, useSystem);
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

  /** 重新读取分集结构（手动映射成功、关联/解除关联后调用），失败只提示、不清空已有内容。 */
  const reloadStructure = useCallback(async () => {
    if (!detailProvider) return;
    setStructureLoading(true);
    try {
      setStructure(await detailProvider.getAnimeWorkStructure(id));
      setStructureError("");
    } catch (structureLoadError: unknown) {
      setStructureError(getErrorMessage(structureLoadError));
    } finally {
      setStructureLoading(false);
    }
  }, [detailProvider, id]);

  /** 手动分集映射；`null` 表示解除映射。成功后必须重新读取结构，失败显示真实错误。 */
  const mapEpisode = async (mediaFileId: string, episodeExternalId: string | null) => {
    if (!detailProvider || mappingBusy) return;
    setMappingBusy(mediaFileId);
    try {
      await detailProvider.setMediaEpisode(mediaFileId, episodeExternalId);
      toast(episodeExternalId ? "已把文件关联到该分集" : "已解除分集关联", "success");
      await reloadStructure();
      setMapTargets((targets) => {
        const next = { ...targets };
        delete next[mediaFileId];
        return next;
      });
    } catch (mapError: unknown) {
      toast(getErrorMessage(mapError), "error");
    } finally {
      setMappingBusy(null);
    }
  };

  /**
   * 刷新元数据：`refreshWorkMetadata` 只返回动画结构，**不返回更新后的 WorkDetail**，
   * 所以必须再 `getWork()` 才能取到新的简介与标签。失败时保留页面上原有的内容。
   */
  const refreshMetadata = async () => {
    if (!detailProvider || refreshing) return;
    setRefreshing(true);
    setStructureLoading(true);
    try {
      const structureData = await detailProvider.refreshWorkMetadata(id);
      const workData = await api.getWork(id);
      setWork(workData);
      setNotesDraft(workData.notes);
      setStructure(structureData);
      setStructureError("");
      toast(structureData.warnings.length ? structureData.warnings.join("；") : "元数据已刷新", structureData.warnings.length ? "info" : "success");
    } catch (refreshError: unknown) {
      toast(getErrorMessage(refreshError), "error");
    } finally {
      setRefreshing(false);
      setStructureLoading(false);
    }
  };

  if (loading) return <div className="page"><LoadingState label="正在读取作品详情" /></div>;
  if (error || !work) return <div className="page"><ErrorState message={error || "作品不存在"} retry={() => void load()} /></div>;

  const sortedFiles = [...work.mediaFiles].sort((left, right) => left.fileName.localeCompare(right.fileName, "zh-CN", { numeric: true }));
  const firstEpisodeFile = work.type === "video" ? [...(structure?.episodes ?? [])]
    .filter(isMainEpisode).sort((a, b) => episodeNumber(a) - episodeNumber(b))
    .map(episode => pickPrimaryFile(episode.localFiles.filter(file => availableForWork(file, work.type))))
    .find((file): file is MediaFile => Boolean(file)) : undefined;
  const firstAvailable = firstEpisodeFile ?? firstWorkFile(sortedFiles, work.type);
  const lastPlayed = work.type === "video" ? latestPlayback(playback.data.items, work.id, work.mediaFiles.map(file => file.id)) : undefined;
  const continueFile = lastPlayed ? work.mediaFiles.find(file => file.id === lastPlayed.mediaFileId) : firstAvailable;
  const continueActive = playback.data.sessions.some(session => session.mediaFileId === continueFile?.id && ["connecting", "tracking"].includes(session.status));
  const remoteCount = sortedFiles.filter(file => file.path.startsWith("webdav://")).length;
  const isCompleted = work.status === "completed";
  const recognitionFile = sortedFiles.find((file) => file.mediaType === "video" && !file.missing);
  const notesDirty = notesDraft !== work.notes;
  /** 是否使用官方分集结构（视频作品 + Provider 已接入 + 结构读取成功）。 */
  const isMovie = work.metadata?.provider === "tmdb" && work.metadata.externalId.startsWith("movie/");
  const hasStructure = detailProvider !== null && work.type === "video" && structure !== null && !isMovie;
  /** 横背景只使用真正的横图；缺少横图时沿用中性背景。 */
  const detailBanner = coverUrl(work.bannerPath ?? null);
  const detailArtwork = detailBanner;
  const officialEpisodes = structure?.episodes ?? [];
  const mainEpisodes = officialEpisodes.filter(isMainEpisode);
  const extraEpisodes = officialEpisodes.filter((episode) => !isMainEpisode(episode));
  /** 正片与特别篇/OP/ED 分开成组，避免把片头片尾混进集数列表。 */
  const episodeGroups = [
    { key: "main", title: "", episodes: mainEpisodes },
    { key: "extras", title: "特别篇 / OP / ED", episodes: extraEpisodes },
  ].filter((group) => group.episodes.length);
  const libraryEpisodeCount = officialEpisodes.filter((episode) => episode.localFiles.length > 0).length;
  /** 未匹配列表里**路径已失效**的记录：文件不在磁盘上，无法用于分集关联（区别于真正待映射的文件）。 */
  const unmatchedStaleCount = (structure?.unmatchedFiles ?? []).filter((file) => file.missing).length;

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

  const goBack = () => {
    if (typeof window.history.state?.idx === "number" && window.history.state.idx > 0) {
      navigate(-1);
      return;
    }
    const category = work.category ?? work.type;
    navigate(category === "comic" || category === "novel" ? "/bookshelf" : "/library", { replace: true });
  };

  return (
    <div className={`detail-page ${detailBanner ? "has-detail-banner" : ""}`} style={detailArtwork ? { "--detail-artwork": `url("${detailArtwork}")` } as CSSProperties : undefined}>
        <div className="detail-backdrop" aria-hidden="true" />
        <div className="detail-inner">
        <div className="detail-topbar">
          <button type="button" className="icon-button detail-back" aria-label="返回上一页" data-tooltip="返回上一页" onClick={goBack}><ArrowLeft size={17} /></button>
          <strong>作品详情</strong>
          <span className="detail-topbar-fill" />
          <RecognitionHistory key={work.id} workId={work.id} onChanged={() => navigate("/library")} />
          <IconButton tooltip={work.favorite ? "取消收藏" : "加入收藏"} aria-pressed={work.favorite} onClick={() => void updateInline(workInput(work, { favorite: !work.favorite }), work.favorite ? "已取消收藏" : "已加入收藏")} disabled={saving}>
            <Heart size={17} fill={work.favorite ? "currentColor" : "none"} />
          </IconButton>
          <IconButton tooltip="编辑作品" onClick={() => setEditOpen(true)}><Pencil size={16} /></IconButton>
          <IconButton tooltip="删除作品记录" className="danger-ghost" onClick={() => setDeleteOpen(true)}><Trash2 size={16} /></IconButton>
        </div>

        <section className="detail-hero">
          <div className="detail-cover"><MediaVisual type={work.type} coverPath={work.coverPath} alt={`${work.title} 封面`} /></div>
          <div className="detail-copy">
            <span className="detail-eyebrow">{workCategoryLabel(work)}{work.metadataYear ? ` · ${work.metadataYear}` : ""}</span>
            <h1>{work.title}</h1>
            {work.originalTitle ? <p className="original-title">{work.originalTitle}</p> : null}
            <div className="detail-actions">
              {work.type === "comic" || work.type === "novel" ? (
                <a className="button primary icon-text" href="#bookshelf-entries"><BookOpen size={17} />查看卷册</a>
              ) : (
                <button type="button" className="button primary icon-text" disabled={!continueFile || (continueFile.missing && !continueFile.path.startsWith("webdav://")) || busyFile !== null || continueActive || (work.type === "video" && !playback.loaded)} title={continueFile?.fileName} onClick={() => continueFile && void launch(continueFile)}>
                  <Play size={17} fill="currentColor" />{work.type === "game" ? "启动游戏" : continueActive ? "播放中" : lastPlayed ? (lastPlayed.completed ? "重新观看" : "继续观看") : "打开"}
                </button>
              )}
              <button
                type="button"
                className={`button secondary icon-text ${isCompleted ? "is-completed" : ""}`}
                disabled={saving}
                data-tooltip={isCompleted ? "点击取消已完成" : "点击标记为已完成"}
                onClick={() => void updateInline(workInput(work, { status: isCompleted ? "in_progress" : "completed" }), isCompleted ? "已取消完成" : "已标记为已完成")}
              >
                {isCompleted ? <Check size={16} /> : null}
                {isCompleted ? "已完成" : "标记为已完成"}
              </button>
              <button type="button" className="button secondary icon-text" onClick={() => void openAttach()}><FilePlus2 size={16} />关联文件</button>
              {work.type === "video" && api.previewMediaCorrection ? <button type="button" className="button secondary" onClick={() => { setCorrectionSelection(null); setCorrectionOpen(true); }}>批量纠错</button> : null}
              <RetryImagesButton />
            </div>
          </div>
        </section>

        {work.type === "video" && <PlaybackHistory snapshot={playback} key={work.id} workId={work.id} mediaIds={work.mediaFiles.map(file => file.id)} />}
        <div className="detail-body">
          <main className="detail-main">
            <div className="detail-toprow">
              <div className="detail-toprow-left">
                <div className="ratings detail-rating">
                  <div className="rating-card unavailable">
                    <span className="rating-label">网络评分</span>
                    <div className="rating-value"><strong className="rating-score">暂无</strong><span className="rating-source">未提供</span></div>
                    <small className="rating-hint">来自 Bangumi，不会写入你的个人评分</small>
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

                <div className="detail-about" ref={aboutRef}>
                  <p className="detail-description">{work.description || "暂无简介。可通过编辑作品补充本地简介。"}</p>
                  <div className="detail-tags">
                    {work.tags.map((tag) => <span className="detail-tag" key={tag}>{tag}</span>)}
                    {!work.tags.length ? <span className="detail-tag muted-tag">暂无标签</span> : null}
                  </div>
                  {aboutClipped ? <button type="button" className="detail-about-more" onClick={() => setAboutOpen(true)}>查看详情<ChevronRight size={13} /></button> : null}
                </div>
              </div>

              <section className="notes-panel" aria-labelledby="notesTitle">
                <div className="notes-head"><h2 id="notesTitle">我的点评</h2><span className="notes-badge">{notesDirty ? "未保存" : "已保存"}</span></div>
                <label className="notes-label" htmlFor="notesInput">点评 / 备注</label>
                <textarea id="notesInput" ref={notesRef} rows={3} value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="写下你对这部作品的点评、观后感或备注…" />
                <div className="notes-foot"><small className="notes-hint">仅保存在本机。</small><button type="button" className="button primary" disabled={!notesDirty || notesSaving} onClick={() => void saveNotes()}>{notesSaving ? "保存中…" : "保存点评"}</button></div>
              </section>
            </div>

            <section className="detail-section files-section">
              <div className="detail-section-head">
                <h2>章节与文件</h2>
                <span className="episode-summary">
                  {hasStructure
                    ? <><strong>{mainEpisodes.length}</strong> 集{extraEpisodes.length ? <> · 特别篇/OP/ED <strong>{extraEpisodes.length}</strong></> : null} · 库中 <strong>{libraryEpisodeCount}</strong> 集</>
                    : <><strong>{work.mediaFiles.length}</strong> 个关联文件</>}
                </span>
              </div>

              {detailProvider === null && work.type === "video" ? (
                <p className="quiet-inline">当前运行环境未提供官方分集结构（Provider 未实现该方法），下面显示已关联的文件。</p>
              ) : null}
              {structureError ? (
                <p className="gnz-inline-error" role="alert">读取分集结构失败：{structureError}。下面显示已关联的文件。</p>
              ) : null}
              {structureLoading && work.type === "video" ? (
                <p className="quiet-inline" role="status">正在读取分集结构与制作人员…（本地内容已可查看）</p>
              ) : null}
              {detailProvider !== null && work.type === "video" && !structureLoading && !structure && !structureError ? (
                <p className="quiet-inline">尚未缓存官方分集与制作人员。点击右上角「刷新元数据」联网更新后即可看到。</p>
              ) : null}

              {work.type === "comic" || work.type === "novel" ? (
                <BookDetailSection key={work.id} workId={work.id} onMetadataChanged={() => void load()} />
              ) : hasStructure ? (
                <>
                  <EpisodeArtworkControl key={id} workId={id} artwork={episodeArtwork.artwork} warning={episodeArtwork.warning} onChange={episodeArtwork.update} />
                  {officialEpisodes.length === 0 ? (
                    <EmptyState title="没有分集信息" description={structure?.warnings[0] ?? "这部作品还没有可用的官方分集。"} />
                  ) : (
                    episodeGroups.map((group) => (
                      <Fragment key={group.key}>
                        {group.title ? <h3 className="episode-group-head">{group.title}（{group.episodes.length}）</h3> : null}
                        <div className="official-episodes">
                      {group.episodes.map((episode) => {
                        const episodePlayback = latestPlayback(playback.data.items, work.id, episode.localFiles.map(file => file.id));
                        const primaryFile = episode.localFiles.find((file) => file.id === versionChoice[episode.externalId])
                          ?? episode.localFiles.find(file => file.id === episodePlayback?.mediaFileId)
                          ?? pickPrimaryFile(episode.localFiles);
                        const fileProgress = playback.data.items.find(item => item.mediaFileId === primaryFile?.id);
                        const snapshotFile = (primaryFile?.thumbnailPath && !primaryFile.thumbnailPath.includes("__unsupported__") ? primaryFile : null)
                          ?? episode.localFiles.find((file) => file.thumbnailPath && !file.thumbnailPath.includes("__unsupported__"))
                          ?? episode.localFiles.find((file) => !file.missing)
                          ?? episode.localFiles[0] ?? null;
                        return (
                          <article className="official-episode" key={episode.externalId}>
                            <div className="episode-snapshot">
                              <EpisodeStill workId={id} episodeKey={`${episode.provider}:${episode.externalId}`} url={episodeArtwork.artwork?.images[`${episode.provider}:${episode.externalId}`] ?? episode.imageUrl} cachedUrl={episodeArtwork.artwork?.cachedImages[`${episode.provider}:${episode.externalId}`]} fallback={snapshotFile ? <LocalFileThumb file={snapshotFile} className="episode-snapshot-visual" provider={episodeArtwork.pending ? null : detailProvider} /> : <MediaVisual type="video" coverPath={null} alt="无分集剧照" />} />
                              <EpisodePlaybackProgress progress={fileProgress} />
                              <span className="episode-snapshot-badge">
                                {episode.localFiles.length ? `已关联 ${episode.localFiles.length} 个版本` : "未关联文件"}
                              </span>
                            </div>

                            <div className="official-episode-head">
                              <strong title={episodeLabel(episode)}>{episodeLabel(episode)}</strong>
                              <details className="action-menu">
                                <summary aria-label="集数详情" data-tooltip="集数详情"><MoreHorizontal size={17} /></summary>
                                <div className="menu-popover episode-detail">
                                  <p className="episode-detail-head">集数详情</p>
                                  <dl className="episode-detail-meta">
                                    {episode.originalTitle ? (<><dt>原名</dt><dd>{episode.originalTitle}</dd></>) : null}
                                    <dt>放送</dt><dd>{episode.airDate || "未知"}</dd>
                                    <dt>时长</dt><dd>{episode.duration || "未知"}</dd>
                                    <dt>关联版本</dt><dd>{episode.localFiles.length ? `${episode.localFiles.length} 个` : "无"}</dd>
                                  </dl>
                                  {episode.description
                                    ? <p className="episode-detail-desc">{episode.description}</p>
                                    : <p className="quiet-inline">这一集还没有简介。</p>}
                                  {episode.localFiles.length ? (
                                    <>
                                      <p className="episode-detail-head">本地版本（{episode.localFiles.length}）</p>
                                      {episode.localFiles.map((file) => {
                                        const active = primaryFile?.id === file.id;
                                        return (
                                          <div className={`episode-detail-file${active ? " is-active" : ""}`} key={file.id}>
                                            <button
                                              type="button"
                                              className="episode-version-select"
                                              aria-pressed={active}
                                              title={file.path}
                                              onClick={() => setVersionChoice((choices) => ({ ...choices, [episode.externalId]: file.id }))}
                                            >
                                              <span className="episode-version-name">{file.fileName}</span>
                                              <span className="episode-version-tag">{file.parsedMediaInfo || "未解析媒体信息"} · {formatSize(file.size)}</span>
                                              <span className="episode-version-state">{active ? <><Check size={13} />卡片展示中</> : "设为卡片版本"}</span>
                                            </button>
                                            <div className="episode-detail-actions">
                                              {tools.filter((tool) => tool.supportedMediaTypes.includes(file.mediaType)).map((tool) => <button type="button" key={tool.id} onClick={() => void launch(file, tool.id)}><ExternalLink size={15} />使用 {tool.name}</button>)}
                                              <button type="button" onClick={() => void launch(file, null, true)}><ExternalLink size={15} />系统默认程序</button>
                                              <button type="button" onClick={() => void reveal(file)}><FolderOpen size={15} />打开所在目录</button>
                                              <button type="button" disabled={file.missing} onClick={() => setRecognizingMedia(file)}><Sparkles size={15} />识别到其他作品</button>
                                              <button type="button" disabled={mappingBusy === file.id} onClick={() => void mapEpisode(file.id, null)}><Unlink size={15} />解除分集关联</button>
                                              <button type="button" onClick={() => void detach(file.id)}><Unlink size={15} />解除作品关联</button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </>
                                  ) : null}
                                </div>
                              </details>
                            </div>

                            <div className="official-episode-meta">
                              {episode.airDate ? <span>放送 {episode.airDate}</span> : null}
                              {episode.duration ? <span>{episode.duration}</span> : null}
                              {episode.localFiles.some((item) => item.missing) ? <span className="warning-text">存在缺失文件</span> : null}
                            </div>

                            {primaryFile ? (
                              <ul className="episode-file-info">
                                <li className="episode-file-line" key={primaryFile.id}>
                                  <span className="episode-file-name" title={primaryFile.path}>{primaryFile.fileName}</span>
                                  <span className="episode-file-meta" title={primaryFile.parsedMediaInfo || undefined}>
                                    {primaryFile.parsedMediaInfo || "未解析到媒体信息"} · {formatSize(primaryFile.size)}
                                  </span>
                                  <span className={primaryFile.missing ? "warning-text" : "available-text"}>
                                    {primaryFile.missing ? <><AlertTriangle size={12} />文件缺失</> : primaryFile.path.startsWith("webdav://") ? "远程文件" : "本地可用"}
                                  </span>
                                  <RemoteFileActions id={primaryFile.id} path={primaryFile.path} /><button type="button" className="button compact primary" disabled={(primaryFile.missing && !primaryFile.path.startsWith("webdav://")) || busyFile === primaryFile.id} onClick={() => void launch(primaryFile)}>{busyFile === primaryFile.id ? "准备中…" : fileProgress ? (fileProgress.completed ? "重新观看" : "继续观看") : "打开"}</button>
                                </li>
                                {episode.localFiles.length > 1 ? (
                                  <li className="episode-version-more">另有 {episode.localFiles.length - 1} 个版本，点右上角「⋯」切换</li>
                                ) : null}
                              </ul>
                            ) : <p className="quiet-inline episode-file-empty">还没有关联文件。</p>}
                          </article>
                        );
                      })}
                        </div>
                      </Fragment>
                    ))
                  )}

                  <div className="unmatched-block">
                    <div className="unmatched-head">
                      <h3>未匹配文件</h3>
                      {api.previewMediaCorrection && structure?.unmatchedFiles.some(file => !file.missing) ? <button type="button" className="button compact secondary" onClick={() => { setCorrectionSelection(structure.unmatchedFiles.filter(file => !file.missing).slice(0, 500).map(file => file.id)); setCorrectionOpen(true); }}>批量按文件名关联</button> : null}
                      <span>
                        {structure?.unmatchedFiles.length ?? 0} 个
                        {unmatchedStaleCount ? ` · ${unmatchedStaleCount} 个记录已失效` : ""}
                      </span>
                    </div>
                    {structure?.unmatchedFiles.length ? (
                      <ul className="unmatched-list">
                        {structure.unmatchedFiles.map((file) => (
                          <li className={`unmatched-row${file.missing ? " is-stale" : ""}`} key={file.id}>
                            <LocalFileThumb file={file} provider={detailProvider} />
                            <div className="local-version-copy">
                              <strong title={file.fileName}>{file.fileName}</strong>
                              <small title={file.path}>{file.path}</small>
                            </div>
                            {file.missing ? (
                              <span className="warning-text unmatched-state" data-tooltip="这条记录指向的路径已不存在，文件不在磁盘上，因此不能关联到分集">
                                <AlertTriangle size={13} />路径已失效
                              </span>
                            ) : (
                              <>
                                <button type="button" className="button compact secondary" onClick={() => setRecognizingMedia(file)}>识别到其他作品</button>
                                <label className="field unmatched-map">
                                  <span>关联到分集</span>
                                  <select
                                    value={mapTargets[file.id] ?? ""}
                                    onChange={(event) => setMapTargets((targets) => ({ ...targets, [file.id]: event.target.value }))}
                                    disabled={mappingBusy === file.id}
                                  >
                                    <option value="">选择分集…</option>
                                    {officialEpisodes.map((episode) => <option key={episode.externalId} value={episode.externalId}>{episodeLabel(episode)}</option>)}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  className="button compact secondary"
                                  disabled={!mapTargets[file.id] || mappingBusy === file.id}
                                  onClick={() => void mapEpisode(file.id, mapTargets[file.id] ?? null)}
                                >
                                  {mappingBusy === file.id ? "关联中…" : "关联"}
                                </button>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="quiet-inline">所有关联视频都已匹配到官方分集。</p>}
                  </div>
                </>
              ) : sortedFiles.length === 0 ? (
                <EmptyState title="尚未关联文件" description="从扫描结果中选择文件，将它们归入这部作品。" action={<button type="button" className="button primary" onClick={() => void openAttach()}>关联文件</button>} />
              ) : (
                <div className="episode-grid file-table">
                  {sortedFiles.map((file) => {
                    const compatibleTools = tools.filter((tool) => tool.supportedMediaTypes.includes(file.mediaType));
                    const subtitleCount = work.subtitleLinks.filter((link) => link.videoMediaFileId === file.id).length;
                    return (
                      <article className="file-row detail-file-card" key={file.id}>
                        <div className="detail-file-visual">{file.mediaType === "video" ? <LocalFileThumb file={file} className="episode-snapshot-visual" provider={detailProvider} /> : <MediaVisual type={file.mediaType} coverPath={work.coverPath} alt="" />}<EpisodePlaybackProgress progress={playback.data.items.find(item => item.mediaFileId === file.id)} /></div>
                        <div className="file-name"><strong title={file.fileName}>{!isMovie && file.parsedEpisode ? `第 ${file.parsedEpisode} 集` : file.fileName}</strong><small title={file.path}>{file.fileName}</small></div>
                        <div className="episode-card-meta">{mediaLabels[file.mediaType]} · {formatSize(file.size)}{subtitleCount ? ` · ${subtitleCount} 个字幕` : ""}</div>
                        <div className={file.missing ? "warning-text file-availability" : "available-text file-availability"}>{file.missing ? <><AlertTriangle size={13} />文件缺失</> : file.path.startsWith("webdav://") ? "远程文件" : "本地可用"}</div>
                        <div className="file-actions">
                          <RemoteFileActions id={file.id} path={file.path} /><button type="button" className="button compact primary" disabled={(file.missing && !file.path.startsWith("webdav://")) || busyFile === file.id} onClick={() => void launch(file)}>{work.type === "game" ? "启动" : "打开"}</button>
                          <details className="action-menu">
                            <summary aria-label="更多打开方式" data-tooltip="更多打开方式"><MoreHorizontal size={17} /></summary>
                            <div className="menu-popover">
                              {compatibleTools.map((tool) => <button type="button" key={tool.id} onClick={() => void launch(file, tool.id)}><ExternalLink size={15} />使用 {tool.name}</button>)}
                              <button type="button" onClick={() => void launch(file, null, true)}><ExternalLink size={15} />系统默认程序</button>
                              <button type="button" onClick={() => void reveal(file)}><FolderOpen size={15} />打开所在目录</button>
                              {file.mediaType === "video" ? <button type="button" disabled={file.missing} onClick={() => setRecognizingMedia(file)}><Sparkles size={15} />识别到其他作品</button> : null}
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

            {hasStructure && structure && structure.seasons.length ? (
              <section className="detail-section related-section" aria-labelledby="relatedTitle">
                <div className="detail-section-head">
                  <h2 id="relatedTitle">关联作品</h2>
                  <span>{work.metadata?.provider === "tmdb" ? "本剧已入库的季度" : "来自 Bangumi 关联条目，不保证都是季度"}</span>
                </div>
                <ul className="related-list">
                  {structure.seasons.map((season) => {
                    const subtitle = `${season.relation}${season.seasonNumber !== null ? ` · 第 ${season.seasonNumber} 季` : " · 不是季度编号"}`;
                    const body = (
                      <>
                        <span className="related-cover" aria-hidden="true">
                          <SafeImage
                            src={season.coverUrl}
                            fallback={<span className="related-initial">{season.title.slice(0, 1)}</span>}
                          />
                        </span>
                        <span className="related-copy">
                          <strong title={season.title}>{season.title}</strong>
                          <small title={subtitle}>{subtitle}</small>
                          <span className={`related-state ${season.current ? "is-current" : ""}`}>
                            {season.current ? "当前作品" : season.localWorkId ? "本地已入库" : "未入库"}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li className={`related-card ${season.current ? "is-current" : ""}`} key={season.externalId}>
                        {season.localWorkId ? (
                          <Link className="related-link" to={`/library/${season.localWorkId}`} aria-label={`${season.title}（打开本地作品）`}>{body}</Link>
                        ) : (
                          <div className="related-link is-static">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <section className="credits-panel" aria-labelledby="creditsTitle">
              <div className="credits-head">
                <h2 id="creditsTitle">制作人员与角色</h2>
                <span className="episode-summary">
                  {hasStructure && structure
                    ? `${structure.staff.length} 位制作人员 · ${structure.characters.length} 位角色`
                    : "未接入"}
                </span>
              </div>
              {hasStructure && structure && (structure.staff.length || structure.characters.length) ? (
                <>
                  <div
                    className={`credits-body${creditsClipped && !creditsOpen ? " is-clipped" : ""}`}
                    ref={creditsRef}
                    style={creditsClipped && !creditsOpen && creditsCollapsedHeight ? { maxHeight: `${creditsCollapsedHeight}px` } : undefined}
                  >
                    <div className="credits-grid">
                      {orderedCredits.map((entry) => entry.kind === "staff" ? (
                        <div className="credit-card" key={entry.credit.externalId}>
                          <span className="credit-avatar" aria-hidden="true">
                            <SafeImage src={entry.credit.imageUrl} fallback={<span className="credit-initial">{entry.credit.name.slice(0, 1)}</span>} />
                          </span>
                          <strong title={entry.credit.name}>{entry.credit.name}</strong>
                          <small>{entry.credit.role}</small>
                        </div>
                      ) : (
                        <div className="credit-card" key={entry.character.externalId}>
                          <span className="credit-avatar" aria-hidden="true">
                            <SafeImage src={entry.character.imageUrl} fallback={<span className="credit-initial">{entry.character.name.slice(0, 1)}</span>} />
                          </span>
                          <strong title={entry.character.name}>{entry.character.name}</strong>
                          <small>{entry.character.role}{entry.character.actors.length ? ` · ${entry.character.actors.join(" / ")}` : ""}</small>
                        </div>
                      ))}
                    </div>
                    {creditsClipped && !creditsOpen ? <span className="credits-fade" aria-hidden="true" /> : null}
                  </div>
                  {creditsClipped ? (
                    <button type="button" className="credits-toggle" aria-expanded={creditsOpen} onClick={() => setCreditsOpen((open) => !open)}>
                      {creditsOpen ? "收起" : "展开全部"}
                      <ChevronRight size={13} className={`credits-toggle-icon${creditsOpen ? " is-open" : ""}`} />
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="future-empty">
                  {hasStructure ? "当前元数据没有返回制作人员与角色。" : "当前运行环境未提供动画详情结构，因此这里没有制作人员与角色数据。"}
                </div>
              )}
              {structure?.warnings.length ? <p className="quiet-inline credits-note" role="status">{structure.warnings.join("；")}</p> : null}
            </section>
          </main>

          <aside className="detail-side">
            <section className={`match-panel ${work.metadataStatus === "candidate_pending" ? "busy" : ""}`} aria-labelledby="matchTitle">
              <div className="match-head"><h2 id="matchTitle">元数据识别</h2><span className="match-badge">{metadataStatusLabels[work.metadataStatus]}</span></div>
              <p className="match-desc">{work.metadata ? <>当前匹配：<strong>{work.metadata.title}</strong> · 来源 {work.metadata.provider}</> : "尚未关联公共元数据。"}</p>
              <p className="match-result">{recognitionFile ? "识别结果有误时，可重新搜索并选择正确作品。" : "当前作品没有可用于动画识别的视频文件。"}</p>
              <div className="match-panel-actions">
                <button type="button" className="button secondary icon-text" disabled={!recognitionFile} onClick={() => recognitionFile && setRecognizingMedia(recognitionFile)}><Sparkles size={15} />{work.metadata ? "重新识别" : "识别作品"}</button>
                <button type="button" className="button secondary icon-text" disabled={!detailProvider || refreshing} data-tooltip={detailProvider ? "重新读取元数据，失败时保留已有内容" : "当前运行环境未提供该能力"} onClick={() => void refreshMetadata()}><RefreshCw size={15} />{refreshing ? "刷新中…" : "刷新元数据"}</button>
              </div>
              {detailProvider === null ? <p className="quiet-inline">当前运行环境未提供动画详情能力（Provider 未实现这几个方法）。</p> : null}
              {detailProvider !== null && offline ? <p className="quiet-inline" role="status">当前网络已断开：刷新元数据与视频缩略图需要联网，可能失败；本地文件仍可正常打开。</p> : null}
            </section>

            <section className="metadata-panel detail-metadata-panel" aria-labelledby="metadataTitle">
              <div className="metadata-head"><h2 id="metadataTitle">作品信息</h2><span className="metadata-source">{work.metadata ? work.metadata.provider : "本地记录"}</span></div>
              <dl className="metadata-grid">
                <div><dt>原作名</dt><dd>{work.originalTitle || "暂无"}</dd></div>
                <div><dt>年份</dt><dd>{work.metadataYear || work.metadata?.year || "暂无"}</dd></div>
                <div><dt>媒体类型</dt><dd>{workCategoryLabel(work)}</dd></div>
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
              <p className="metadata-note">{work.metadata ? `${work.metadata.provider === "tmdb" ? "TMDB" : "Bangumi"} #${work.metadata.externalId} · 更新于 ${formatDate(work.metadata.fetchedAt)}` : "可从本地视频文件开始识别；锁定字段不会被后续刷新覆盖。"}</p>
            </section>

            <aside className="detail-aside">
              <div className="fact"><span>来源</span><strong>{remoteCount ? remoteCount === sortedFiles.length ? "WebDAV" : "本地与 WebDAV" : "本地媒体库"}</strong></div>
              <div className="fact"><span>识别状态</span><strong>{metadataStatusLabels[work.metadataStatus]}</strong></div>
              <div className="fact"><span>创建时间</span><strong>{formatDate(work.createdAt)}</strong></div>
              <div className="fact"><span>文件状态</span><strong>{work.mediaFiles.some((file) => file.missing) ? "存在缺失文件" : remoteCount ? "远程索引已保存" : "本地文件已同步"}</strong></div>
            </aside>
          </aside>
        </div>
      </div>

      {aboutOpen ? (
        <Modal title="作品简介与标签" onClose={() => setAboutOpen(false)}>
          <div className="about-detail">
            <p className="detail-description">{work.description || "暂无简介。可通过编辑作品补充本地简介。"}</p>
            <div className="detail-tags">
              {work.tags.map((tag) => <span className="detail-tag" key={tag}>{tag}</span>)}
              {!work.tags.length ? <span className="detail-tag muted-tag">暂无标签</span> : null}
            </div>
          </div>
        </Modal>
      ) : null}
      {editOpen ? <Modal title="编辑作品" width="large" onClose={() => setEditOpen(false)}><WorkForm work={work} busy={saving} onCancel={() => setEditOpen(false)} onSubmit={update} /></Modal> : null}
      {correctionOpen ? <MediaCorrectionDialog files={correctionSelection == null ? work.mediaFiles : structure?.unmatchedFiles ?? []} sourceWorkId={work.id} initialSelected={correctionSelection ?? []} initialMode={correctionSelection == null ? "keep" : "parsed"} onClose={() => setCorrectionOpen(false)} onSaved={() => { setCorrectionOpen(false); void load(); void reloadStructure(); }} /> : null}
      {attachOpen ? (
        <Modal title="关联媒体文件" width="large" onClose={() => setAttachOpen(false)}>
          {attachLoading ? <LoadingState label="正在读取可关联文件" /> : attachError ? <ErrorState message={attachError} retry={() => void openAttach()} /> : <MediaFileBrowser files={unassigned} roots={attachRoots} busy={busyFile === "attach-batch"} onAttach={attach} />}
        </Modal>
      ) : null}
      {deleteOpen ? <ConfirmDialog title="删除作品记录？" description="这只会删除 Genzo 数据库中的作品记录，并解除文件关联。任何本地媒体文件都不会被删除、移动或修改。" busy={saving} onCancel={() => setDeleteOpen(false)} onConfirm={() => void remove()} /> : null}
      {recognizingMedia ? <RecognitionDialog media={recognizingMedia} initialCandidates={work.candidates.filter((candidate) => candidate.mediaFileId === recognizingMedia.id)} onClose={() => setRecognizingMedia(null)} onMatched={(workId) => { setRecognizingMedia(null); if (workId === work.id) void load(); else navigate(`/library/${workId}`); }} onChanged={() => void load()} /> : null}
    </div>
  );
}
