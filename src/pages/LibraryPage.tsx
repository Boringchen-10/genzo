import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileQuestion, FolderTree, Grid2X2, Heart, List, Plus, Search, Sparkles, Star } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { dataProvider as api } from "../data";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { WorkCard } from "../components/WorkCard";
import { WorkForm } from "../components/WorkForm";
import { RecognitionDialog } from "../components/RecognitionDialog";
import { BatchRecognitionDialog } from "../components/BatchRecognitionDialog";
import { AttachExistingDialog } from "../components/AttachExistingDialog";
import { remainingQueue, uniqueTargets } from "../recognitionSelection";
import { RecognitionHistory } from "../components/RecognitionHistory";
import { ScanPage } from "./ScanPage";
import { libraryCategories, matchesLibraryCategory, parseLibraryCategory } from "../libraryCategory";
import { workCategoryLabels } from "../utils";
import { usePreferences, useToasts } from "../store";
import type { LibraryRoot, MediaFile, MediaType, RecognitionGroupScope, RecognitionStatus, UnassignedMediaGroup, WorkInput, WorkListItem } from "../types";
import { formatDate, formatSize, getErrorMessage, mediaLabels, workCategoryLabel, recognitionActionLabel, recognitionEntryGroup, recognisableGroups, unassignedStatusRank } from "../utils";
import { normalizePath, pathBaseName, pathDirName, pathChildSegment } from "../mediaPaths";

type Scope = "all" | "recent" | "favorites" | "missing";
type SortKey = "title" | "createdAt" | "updatedAt";
type UnassignedSortKey = "status" | "title" | "fileCount";

/* ---------- 待整理：按媒体源文件夹层级浏览 ---------- */

/** 待整理某一层级里的一行：文件夹或文件。 */
interface InboxEntry {
  key: string;
  name: string;
  path: string;
  folder: boolean;
  fileCount: number;
  missingCount: number;
  status: RecognitionStatus;
  /** 落在这个文件夹里的待整理作品组（同一作品文件夹的多个季度会有多个）。 */
  groups: UnassignedMediaGroup[];
  file: MediaFile | null;
}

/** 一次识别要处理的目标：作品组代表文件 + 识别范围。 */
interface RecognitionTarget {
  media: MediaFile;
  scope: RecognitionGroupScope;
  label: string;
}

const inboxStatusLabel = (status: RecognitionStatus, missingCount: number, fileCount: number) => {
  if (fileCount > 0 && missingCount >= fileCount) return "全部缺失";
  if (status === "candidate_pending") return "待确认";
  if (status === "error") return "识别失败";
  return "未匹配";
};

const inboxStatusClass = (status: RecognitionStatus, missingCount: number, fileCount: number) => {
  if (fileCount > 0 && missingCount >= fileCount) return "warning-text";
  if (status === "error") return "warning-text";
  if (status === "candidate_pending") return "candidate-text";
  return "quiet-inline";
};

