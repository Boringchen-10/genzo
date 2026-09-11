import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, FileQuestion, FolderTree, Grid2X2, Heart, List, Plus, Search, Sparkles, Star } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { WorkCard } from "../components/WorkCard";
import { WorkForm } from "../components/WorkForm";
import { RecognitionDialog } from "../components/RecognitionDialog";
import { usePreferences, useToasts } from "../store";
import type { MediaType, RecognitionSummary, UnassignedMediaGroup, WorkInput, WorkListItem } from "../types";
import { formatDate, formatSize, getErrorMessage, mediaLabels } from "../utils";

type Scope = "all" | "recent" | "favorites" | "missing";
type SortKey = "title" | "createdAt" | "updatedAt";

export function LibraryPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialScope = (params.get("scope") as Scope | null) ?? "all";
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [unassignedGroups, setUnassignedGroups] = useState<UnassignedMediaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>(["all", "recent", "favorites", "missing"].includes(initialScope) ? initialScope : "all");
  const [mediaType, setMediaType] = useState<MediaType | "all">("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState<SortKey>("updatedAt");
  const [showCreate, setShowCreate] = useState(false);
  const [organizingGroup, setOrganizingGroup] = useState<UnassignedMediaGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [recognizingGroup, setRecognizingGroup] = useState<UnassignedMediaGroup | null>(null);
  const [batchRecognizing, setBatchRecognizing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [unassignedLimit, setUnassignedLimit] = useState(100);
  const view = usePreferences((state) => state.libraryView);
  const setView = usePreferences((state) => state.setLibraryView);
  const toast = useToasts((state) => state.push);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextWorks, nextUnassignedGroups] = await Promise.all([
        api.listWorks(),
        api.listUnassignedGroups(),
      ]);
      setWorks(nextWorks);
      setUnassignedGroups(nextUnassignedGroups);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

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

  const filteredUnassigned = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
    const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return unassignedGroups
      .filter((group) => !normalizedSearch || group.title.toLocaleLowerCase("zh-CN").includes(normalizedSearch) || (group.folderPath ?? group.representative.path).toLocaleLowerCase("zh-CN").includes(normalizedSearch))
      .filter((group) => mediaType === "all" || group.mediaType === mediaType)
      .filter(() => !favoriteOnly && tag === "all")
      .filter((group) => scope === "all" || (scope === "missing" && group.missingCount > 0) || (scope === "recent" && new Date(group.representative.createdAt).getTime() >= recentThreshold));
  }, [unassignedGroups, search, mediaType, favoriteOnly, tag, scope]);
  const visibleUnassigned = filteredUnassigned.slice(0, unassignedLimit);
  const unassignedFileCount = filteredUnassigned.reduce((total, group) => total + group.fileCount, 0);

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
    const targets = unassignedGroups.filter((group) => group.mediaType === "video" && group.missingCount < group.fileCount && group.recognitionStatus !== "matched");
    const result: RecognitionSummary = { scanned: 0, matched: 0, pending: 0, unmatched: 0, errors: 0 };
    setBatchProgress({ current: 0, total: targets.length });
    for (const [index, group] of targets.entries()) {
      try {
        const item = await api.recognizeMedia(group.representative.id);
        result.scanned += 1;
        if (item.status === "matched") result.matched += 1;
        else if (item.status === "candidate_pending") result.pending += 1;
        else if (item.status === "error") result.errors += 1;
        else result.unmatched += 1;
      } catch { result.scanned += 1; result.errors += 1; }
      setBatchProgress({ current: index + 1, total: targets.length });
    }
    toast(`识别 ${result.scanned} 个文件：匹配 ${result.matched}，待确认 ${result.pending}，未匹配 ${result.unmatched}，失败 ${result.errors}`, result.errors ? "info" : "success");
    await load();
    setBatchProgress(null); setBatchRecognizing(false);
  };

  return (
    <div className="page workspace-page page-library">
      <PageHeader
        title="媒体库"
        description={`${filtered.length} / ${works.length} 部作品 · ${filteredUnassigned.length} 个待整理目录或文件`}
        actions={<><button type="button" className="button secondary icon-text" disabled={batchRecognizing || !unassignedGroups.some((group) => group.mediaType === "video" && group.missingCount < group.fileCount)} onClick={() => void recognizeAll()}><Sparkles size={17} />{batchProgress ? `识别 ${batchProgress.current}/${batchProgress.total}` : "批量识别动漫"}</button><button type="button" className="button primary icon-text" onClick={() => setShowCreate(true)}><Plus size={17} />新建作品</button></>}
      />
      <div className="library-toolbar">
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
        <button type="button" className={`filter-toggle ${favoriteOnly ? "active" : ""}`} onClick={() => setFavoriteOnly(!favoriteOnly)} aria-pressed={favoriteOnly}>
          <Heart size={16} fill={favoriteOnly ? "currentColor" : "none"} /> 收藏
        </button>
        <div className="segmented" aria-label="显示方式">
          <button type="button" data-tooltip="海报网格" aria-label="海报网格" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid2X2 size={16} /></button>
          <button type="button" data-tooltip="列表" aria-label="列表" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={17} /></button>
        </div>
      </div>
      <div className="scope-tabs" role="tablist" aria-label="媒体库范围">
        {([['all', '全部'], ['recent', '最近添加'], ['favorites', '收藏'], ['missing', '文件缺失']] as const).map(([value, label]) => (
          <button key={value} type="button" className={scope === value ? "active" : ""} onClick={() => setScope(value)}>{label}</button>
        ))}
      </div>

      {!loading && !error && filteredUnassigned.length > 0 ? (
        <section className="unassigned-section">
          <div className="section-heading">
            <div><h2>待整理内容</h2><span>{filteredUnassigned.length} 个目录或散文件，共 {unassignedFileCount} 个媒体文件；目录内文件会一起整理。</span></div>
          </div>
          <div className="unassigned-table">
            <div className="unassigned-head"><span>目录或文件</span><span>类型</span><span>内容</span><span>识别状态</span><span>操作</span></div>
            {visibleUnassigned.map((group) => {
              const unavailable = group.missingCount >= group.fileCount;
              return <div className="unassigned-row" key={group.key}>
                <div className="unassigned-name">{group.folderPath ? <FolderTree size={18} /> : <FileQuestion size={18} />}<div><strong>{group.title}</strong><small>{group.folderPath ?? group.representative.path}</small></div></div>
                <span>{mediaLabels[group.mediaType]}</span>
                <span>{group.fileCount} 个 · {formatSize(group.totalSize)}</span>
                <span className={unavailable || group.recognitionStatus === "error" ? "warning-text" : group.recognitionStatus === "candidate_pending" ? "candidate-text" : "available-text"}>{unavailable ? "全部缺失" : group.missingCount ? `${group.missingCount} 个缺失` : group.recognitionStatus === "candidate_pending" ? "等待确认" : group.recognitionStatus === "error" ? "识别失败" : "未匹配"}</span>
                <div className="unassigned-actions">{group.mediaType === "video" ? <button type="button" className="button secondary compact" onClick={() => setRecognizingGroup(group)} disabled={unavailable}>{group.recognitionStatus === "candidate_pending" ? "查看候选" : "识别"}</button> : null}<button type="button" className="button secondary compact" onClick={() => setOrganizingGroup(group)} disabled={unavailable}>手动整理</button></div>
              </div>
            })}
          </div>
          {visibleUnassigned.length < filteredUnassigned.length ? <button type="button" className="show-more-button" onClick={() => setUnassignedLimit((limit) => limit + 100)}><ChevronDown size={15} />再显示 {Math.min(100, filteredUnassigned.length - visibleUnassigned.length)} 项</button> : null}
        </section>
      ) : null}

      {loading ? <LoadingState label="正在读取作品" /> : null}
      {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
      {!loading && !error && filtered.length === 0 && filteredUnassigned.length === 0 ? (
        <EmptyState
          title={works.length ? "没有符合条件的作品" : "还没有作品记录"}
          description={works.length ? "调整搜索词或筛选条件后再试。" : "你可以手动创建作品，或先扫描本地目录。"}
          action={!works.length ? <button type="button" className="button primary" onClick={() => setShowCreate(true)}>新建作品</button> : undefined}
        />
      ) : null}
      {!loading && !error && filtered.length > 0 && view === "grid" ? (
        <div className="work-grid">{filtered.map((work) => <WorkCard key={work.id} work={work} />)}</div>
      ) : null}
      {!loading && !error && filtered.length > 0 && view === "list" ? (
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
