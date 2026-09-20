import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileQuestion, FolderTree, Grid2X2, Heart, List, Plus, Search, Sparkles, Star } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { dataProvider as api } from "../data";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { WorkCard } from "../components/WorkCard";
import { WorkForm } from "../components/WorkForm";
import { RecognitionDialog } from "../components/RecognitionDialog";
import { ScanPage } from "./ScanPage";
import { usePreferences, useToasts } from "../store";
import type { LibraryRoot, MediaFile, MediaType, RecognitionStatus, RecognitionSummary, UnassignedMediaGroup, WorkInput, WorkListItem } from "../types";
import { formatDate, formatSize, getErrorMessage, mediaLabels, unassignedStatusRank } from "../utils";
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
  group: UnassignedMediaGroup | null;
  file: MediaFile | null;
}

const inboxStatusLabel = (status: RecognitionStatus, missingCount: number, fileCount: number) => {
  if (fileCount > 0 && missingCount >= fileCount) return "全部缺失";
  if (status === "candidate_pending") return "等待确认";
  if (status === "error") return "识别失败";
  return "未匹配";
};

const inboxStatusClass = (status: RecognitionStatus, missingCount: number, fileCount: number) => {
  if (fileCount > 0 && missingCount >= fileCount) return "warning-text";
  if (status === "error") return "warning-text";
  if (status === "candidate_pending") return "candidate-text";
  return "available-text";
};