export function LibraryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const category = parseLibraryCategory(params.get("category"));
  const initialScope = (params.get("scope") as Scope | null) ?? "all";
  const [activeSection, setActiveSection] = useState<"library" | "sources" | "inbox">(params.get("tab") === "inbox" ? "inbox" : params.get("tab") === "sources" ? "sources" : "library");
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [unassignedGroups, setUnassignedGroups] = useState<UnassignedMediaGroup[]>([]);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>(["all", "recent", "favorites", "missing"].includes(initialScope) ? initialScope : "all");
  const [mediaType, setMediaType] = useState<MediaType | "all">("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState<SortKey>("updatedAt");
  const [unassignedSort, setUnassignedSort] = useState<UnassignedSortKey>("status");
  const [comicBrowsePath, setComicBrowsePath] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [organizingSeed, setOrganizingSeed] = useState<{ media: MediaFile; title: string; mediaType: MediaType } | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkingFiles, setLinkingFiles] = useState<MediaFile[] | null>(null);
  const [batchTargets, setBatchTargets] = useState<RecognitionTarget[] | null>(null);
  /** 识别会话：单项处理或连续处理队列。 */
  const [session, setSession] = useState<{ targets: RecognitionTarget[]; index: number } | null>(null);

  const [recognitionKind, setRecognitionKind] = useState<import("../types").RecognitionKind>("anime");
  const [unassignedLimit, setUnassignedLimit] = useState(100);
  const [inboxPath, setInboxPath] = useState<string | null>(null);
  const [inboxMedia, setInboxMedia] = useState<MediaFile[]>([]);
  const [inboxMediaLoading, setInboxMediaLoading] = useState(false);
  const view = usePreferences((state) => state.libraryView);
  const setView = usePreferences((state) => state.setLibraryView);
  const toast = useToasts((state) => state.push);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError("");
    try {
      const [nextWorks, nextUnassignedGroups, nextRoots] = await Promise.all([
        api.listWorks(),
        api.listUnassignedGroups(),
        api.listRoots(),
      ]);
      setWorks(nextWorks);
      setUnassignedGroups(nextUnassignedGroups);
      setRoots(nextRoots);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load, activeSection]);

  const tags = useMemo(() => Array.from(new Set(works.flatMap((work) => work.tags))).sort((a, b) => a.localeCompare(b, "zh-CN")), [works]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
    const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return works
      .filter((work) => !normalizedSearch || work.title.toLocaleLowerCase("zh-CN").includes(normalizedSearch) || (work.originalTitle ?? "").toLocaleLowerCase("zh-CN").includes(normalizedSearch))
      .filter((work) => matchesLibraryCategory(work, category))
      .filter((work) => !favoriteOnly || work.favorite)
      .filter((work) => tag === "all" || work.tags.includes(tag))
      .filter((work) => scope === "all" || (scope === "favorites" && work.favorite) || (scope === "missing" && work.missingCount > 0) || (scope === "recent" && new Date(work.createdAt).getTime() >= recentThreshold))
      .sort((left, right) => sort === "title" ? left.title.localeCompare(right.title, "zh-CN", { numeric: true }) : new Date(right[sort]).getTime() - new Date(left[sort]).getTime());
  }, [works, search, category, favoriteOnly, tag, scope, sort]);

  /* 待整理只显示来自「媒体源」中已添加目录的作品组。早先扫描/导入、如今不属于任何已添加目录的
     记录（libraryRootId 为空，或指向已移除的目录）属于历史数据，先不展示——把对应目录重新添加为
     媒体源后即可恢复；要真正从库里清除这些历史记录，需要后端提供清理能力（本次未改后端）。 */
  const { scopedUnassigned, hiddenGroups, hiddenFiles } = useMemo(() => {
    const rootIds = new Set(roots.map((root) => root.id));
    const scoped: UnassignedMediaGroup[] = [];
    let hiddenCount = 0;
    let hiddenFileCount = 0;
    for (const group of unassignedGroups) {
      const rootId = group.representative.libraryRootId;
      if (rootId !== null && rootIds.has(rootId)) scoped.push(group);
      else {
        hiddenCount += 1;
        hiddenFileCount += group.fileCount;
      }
    }
    return { scopedUnassigned: scoped, hiddenGroups: hiddenCount, hiddenFiles: hiddenFileCount };
  }, [unassignedGroups, roots]);

  const filteredUnassigned = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
    return scopedUnassigned
      .filter((group) => !normalizedSearch || group.title.toLocaleLowerCase("zh-CN").includes(normalizedSearch) || (group.folderPath ?? group.representative.path).toLocaleLowerCase("zh-CN").includes(normalizedSearch))
      .filter((group) => mediaType === "all" || group.mediaType === mediaType)

      .sort((left, right) => {
        if (unassignedSort === "fileCount") return right.fileCount - left.fileCount || left.title.localeCompare(right.title, "zh-CN", { numeric: true });
        if (unassignedSort === "title") return left.title.localeCompare(right.title, "zh-CN", { numeric: true });
        return unassignedStatusRank(left.recognitionStatus, left.missingCount, left.fileCount) - unassignedStatusRank(right.recognitionStatus, right.missingCount, right.fileCount) || left.title.localeCompare(right.title, "zh-CN", { numeric: true });
      });
  }, [scopedUnassigned, search, mediaType, unassignedSort]);
  const visibleUnassigned = filteredUnassigned.slice(0, unassignedLimit);
  const unassignedFileCount = filteredUnassigned.reduce((total, group) => total + group.fileCount, 0);
  const comicContainers = useMemo(() => {
    const grouped = new Map<string, UnassignedMediaGroup[]>();
    for (const group of filteredUnassigned) {
      if (group.mediaType !== "comic" || !group.folderPath) continue;
      const separator = Math.max(group.folderPath.lastIndexOf("\\"), group.folderPath.lastIndexOf("/"));
      if (separator < 0) continue;
      const parent = group.folderPath.slice(0, separator);
      const children = grouped.get(parent) ?? [];
      children.push(group);
      grouped.set(parent, children);
    }
    return Array.from(grouped.entries())
      .filter(([, children]) => children.length > 1)
      .map(([path, children]) => ({
        path,
        title: path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1),
        groups: children,
        fileCount: children.reduce((total, child) => total + child.fileCount, 0),
      }))
      .sort((left, right) => left.title.localeCompare(right.title, "zh-CN", { numeric: true }));
  }, [filteredUnassigned]);
  const visibleUnassignedGroups = useMemo(() => {
    if (comicBrowsePath) {
      return filteredUnassigned.filter((group) => group.mediaType !== "comic" || group.folderPath?.startsWith(`${comicBrowsePath}\\`) || group.folderPath?.startsWith(`${comicBrowsePath}/`));
    }
    const collapsedParents = new Set(comicContainers.map((container) => container.path));
    return filteredUnassigned.filter((group) => {
      if (group.mediaType !== "comic" || !group.folderPath) return true;
      const separator = Math.max(group.folderPath.lastIndexOf("\\"), group.folderPath.lastIndexOf("/"));
      return !collapsedParents.has(group.folderPath.slice(0, separator));
    });
  }, [comicBrowsePath, comicContainers, filteredUnassigned]);

  /* 进入待整理时取文件列表；关联后的后台刷新由 refreshAfterRecognition 统一更新。
     listUnassignedMedia 目前无过滤、无分页（后端为 WHERE work_id IS NULL），大库下会传输全部记录；
     已登记后端需求（INBOX-007）：提供按媒体源 / 路径过滤与分页的查询。 */
  useEffect(() => {
    if (activeSection !== "inbox") return;
    let cancelled = false;
    setInboxMediaLoading(true);
    api.listUnassignedMedia()
      .then((files) => { if (!cancelled) setInboxMedia(files); })
      .catch((mediaError: unknown) => { if (!cancelled) toast(getErrorMessage(mediaError), "error"); })
      .finally(() => { if (!cancelled) setInboxMediaLoading(false); });
    return () => { cancelled = true; };
  }, [activeSection, toast]);

  const rootIds = useMemo(() => new Set(roots.map((root) => root.id)), [roots]);
  const scopedFiles = useMemo(
    () => inboxMedia.filter((file) => file.libraryRootId !== null && rootIds.has(file.libraryRootId)),
    [inboxMedia, rootIds],
  );

  /* 面包屑：媒体源根目录 → 逐级子文件夹。 */
  const inboxBreadcrumb = useMemo(() => {
    if (inboxPath === null) return [] as { name: string; path: string }[];
    const target = normalizePath(inboxPath);
    const root = roots.find((item) => {
      const rootPath = normalizePath(item.path);
      return target === rootPath || pathChildSegment(rootPath, target) !== null;
    });
    if (!root) return [{ name: pathBaseName(target), path: target }];
    const rootPath = normalizePath(root.path);
    const rest = target === rootPath ? "" : target.slice(rootPath.length + 1);
    const crumbs = [{ name: root.displayName || pathBaseName(rootPath) || rootPath, path: rootPath }];
    let cursor = rootPath;
    const separator = rootPath.startsWith("webdav://") ? "/" : "\\";
    for (const segment of rest ? rest.split(separator) : []) {
      cursor = `${cursor}${separator}${segment}`;
      crumbs.push({ name: segment, path: cursor });
    }
    return crumbs;
  }, [inboxPath, roots]);

  /* 当前层级：根层级 = 媒体源文件夹；进入后 = 子文件夹 + 直接位于该层的文件。 */
  const inboxLevel = useMemo<InboxEntry[]>(() => {
    const compare = (left: InboxEntry, right: InboxEntry) => {
      const primary = unassignedSort === "status"
        ? unassignedStatusRank(left.status, left.missingCount, left.fileCount) - unassignedStatusRank(right.status, right.missingCount, right.fileCount)
        : unassignedSort === "fileCount" ? right.fileCount - left.fileCount : 0;
      return primary || left.name.localeCompare(right.name, "zh-CN", { numeric: true });
    };
    if (inboxPath === null) {
      return roots
        .map<InboxEntry>((root) => {
          const path = normalizePath(root.path);
          const groups = filteredUnassigned.filter((group) => group.representative.libraryRootId === root.id);
          return {
            key: root.id,
            name: root.displayName || pathBaseName(path) || path,
            path,
            folder: true,
            fileCount: groups.reduce((total, group) => total + group.fileCount, 0),
            missingCount: groups.reduce((total, group) => total + group.missingCount, 0),
            status: groups.find(group => group.recognitionStatus === "candidate_pending")?.recognitionStatus ?? groups.find(group => group.recognitionStatus === "error")?.recognitionStatus ?? "unmatched",
            groups: [],
            file: null,
          };
        })
        .sort(compare);
    }

    const prefix = normalizePath(inboxPath);
    const folders = new Map<string, InboxEntry>();
    const files: InboxEntry[] = [];

    const touchFolder = (segment: string, group: UnassignedMediaGroup | null) => {
      const path = `${prefix}${prefix.startsWith("webdav://") ? "/" : "\\"}${segment}`;
      const entry = folders.get(segment) ?? {
        key: path,
        name: segment,
        path,
        folder: true,
        fileCount: 0,
        missingCount: 0,
        status: "unmatched" as RecognitionStatus,
        groups: [],
        file: null,
      };
      if (group) {
        // 同一作品文件夹下的多个季度会落进同一行，全部保留以免漏掉待确认的季度。
        if (!entry.groups.some((item) => item.key === group.key)) entry.groups.push(group);
        if (unassignedStatusRank(group.recognitionStatus, group.missingCount, group.fileCount) < unassignedStatusRank(entry.status, entry.missingCount, entry.fileCount)) {
          entry.status = group.recognitionStatus;
        }
      }
      folders.set(segment, entry);
      return entry;
    };

    for (const group of filteredUnassigned) {
      if (!group.folderPath) continue;
      const segment = pathChildSegment(prefix, normalizePath(group.folderPath ?? group.representative.path));
      if (!segment) continue;
      const entry = touchFolder(segment, group);
      entry.fileCount += group.fileCount;
      entry.missingCount += group.missingCount;
    }

    for (const file of scopedFiles) {
      const segment = pathChildSegment(prefix, file.path);
      if (!segment) continue;
      if (pathDirName(file.path) === prefix) {
        files.push({
          key: file.id,
          name: file.fileName,
          path: normalizePath(file.path),
          folder: false,
          fileCount: 1,
          missingCount: file.missing ? 1 : 0,
          status: file.recognitionStatus,
          groups: [],
          file,
        });
        continue;
      }
      const entry = touchFolder(segment, null);
      if (!entry.groups.length) {
        entry.fileCount += 1;
        if (file.missing) entry.missingCount += 1;
      }
    }

    return [...folders.values(), ...files].sort(compare);
  }, [inboxPath, roots, filteredUnassigned, scopedFiles, unassignedSort]);

  /** 当前文件夹本身就是一个作品组（可能是多季）时，把识别 / 手动整理操作放在这一级。 */
  const inboxGroupsHere = useMemo(() => {
    if (inboxPath === null) return [] as UnassignedMediaGroup[];
    const prefix = normalizePath(inboxPath);
    return filteredUnassigned.filter((group) => normalizePath(group.folderPath ?? group.representative.path) === prefix);
  }, [inboxPath, filteredUnassigned]);

  const openInboxFile = async (file: MediaFile) => {
    try {
      await api.launchMedia(file.id, null, true);
    } catch (launchError: unknown) {
      toast(getErrorMessage(launchError), "error");
    }
  };
  const currentInboxFiles = inboxPath === null ? [] : scopedFiles.filter(file => pathChildSegment(inboxPath, file.path) !== null);

  const recognitionTargetForGroup = (group: UnassignedMediaGroup, scope: RecognitionGroupScope): RecognitionTarget => ({
    media: group.representative,
    scope,
    label: group.title,
  });
  /** 附属文件（字幕）本身不能识别，改用它同组里的视频文件作为入口。 */
  const recognitionTargetForFile = (file: MediaFile): RecognitionTarget | null => {
    if (file.mediaType === "video") return { media: file, scope: "season", label: file.fileName };
    const folder = pathDirName(file.path);
    const sibling = scopedFiles.find((candidate) => candidate.mediaType === "video" && pathDirName(candidate.path) === folder);
    if (sibling) return { media: sibling, scope: "season", label: file.fileName };
    const group = filteredUnassigned.find((item) => item.folderPath && normalizePath(item.folderPath) === folder);
    const entry = group ? recognitionEntryGroup([group]) : null;
    return entry ? { media: entry.representative, scope: "season", label: file.fileName } : null;
  };
  /** 当前层级里及子目录里按现有排序待处理的识别目标，用于连续处理。 */
  const inboxTargets = useMemo(() => uniqueTargets(recognisableGroups(filteredUnassigned)
    .filter(group => !inboxPath || pathChildSegment(inboxPath, group.representative.path) !== null)
    .map(group => recognitionTargetForGroup(group, "season"))), [filteredUnassigned, inboxPath]);

  const currentTarget = session ? session.targets[session.index] ?? null : null;

  const startRecognition = (targets: RecognitionTarget[]) => {
    if (!targets.length) return;
    setSession({ targets: uniqueTargets(targets), index: 0 });
  };
  const closeSession = () => setSession(null);
  const advanceSession = () => setSession((current) => {
    if (!current) return null;
    const next = current.index + 1;
    return next >= current.targets.length ? null : { ...current, index: next };
  });

  /** 确认 / 识别之后重新取数，并把已经处理过的项从连续处理队列里移除。 */
  const refreshAfterRecognition = async () => {
    await load(true);
    try {
      const files = await api.listUnassignedMedia();
      setInboxMedia(files);
      const pendingIds = new Set(files.map((file) => file.id));
      setSession((current) => {
        if (!current) return null;
        return remainingQueue(current, pendingIds);
      });
    } catch (mediaError: unknown) {
      toast(getErrorMessage(mediaError), "error");
    }
  };

  const openManualCreate = (target: RecognitionTarget) => {
    setOrganizingSeed({
      media: target.media,
      title: target.media.parsedTitle || target.label.replace(/\.[^.]+$/, ""),
      mediaType: target.media.mediaType,
    });
    closeSession();
  };

  const attachToExisting = async (workId: string, ids: string[]) => {
    if (!linkingFiles) return;
    setSaving(true);
    try {
      await api.attachMediaFiles(workId, ids);
      setInboxMedia(files => files.filter(file => !ids.includes(file.id)));
      setLinkingFiles(null);
      toast(`已关联 ${ids.length} 个文件到已有作品`, "success");
      await load(true);
    } catch (error: unknown) { toast(getErrorMessage(error), "error"); }
    finally { setSaving(false); }
  };
  const revealInboxFile = async (file: MediaFile) => {
    try {
      await api.openMediaDirectory(file.id);
    } catch (revealError: unknown) {
      toast(getErrorMessage(revealError), "error");
    }
  };

  const create = async (input: WorkInput) => {
    setSaving(true);
    try {
      await api.createWork(input);
      setShowCreate(false);
      toast("作品已创建", "success");
      await load();
    } catch (createError: unknown) {
      toast(getErrorMessage(createError), "error");
    } finally {
      setSaving(false);
    }
  };

  const createFromMedia = async (input: WorkInput) => {
    if (!organizingSeed) return;
    setSaving(true);
    try {
      const work = await api.createWorkFromMedia(organizingSeed.media.id, input);
      setOrganizingSeed(null);
      toast("作品已创建，已关联同组的待整理文件", "success");
      await load();
      navigate(`/library/${work.id}`);
    } catch (createError: unknown) {
      toast(getErrorMessage(createError), "error");
    } finally {
      setSaving(false);
    }
  };

  const suggestedTitle = organizingSeed?.title ?? "";

  const recognizeAll = () => {
    const targets = inboxTargets.slice(0, 50);
    if (inboxTargets.length > 50) toast("本次先预览前 50 个作品组，整理后可继续下一批。", "info");
    if (targets.length) setBatchTargets(targets);
  };

  return (
    <div className="page workspace-page page-library">
      <PageHeader
        title="媒体库"
        description={`${works.length} 部作品 · ${filteredUnassigned.length} 个待整理作品组`}
        actions={activeSection === "inbox"
          ? <div className="film-tv-batch"><select aria-label="批量识别类型" value={recognitionKind} disabled={!!batchTargets} onChange={event => setRecognitionKind(event.target.value as import("../types").RecognitionKind)}><option value="anime">动漫</option><option value="movie">电影</option><option value="tv">电视剧</option></select><button type="button" className="button secondary icon-text" disabled={!inboxTargets.length} onClick={recognizeAll}><Sparkles size={17} />批量预览与确认</button></div>
          : activeSection === "sources"
            ? undefined
            : <button type="button" className="button primary icon-text" onClick={() => setShowCreate(true)}><Plus size={17} />新建作品</button>}
      />
      <div className="gnz-primary-tabs gnz-library-tabs" role="tablist" aria-label="媒体库页面">
        <button type="button" role="tab" aria-selected={activeSection === "library"} className={activeSection === "library" ? "active" : ""} onClick={() => setActiveSection("library")}>媒体库</button>
        <button type="button" role="tab" aria-selected={activeSection === "sources"} className={activeSection === "sources" ? "active" : ""} onClick={() => setActiveSection("sources")}>媒体源</button>
        <button type="button" role="tab" aria-selected={activeSection === "inbox"} className={activeSection === "inbox" ? "active" : ""} onClick={() => setActiveSection("inbox")}>待整理{scopedUnassigned.length ? <span className="tab-count">{scopedUnassigned.length}</span> : null}</button>
      </div>
      {activeSection === "sources" ? <ScanPage /> : null}
      {activeSection !== "sources" ? <div className="library-toolbar">
        <div className="search-box">
          <Search size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标题或原始标题" aria-label="搜索作品" />
        </div>
        {activeSection === "inbox" ? <RecognitionHistory onChanged={() => void refreshAfterRecognition()} /> : null}
        {activeSection === "library" ? <select value={category} aria-label="作品分类" onChange={(event) => {
          const value = parseLibraryCategory(event.target.value);
          setParams(previous => {
            const next = new URLSearchParams(previous);
            if (value === "all") next.delete("category");
            else next.set("category", value);
            return next;
          }, { replace: true });
        }}>
          {libraryCategories.map(value => <option key={value} value={value}>{value === "all" ? "全部分类" : value === "videos" ? "全部视频" : workCategoryLabels[value]}</option>)}
        </select> : <select value={mediaType} onChange={(e) => setMediaType(e.target.value as MediaType | "all")} aria-label="媒体类型">
          <option value="all">全部类型</option>
          {(Object.keys(mediaLabels) as MediaType[]).map((type) => <option key={type} value={type}>{mediaLabels[type]}</option>)}
        </select>}
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="标签筛选">
          <option value="all">全部标签</option>
          {tags.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序方式">
          <option value="updatedAt">最近更新</option>
          <option value="createdAt">最近创建</option>
          <option value="title">标题</option>
        </select>
        <button type="button" className={`filter-toggle ${favoriteOnly ? "active" : ""}`} onClick={() => setFavoriteOnly(!favoriteOnly)} aria-pressed={favoriteOnly} disabled={activeSection === "inbox"}>
          <Heart size={16} fill={favoriteOnly ? "currentColor" : "none"} /> 收藏
        </button>
        <div className="segmented" aria-label="显示方式">
          <button type="button" data-tooltip="海报网格" aria-label="海报网格" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid2X2 size={16} /></button>
          <button type="button" data-tooltip="列表" aria-label="列表" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={17} /></button>
        </div>
      </div> : null}
      {activeSection === "library" ? <div className="scope-tabs" role="tablist" aria-label="媒体库范围">
        {([['all', '全部'], ['recent', '最近添加'], ['favorites', '收藏'], ['missing', '文件缺失']] as const).map(([value, label]) => (
          <button key={value} type="button" className={scope === value ? "active" : ""} onClick={() => setScope(value)}>{label}</button>
        ))}
      </div> : activeSection === "inbox" ? <div className="gnz-inbox-note">按「媒体源」的文件夹层级浏览：从媒体源根目录逐级打开子文件夹，直到看到文件。识别与手动整理仍然按作品组进行；字幕会作为视频作品组的附属文件显示。{hiddenGroups > 0 ? <span className="gnz-inbox-hidden">已隐藏 {hiddenGroups} 个不属于任何媒体源的历史作品组（{hiddenFiles} 个文件）：它们来自已移除的目录。把该目录重新添加为媒体源后即可再次显示。</span> : null}</div> : null}

      {activeSection === "inbox" && !loading && !error && filteredUnassigned.length > 0 ? (
        <section className="unassigned-section">
          <div className="section-heading">
            <div><h2>待整理内容</h2><span>{inboxPath === null ? `${roots.length} 个媒体源，共 ${unassignedFileCount} 个待整理文件；逐级打开文件夹即可看到文件。` : `${inboxBreadcrumb.map((crumb) => crumb.name).join(" / ")} · ${inboxLevel.filter((entry) => entry.folder).length} 个子文件夹 · ${inboxLevel.filter((entry) => !entry.folder).length} 个文件`}</span></div>
            <div className="inbox-heading-actions">
              <button type="button" className="button secondary compact icon-text" disabled={!inboxTargets.length} onClick={() => startRecognition(inboxTargets)}><Sparkles size={15} />连续处理{inboxTargets.length ? ` ${inboxTargets.length}` : ""}</button>
              <select className="unassigned-sort" value={unassignedSort} onChange={(event) => setUnassignedSort(event.target.value as UnassignedSortKey)} aria-label="待整理内容排序">
                <option value="status">按识别状态</option>
                <option value="title">按标题</option>
                <option value="fileCount">按文件数量</option>
              </select>
            </div>
          </div>

          <nav className="inbox-crumbs" aria-label="待整理文件夹路径">
            <button type="button" onClick={() => setInboxPath(null)} disabled={inboxPath === null}>媒体源</button>
            {inboxBreadcrumb.map((crumb, index) => (
              <Fragment key={crumb.path}>
                <ChevronRight size={13} />
                <button type="button" className={index === inboxBreadcrumb.length - 1 ? "inbox-crumb-current" : ""} onClick={() => setInboxPath(crumb.path)} disabled={index === inboxBreadcrumb.length - 1}>{crumb.name}</button>
              </Fragment>
            ))}
          </nav>

          {currentInboxFiles.length ? <div className="inbox-group-row"><span>当前目录及子目录：{currentInboxFiles.length} 个待整理文件</span><button type="button" className="button secondary compact" disabled={inboxMediaLoading} onClick={() => { setLinkingFiles(currentInboxFiles); }}>关联已有作品</button></div> : null}

          {inboxGroupsHere.length ? (() => {
            const primary = inboxGroupsHere[0];
            if (!primary) return null;
            const entryGroup = recognitionEntryGroup(inboxGroupsHere);
            const totalFiles = inboxGroupsHere.reduce((total, group) => total + group.fileCount, 0);
            return (
              <div className="inbox-group-here">
                <div className="inbox-group-row">
                  <div>
                    <strong>{primary.title}</strong>
                    <small>
                      {inboxGroupsHere.length > 1 ? `${inboxGroupsHere.length} 个季度/特别篇组` : mediaLabels[primary.mediaType]}
                      {" · "}{totalFiles} 个文件 · {inboxStatusLabel(primary.recognitionStatus, primary.missingCount, primary.fileCount)}
                    </small>
                  </div>
                  <div className="inbox-actions">
                    {entryGroup ? <button type="button" className="button secondary compact" onClick={() => startRecognition([recognitionTargetForGroup(entryGroup, "folder")])}>{inboxGroupsHere.length > 1 ? "识别整个文件夹" : recognitionActionLabel(entryGroup)}</button> : null}
                    <button type="button" className="button secondary compact" disabled={inboxGroupsHere.every((group) => group.missingCount >= group.fileCount)} onClick={() => openManualCreate(recognitionTargetForGroup(primary, "folder"))}>手动整理</button>
                  </div>
                </div>
                {inboxGroupsHere.length > 1 ? (
                  <div className="inbox-season-list">
                    {inboxGroupsHere.map((group) => (
                      <div className="inbox-season-row" key={group.key}>
                        <span><strong>{group.title}</strong><small>{group.fileCount} 个文件 · {inboxStatusLabel(group.recognitionStatus, group.missingCount, group.fileCount)}</small></span>
                        <span className="inbox-actions">
                          {recognisableGroups([group]).length ? <button type="button" className="button secondary compact" onClick={() => startRecognition([recognitionTargetForGroup(group, "season")])}>{recognitionActionLabel(group)}</button> : null}
                          <button type="button" className="button secondary compact" onClick={() => openManualCreate(recognitionTargetForGroup(group, "season"))}>手动整理</button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })() : null}

          <div className="inbox-tree">
            <div className="inbox-tree-head"><span>名称</span><span>内容</span><span>识别状态</span><span>操作</span></div>
            {inboxMediaLoading ? <div className="inbox-empty">正在读取文件列表…</div> : null}
            {!inboxMediaLoading && inboxLevel.length === 0 ? <div className="inbox-empty">这个文件夹里没有待整理的内容。</div> : null}
            {inboxLevel.slice(0, unassignedLimit).map((entry) => entry.folder ? (
              <div className="inbox-folder" key={entry.key}>
                <button type="button" className="inbox-folder-link" onClick={() => setInboxPath(entry.path)}>
                <span className="inbox-name"><FolderTree size={18} /><span><strong>{entry.name}</strong><small title={entry.path}>{entry.path}</small></span></span>
                </button>
                <span className="inbox-meta">{entry.fileCount} 个文件{entry.missingCount ? ` · ${entry.missingCount} 个缺失` : ""}</span>
                <span className={inboxStatusClass(entry.status, entry.missingCount, entry.fileCount)}>{inboxStatusLabel(entry.status, entry.missingCount, entry.fileCount)}</span>
                <span className="inbox-actions">
                  {(() => {
                    const group = recognitionEntryGroup(entry.groups);
                    return group ? <button type="button" className="button secondary compact" onClick={() => startRecognition([recognitionTargetForGroup(group, "folder")])}>{recognitionActionLabel(group)}</button> : null;
                  })()}
                  <button type="button" className="icon-button" aria-label={`打开 ${entry.name}`} onClick={() => setInboxPath(entry.path)}><ChevronRight size={16} /></button>
                </span>
              </div>
            ) : (
              <div className="inbox-file" key={entry.key}>
                <span className="inbox-name"><FileQuestion size={18} /><span><strong>{entry.file?.fileName ?? entry.name}</strong><small title={entry.path}>{entry.path}</small></span></span>
                <span className="inbox-meta">{entry.file ? `${mediaLabels[entry.file.mediaType]} · ${formatSize(entry.file.size)}` : ""}</span>
                <span className={inboxStatusClass(entry.status, entry.missingCount, entry.fileCount)}>{inboxStatusLabel(entry.status, entry.missingCount, entry.fileCount)}</span>
                <span className="inbox-actions">
                  {(() => {
                    const target = entry.file && entry.missingCount === 0 && entry.status !== "matched" ? recognitionTargetForFile(entry.file) : null;
                    return target ? <button type="button" className="button secondary compact" onClick={() => startRecognition([target])}>{entry.status === "candidate_pending" ? "查看候选" : "识别"}</button> : null;
                  })()}
                  <button type="button" className="button secondary compact" onClick={() => { if (entry.file) { setLinkingFiles([entry.file]); } }}>关联作品</button>
                  <button type="button" className="button secondary compact" disabled={entry.missingCount > 0} onClick={() => { if (entry.file) void openInboxFile(entry.file); }}>打开</button>
                  <button type="button" className="button secondary compact" disabled={entry.missingCount > 0} onClick={() => { if (entry.file) void revealInboxFile(entry.file); }}>所在目录</button>
                </span>
              </div>
            ))}
          </div>

          {inboxLevel.length > unassignedLimit ? <button type="button" className="show-more-button" onClick={() => setUnassignedLimit((limit) => limit + 100)}><ChevronDown size={15} />再显示 {Math.min(100, inboxLevel.length - unassignedLimit)} 项</button> : null}
        </section>
      ) : null}

      {loading ? <LoadingState label={activeSection === "inbox" ? "正在读取待整理作品组" : "正在读取作品"} /> : null}
      {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
      {activeSection === "library" && !loading && !error && filtered.length === 0 ? (
        <EmptyState
          title={works.length ? "没有符合条件的作品" : "还没有作品记录"}
          description={works.length ? "调整搜索词或筛选条件后再试。" : "你可以手动创建作品，或先扫描本地目录。"}
          action={!works.length ? <button type="button" className="button primary" onClick={() => setShowCreate(true)}>新建作品</button> : undefined}
        />
      ) : null}
      {activeSection === "inbox" && !loading && !error && filteredUnassigned.length === 0 ? <EmptyState title="没有待整理作品组" description="扫描到的内容已整理完成，或当前筛选条件没有结果。" /> : null}
      {activeSection === "library" && !loading && !error && filtered.length > 0 && view === "grid" ? (
        <div className="work-grid">{filtered.map((work) => <WorkCard key={work.id} work={work} />)}</div>
      ) : null}
      {activeSection === "library" && !loading && !error && filtered.length > 0 && view === "list" ? (
        <div className="work-list">
          <div className="work-list-head"><span>作品</span><span>类型</span><span>标签</span><span>文件</span><span>更新</span></div>
          {filtered.map((work) => (
            <Link className="work-list-row" to={`/library/${work.id}`} key={work.id}>
              <div className="work-list-title"><div className="mini-cover"><MediaVisual type={work.type} coverPath={work.coverPath} alt="" /></div><div><strong>{work.title}</strong><small>{work.originalTitle || "无原始标题"}</small></div></div>
              <span>{workCategoryLabel(work)}</span>
              <span className="tag-cell">{work.tags.length ? work.tags.slice(0, 2).join(" · ") : "—"}</span>
              <span className={work.missingCount ? "warning-text" : ""}>{work.mediaCount}{work.missingCount ? `（${work.missingCount} 缺失）` : ""}</span>
              <span>{formatDate(work.updatedAt).split(" ")[0]}</span>
              {work.rating !== null ? <span className="row-rating"><Star size={13} fill="currentColor" />{work.rating.toFixed(1)}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}

      {showCreate ? <Modal title="新建作品" width="large" onClose={() => setShowCreate(false)}><WorkForm busy={saving} onCancel={() => setShowCreate(false)} onSubmit={create} /></Modal> : null}
      {linkingFiles ? <AttachExistingDialog files={linkingFiles} works={works} busy={saving} onClose={() => setLinkingFiles(null)} onConfirm={(workId, ids) => void attachToExisting(workId, ids)} /> : null}
      {batchTargets ? <BatchRecognitionDialog targets={batchTargets} kind={recognitionKind} onClose={() => { setBatchTargets(null); void refreshAfterRecognition(); }} onChanged={() => void refreshAfterRecognition()} /> : null}
      {organizingSeed ? (
        <Modal title="整理为作品" width="large" onClose={() => setOrganizingSeed(null)}>
          <WorkForm
            key={organizingSeed.media.id}
            initialInput={{ title: suggestedTitle, type: organizingSeed.mediaType }}
            busy={saving}
            onCancel={() => setOrganizingSeed(null)}
            onSubmit={createFromMedia}
          />
        </Modal>
      ) : null}
      {currentTarget ? (
        <RecognitionDialog
          key={`${currentTarget.media.id}:${currentTarget.scope}`}
          media={currentTarget.media}
          initialKind={recognitionKind}
          scope={currentTarget.scope}
          queue={session && session.targets.length > 1 ? { index: session.index, total: session.targets.length } : null}
          onClose={closeSession}
          onChanged={() => void refreshAfterRecognition()}
          onManualCreate={() => openManualCreate(currentTarget)}
          onMatched={() => { advanceSession(); void refreshAfterRecognition(); }}
          onSkip={session && session.targets.length > 1 ? advanceSession : undefined}
        />
      ) : null}
    </div>
  );
}
