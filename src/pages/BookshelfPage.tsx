import { useCallback, useEffect, useMemo, useState } from "react";
import { useSyncRefresh } from "../useSyncRefresh";
import { BookOpen, Grid2X2, Heart, List, RefreshCw, Search, Star } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  bookshelfGroupCounts,
  bookshelfGroupLabels,
  bookshelfGroups,
  filterBookshelfWorks,
  resolveBookshelfGroup,
  type BookshelfGroup,
} from "../bookshelf";
import { EmptyState, ErrorState, IconButton, LoadingState, PageHeader } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { BookInbox } from "../components/BookInbox";
import { dataProvider as api } from "../data";
import { usePreferences } from "../store";
import type { WorkListItem, WorkStatus } from "../types";
import { useSessionState } from "../useSessionState";
import { formatDate, getErrorMessage, statusLabels, workDetailPath } from "../utils";

type ShelfSection = "shelf" | "inbox";
type GroupFilter = BookshelfGroup | "all";
type StatusFilter = WorkStatus | "all";
type Scope = "all" | "recent" | "favorites" | "missing";
type SortKey = "updatedAt" | "createdAt" | "title";

const statusOptions: StatusFilter[] = ["all", "in_progress", "planned", "completed", "paused", "dropped"];
export function BookshelfPage() {
  const [params, setParams] = useSearchParams();
  const section: ShelfSection = params.get("tab") === "inbox" ? "inbox" : "shelf";
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useSessionState<string>("bookshelf.search", "");
  const [group, setGroup] = useSessionState<GroupFilter>("bookshelf.group", "all");
  const [status, setStatus] = useSessionState<StatusFilter>("bookshelf.status", "all");
  const [tag, setTag] = useSessionState<string>("bookshelf.tag", "all");
  const [sort, setSort] = useSessionState<SortKey>("bookshelf.sort", "updatedAt");
  const [favoriteOnly, setFavoriteOnly] = useSessionState<boolean>("bookshelf.favoriteOnly", false);
  const scopeParam = params.get("scope");
  const scope: Scope = scopeParam === "recent" || scopeParam === "favorites" || scopeParam === "missing" ? scopeParam : "all";
  const view = usePreferences((state) => state.libraryView);
  const setView = usePreferences((state) => state.setLibraryView);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError("");
    try {
      const nextWorks = await api.listWorks();
      setWorks(nextWorks);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useSyncRefresh(() => void load(true));

  const setSection = (next: ShelfSection) => {
    setParams(previous => {
      const params = new URLSearchParams(previous);
      if (next === "inbox") params.set("tab", "inbox");
      else params.delete("tab");
      return params;
    }, { replace: true });
  };

  const setScope = (next: Scope) => setParams(previous => {
    const params = new URLSearchParams(previous);
    if (next === "all") params.delete("scope");
    else params.set("scope", next);
    return params;
  }, { replace: true });

  const counts = useMemo(() => bookshelfGroupCounts(works), [works]);
  const shelfWorks = useMemo(() => filterBookshelfWorks(works, group), [works, group]);
  const tags = useMemo(() => Array.from(new Set(shelfWorks.flatMap(work => work.tags))).sort((a, b) => a.localeCompare(b, "zh-CN")), [shelfWorks]);

  /* 恢复的标签可能已被删掉或改名，回退到「全部标签」，避免留下选不中的空筛选。 */
  useEffect(() => {
    if (tag !== "all" && !tags.includes(tag)) setTag("all");
  }, [tags, tag, setTag]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return shelfWorks
      .filter((work) => !needle || `${work.title} ${work.originalTitle ?? ""} ${work.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(needle))
      .filter((work) => status === "all" || work.status === status)
      .filter((work) => !favoriteOnly || work.favorite)
      .filter((work) => tag === "all" || work.tags.includes(tag))
      .filter((work) => scope === "all" || (scope === "favorites" && work.favorite) || (scope === "missing" && work.missingCount > 0) || (scope === "recent" && new Date(work.createdAt).getTime() >= recentThreshold))
      .sort((left, right) => sort === "title" ? left.title.localeCompare(right.title, "zh-CN", { numeric: true }) : new Date(right[sort]).getTime() - new Date(left[sort]).getTime());
  }, [shelfWorks, search, status, favoriteOnly, tag, scope, sort]);

  const totalReadable = counts.comic + counts.lightnovel + counts.artbook + counts.novel;

  return (
    <div className="page workspace-page gnz-bookshelf-page">
      <PageHeader
        title="书架"
        description={section === "shelf" ? `${totalReadable} 部读物 · ${filtered.length} 部符合当前筛选` : "按目录选择阅读文件并归档作品"}
        actions={
          <IconButton tooltip="刷新书架" onClick={() => void load()}>
            <RefreshCw size={16} />
          </IconButton>
        }
      />

      <div className="gnz-primary-tabs gnz-library-tabs" role="tablist" aria-label="书架页面">
        <button type="button" role="tab" aria-selected={section === "shelf"} className={section === "shelf" ? "active" : ""} onClick={() => setSection("shelf")}>书架</button>
        <button type="button" role="tab" aria-selected={section === "inbox"} className={section === "inbox" ? "active" : ""} onClick={() => setSection("inbox")}>待整理</button>
      </div>

      {section === "shelf" ? <div className="library-toolbar">
        <div className="search-box">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、标签或原始标题" aria-label="搜索书架" />
        </div>
        <select value={group} aria-label="读物类型" onChange={(event) => setGroup(event.target.value as GroupFilter)}>
          <option value="all">全部读物 {totalReadable}</option>
          {bookshelfGroups.map((key) => <option key={key} value={key}>{bookshelfGroupLabels[key]} {counts[key]}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="阅读状态">
          {statusOptions.map((key) => <option key={key} value={key}>{key === "all" ? "全部状态" : statusLabels[key]}</option>)}
        </select>
        <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="标签筛选">
          <option value="all">全部标签</option>
          {tags.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="排序方式">
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
      </div> : null}

      {section === "shelf" ? <div className="scope-tabs" role="tablist" aria-label="书架范围">
        {([["all", "全部"], ["recent", "最近添加"], ["favorites", "收藏"], ["missing", "文件缺失"]] as const).map(([value, label]) => (
          <button key={value} type="button" className={scope === value ? "active" : ""} onClick={() => setScope(value)}>{label}</button>
        ))}
      </div> : null}

      {loading ? <LoadingState label="正在读取书架" /> : null}
      {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}

      {!loading && !error && section === "shelf" && filtered.length > 0 && view === "grid" ? (
        <div className="gnz-shelf-grid">
          {filtered.map((work) => {
            const resolved = resolveBookshelfGroup(work);
            return (
              <Link className="gnz-shelf-card" to={workDetailPath(work)} key={work.id}>
                <div className="gnz-shelf-poster">
                  <MediaVisual type={work.type} coverPath={work.coverPath} thumbnailPath={work.coverThumbnailPath} alt={`${work.title} 封面`} />
                  <span className="gnz-shelf-type">{bookshelfGroupLabels[resolved ?? "comic"]}</span>
                  {work.favorite ? <span className="gnz-shelf-fav" aria-hidden="true"><Star size={15} fill="currentColor" /></span> : null}
                </div>
                <strong>{work.title}</strong>
                <small>{work.mediaCount} 个文件 · {statusLabels[work.status]}</small>
              </Link>
            );
          })}
        </div>
      ) : null}

      {!loading && !error && section === "shelf" && filtered.length > 0 && view === "list" ? (
        <div className="work-list">
          <div className="work-list-head"><span>作品</span><span>类型</span><span>标签</span><span>文件</span><span>更新</span></div>
          {filtered.map((work) => (
            <Link className="work-list-row" to={workDetailPath(work)} key={work.id}>
              <div className="work-list-title"><div className="mini-cover"><MediaVisual type={work.type} coverPath={work.coverPath} alt="" /></div><div><strong>{work.title}</strong><small>{work.originalTitle || "无原始标题"}</small></div></div>
              <span>{bookshelfGroupLabels[resolveBookshelfGroup(work) ?? "comic"]}</span>
              <span className="tag-cell">{work.tags.length ? work.tags.slice(0, 2).join(" · ") : "—"}</span>
              <span className={work.missingCount ? "warning-text" : ""}>{work.mediaCount}{work.missingCount ? `（${work.missingCount} 缺失）` : ""}</span>
              <span>{formatDate(work.updatedAt).split(" ")[0]}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {!loading && !error && section === "shelf" && !filtered.length ? (
        <EmptyState
          title={shelfWorks.length ? "没有符合条件的读物" : "书架上还没有读物"}
          description={shelfWorks.length ? "换一个读物类型、阅读状态、范围或关键词再试。" : "把漫画、轻小说、画集或小说的目录加入资源库并完成识别后，会在这里显示。"}
          action={<BookOpen size={18} />}
        />
      ) : null}

      {!loading && !error && section === "inbox" ? <BookInbox /> : null}
    </div>
  );
}