export function LibraryPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
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
  const [organizingGroup, setOrganizingGroup] = useState<UnassignedMediaGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkingFiles, setLinkingFiles] = useState<MediaFile[] | null>(null);
  const [workSearch, setWorkSearch] = useState("");
  const [recognizingGroup, setRecognizingGroup] = useState<UnassignedMediaGroup | null>(null);
  const [batchRecognizing, setBatchRecognizing] = useState(false);
  const [unassignedLimit, setUnassignedLimit] = useState(100);
  const [inboxPath, setInboxPath] = useState<string | null>(null);
  const [inboxMedia, setInboxMedia] = useState<MediaFile[]>([]);
  const [inboxMediaLoading, setInboxMediaLoading] = useState(false);
  const view = usePreferences((state) => state.libraryView);
  const setView = usePreferences((state) => state.setLibraryView);
  const toast = useToasts((state) => state.push);

  const load = useCallback(async () => {
    setLoading(true);
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
      .filter((work) => mediaType === "all" || work.type === mediaType)
      .filter((work) => !favoriteOnly || work.favorite)
      .filter((work) => tag === "all" || work.tags.includes(tag))
      .filter((work) => scope === "all" || (scope === "favorites" && work.favorite) || (scope === "missing" && work.missingCount > 0) || (scope === "recent" && new Date(work.createdAt).getTime() >= recentThreshold))
      .sort((left, right) => sort === "title" ? left.title.localeCompare(right.title, "zh-CN", { numeric: true }) : new Date(right[sort]).getTime() - new Date(left[sort]).getTime());
  }, [works, search, mediaType, favoriteOnly, tag, scope, sort]);

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
    const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return scopedUnassigned
      .filter((group) => !normalizedSearch || group.title.toLocaleLowerCase("zh-CN").includes(normalizedSearch) || (group.folderPath ?? group.representative.path).toLocaleLowerCase("zh-CN").includes(normalizedSearch))
      .filter((group) => mediaType === "all" || group.mediaType === mediaType)
      .filter(() => !favoriteOnly && tag === "all")
      .filter((group) => scope === "all" || (scope === "missing" && group.missingCount > 0) || (scope === "recent" && new Date(group.representative.createdAt).getTime() >= recentThreshold))
      .sort((left, right) => {
        if (unassignedSort === "fileCount") return right.fileCount - left.fileCount || left.title.localeCompare(right.title, "zh-CN", { numeric: true });
        if (unassignedSort === "title") return left.title.localeCompare(right.title, "zh-CN", { numeric: true });
        return unassignedStatusRank(left.recognitionStatus, left.missingCount, left.fileCount) - unassignedStatusRank(right.recognitionStatus, right.missingCount, right.fileCount) || left.title.localeCompare(right.title, "zh-CN", { numeric: true });
      });
  }, [scopedUnassigned, search, mediaType, favoriteOnly, tag, scope, unassignedSort]);
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

  /* 进入待整理或作品组刷新后重新取文件列表，避免关联成功后仍显示旧文件。
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
  }, [activeSection, unassignedGroups, toast]);

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
            status: "unmatched" as RecognitionStatus,
            group: null,
            file: null,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
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
        group: null,
        file: null,
      };
      if (group) {
        entry.group = group;
        entry.status = group.recognitionStatus;
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
          group: null,
          file,
        });
        continue;
      }
      const entry = touchFolder(segment, null);
      if (!entry.group) {
        entry.fileCount += 1;
        if (file.missing) entry.missingCount += 1;
      }
    }

    return [
      ...Array.from(folders.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true })),
      ...files.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true })),
    ];
  }, [inboxPath, roots, filteredUnassigned, scopedFiles]);

  /** 当前文件夹本身就是一个作品组时，把识别 / 手动整理操作放在这一级。 */
  const inboxGroupHere = useMemo(() => {
    if (inboxPath === null) return null;
    const prefix = normalizePath(inboxPath);
    return filteredUnassigned.find((group) => normalizePath(group.folderPath ?? group.representative.path) === prefix) ?? null;
  }, [inboxPath, filteredUnassigned]);

  const openInboxFile = async (file: MediaFile) => {
    try {
      await api.launchMedia(file.id, null, true);
    } catch (launchError: unknown) {
      toast(getErrorMessage(launchError), "error");
    }
  };
  const currentInboxFiles = inboxPath === null ? [] : scopedFiles.filter(file => pathChildSegment(inboxPath, file.path) !== null);
  const attachToExisting = async (workId: string) => {
    if (!linkingFiles) return;
    setSaving(true);
    try {
      await api.attachMediaFiles(workId, linkingFiles.map(file => file.id));
      setInboxMedia(files => files.filter(file => !linkingFiles.some(selected => selected.id === file.id)));
      setLinkingFiles(null);
      toast(`已关联 ${linkingFiles.length} 个文件到已有作品`, "success");
      await load();
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
    if (!organizingGroup) return;
    setSaving(true);
    try {
      const work = await api.createWorkFromMedia(organizingGroup.representative.id, input);
      setOrganizingGroup(null);
      toast(`作品已创建，已关联 ${organizingGroup.fileCount} 个文件`, "success");
      await load();
      navigate(`/library/${work.id}`);
    } catch (createError: unknown) {
      toast(getErrorMessage(createError), "error");
    } finally {
      setSaving(false);
    }
  };

  const suggestedTitle = organizingGroup?.title ?? "";

  const recognizeAll = async () => {
    setBatchRecognizing(true);
    try {
      const result: RecognitionSummary = await api.recognizeUnmatched();
      toast(`识别 ${result.scanned} 个作品组：匹配 ${result.matched}，待确认 ${result.pending}，未匹配 ${result.unmatched}，失败 ${result.errors}`, result.errors ? "info" : "success");
      await load();
    } catch (recognizeError: unknown) {
      toast(getErrorMessage(recognizeError), "error");
    } finally {
      setBatchRecognizing(false);
    }
  };

  return (
    <div className="page workspace-page page-library">
      <PageHeader
        title="媒体库"
        description={`${works.length} 部作品 · ${filteredUnassigned.length} 个待整理作品组`}
        actions={activeSection === "inbox"
          ? <button type="button" className="button secondary icon-text" disabled={batchRecognizing || !scopedUnassigned.some((group) => group.mediaType === "video" && group.missingCount < group.fileCount)} onClick={() => void recognizeAll()}><Sparkles size={17} />{batchRecognizing ? "正在按作品组识别" : "批量识别动漫"}</button>
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
        <select value={mediaType} onChange={(e) => setMediaType(e.target.value as MediaType | "all")} aria-label="媒体类型">
          <option value="all">全部类型</option>
          {(Object.keys(mediaLabels) as MediaType[]).map((type) => <option key={type} value={type}>{mediaLabels[type]}</option>)}
        </select>
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
            <select className="unassigned-sort" value={unassignedSort} onChange={(event) => setUnassignedSort(event.target.value as UnassignedSortKey)} aria-label="待整理内容排序">
              <option value="status">按识别状态</option>
              <option value="title">按标题</option>
              <option value="fileCount">按文件数量</option>
            </select>
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

          {currentInboxFiles.length ? <div className="inbox-group-row"><span>当前目录及子目录：{currentInboxFiles.length} 个待整理文件</span><button type="button" className="button secondary compact" disabled={inboxMediaLoading} onClick={() => { setWorkSearch(""); setLinkingFiles(currentInboxFiles); }}>关联已有作品</button></div> : null}

          {inboxGroupHere ? (
            <div className="inbox-group-row">
              <div>
                <strong>{inboxGroupHere.title}</strong>
                <small>{mediaLabels[inboxGroupHere.mediaType]} · {inboxGroupHere.fileCount} 个文件 · {inboxStatusLabel(inboxGroupHere.recognitionStatus, inboxGroupHere.missingCount, inboxGroupHere.fileCount)}</small>
              </div>
              <div className="inbox-actions">
                {inboxGroupHere.mediaType === "video" ? <button type="button" className="button secondary compact" onClick={() => setRecognizingGroup(inboxGroupHere)} disabled={inboxGroupHere.missingCount >= inboxGroupHere.fileCount}>{inboxGroupHere.recognitionStatus === "candidate_pending" ? "查看候选" : "识别"}</button> : null}
                <button type="button" className="button secondary compact" onClick={() => setOrganizingGroup(inboxGroupHere)} disabled={inboxGroupHere.missingCount >= inboxGroupHere.fileCount}>手动整理</button>
              </div>
            </div>
          ) : null}

          <div className="inbox-tree">
            <div className="inbox-tree-head"><span>名称</span><span>内容</span><span>识别状态</span><span>操作</span></div>
            {inboxMediaLoading ? <div className="inbox-empty">正在读取文件列表…</div> : null}
            {!inboxMediaLoading && inboxLevel.length === 0 ? <div className="inbox-empty">这个文件夹里没有待整理的内容。</div> : null}
            {inboxLevel.slice(0, unassignedLimit).map((entry) => entry.folder ? (
              <button type="button" className="inbox-folder" key={entry.key} onClick={() => setInboxPath(entry.path)}>
                <span className="inbox-name"><FolderTree size={18} /><span><strong>{entry.name}</strong><small title={entry.path}>{entry.path}</small></span></span>
                <span className="inbox-meta">{entry.fileCount} 个文件{entry.missingCount ? ` · ${entry.missingCount} 个缺失` : ""}</span>
                <span className={inboxStatusClass(entry.status, entry.missingCount, entry.fileCount)}>{inboxStatusLabel(entry.status, entry.missingCount, entry.fileCount)}</span>
                <span className="inbox-actions"><ChevronRight size={16} /></span>
              </button>
            ) : (
              <div className="inbox-file" key={entry.key}>
                <span className="inbox-name"><FileQuestion size={18} /><span><strong>{entry.file?.fileName ?? entry.name}</strong><small title={entry.path}>{entry.path}</small></span></span>
                <span className="inbox-meta">{entry.file ? `${mediaLabels[entry.file.mediaType]} · ${formatSize(entry.file.size)}` : ""}</span>
                <span className={entry.missingCount ? "warning-text" : "available-text"}>{entry.missingCount ? "文件缺失" : "未匹配"}</span>
                <span className="inbox-actions">
                  <button type="button" className="button secondary compact" onClick={() => { if (entry.file) { setWorkSearch(""); setLinkingFiles([entry.file]); } }}>关联作品</button>
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
              <span>{mediaLabels[work.type]}</span>
              <span className="tag-cell">{work.tags.length ? work.tags.slice(0, 2).join(" · ") : "—"}</span>
              <span className={work.missingCount ? "warning-text" : ""}>{work.mediaCount}{work.missingCount ? `（${work.missingCount} 缺失）` : ""}</span>
              <span>{formatDate(work.updatedAt).split(" ")[0]}</span>
              {work.rating !== null ? <span className="row-rating"><Star size={13} fill="currentColor" />{work.rating.toFixed(1)}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}

      {showCreate ? <Modal title="新建作品" width="large" onClose={() => setShowCreate(false)}><WorkForm busy={saving} onCancel={() => setShowCreate(false)} onSubmit={create} /></Modal> : null}
      {linkingFiles ? <Modal title="关联已有作品" width="large" onClose={() => { if (!saving) setLinkingFiles(null); }}>
        <p className="quiet-inline">将 {linkingFiles.length} 个文件关联到所选作品，不会新建重复作品。个人记录保持不变。</p>
        <div className="search-box modal-search"><input value={workSearch} onChange={event => setWorkSearch(event.target.value)} placeholder="搜索媒体库中的作品" /></div>
        <div className="attach-list">{works.filter(work => `${work.title} ${work.originalTitle ?? ""}`.toLowerCase().includes(workSearch.trim().toLowerCase())).map(work => <div className="attach-row" key={work.id}><div><strong>{work.title}</strong><small>{work.originalTitle}</small></div><span>{mediaLabels[work.type]}</span><button type="button" className="button primary compact" disabled={saving} onClick={() => void attachToExisting(work.id)}>关联到此作品</button></div>)}</div>
        {!works.length ? <p className="quiet-inline">媒体库暂无作品，请先手动创建作品。</p> : null}
      </Modal> : null}
      {organizingGroup ? (
        <Modal title="整理为作品" width="large" onClose={() => setOrganizingGroup(null)}>
          <WorkForm
            key={organizingGroup.key}
            initialInput={{ title: suggestedTitle, type: organizingGroup.mediaType }}
            busy={saving}
            onCancel={() => setOrganizingGroup(null)}
            onSubmit={createFromMedia}
          />
        </Modal>
      ) : null}
      {recognizingGroup ? <RecognitionDialog media={recognizingGroup.representative} onClose={() => setRecognizingGroup(null)} onChanged={() => void load()} onManualCreate={() => { const group = recognizingGroup; setRecognizingGroup(null); setOrganizingGroup(group); }} onMatched={(workId) => { setRecognizingGroup(null); void load(); navigate(`/library/${workId}`); }} /> : null}
    </div>
  );
}
