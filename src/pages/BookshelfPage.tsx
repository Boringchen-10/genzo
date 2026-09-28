import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookImportPanel } from "../components/BookImportPanel";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../components/common";
import { WorkCard } from "../components/WorkCard";
import { dataProvider as api } from "../data";
import type { UnassignedMediaGroup, WorkListItem } from "../types";
import { getErrorMessage, mediaLabels } from "../utils";
import "../resource-library.css";

export function BookshelfPage() {
  const [params, setParams] = useSearchParams();
  const inbox = params.get("tab") === "inbox";
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [groups, setGroups] = useState<UnassignedMediaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<{ id: string; request: number } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextWorks, nextGroups, roots] = await Promise.all([api.listWorks(), api.listUnassignedGroups(), api.listRoots()]);
      const rootIds = new Set(roots.map(root => root.id));
      setWorks(nextWorks);
      setGroups(nextGroups.filter(group => group.representative.libraryRootId !== null && rootIds.has(group.representative.libraryRootId)));
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, inbox]);
  const needle = search.trim().toLocaleLowerCase("zh-CN");
  const bookWorks = useMemo(() => works.filter(work => work.type === "comic" || work.type === "novel"), [works]);
  const pending = useMemo(() => groups.filter(group => group.destination === "bookshelf"), [groups]);
  const visibleWorks = bookWorks.filter(work => !needle || work.title.toLocaleLowerCase("zh-CN").includes(needle));
  const visibleGroups = pending.filter(group => !needle || `${group.title} ${group.folderPath ?? group.representative.path}`.toLocaleLowerCase("zh-CN").includes(needle));
  const changeTab = (nextInbox: boolean) => setParams(nextInbox ? { tab: "inbox" } : {}, { replace: true });

  return <div className="page workspace-page">
    <PageHeader title="书架" description="漫画与小说作品，以及尚未归档的阅读文件。" />
    <div className="scope-tabs" role="tablist" aria-label="书架页面">
      <button type="button" role="tab" aria-selected={!inbox} className={!inbox ? "active" : ""} onClick={() => changeTab(false)}>作品 {bookWorks.length}</button>
      <button type="button" role="tab" aria-selected={inbox} className={inbox ? "active" : ""} onClick={() => changeTab(true)}>待整理 {pending.length}</button>
    </div>
    <div className="bookshelf-toolbar"><input aria-label="搜索书架" placeholder={inbox ? "搜索待整理文件" : "搜索书架作品"} value={search} onChange={event => setSearch(event.target.value)} /><button type="button" className="button secondary compact" onClick={() => void load()} disabled={loading}>刷新</button></div>
    {loading ? <LoadingState /> : error ? <ErrorState message={error} retry={() => void load()} /> : inbox ? <>
      <BookImportPanel focusMediaFileId={focus?.id} focusRequest={focus?.request} />
      {visibleGroups.length ? <div className="resource-routing-list">{visibleGroups.map(group => <div className="resource-routing-row" key={group.key}><div><strong>{group.title}</strong><small>{mediaLabels[group.mediaType]} · {group.fileCount} 个文件 · {group.folderPath ?? group.representative.path}</small></div><button type="button" className="button compact secondary" onClick={() => setFocus(previous => ({ id: group.representative.id, request: (previous?.request ?? 0) + 1 }))}>识别并整理</button><Link to="/sources">在资源库更改目录归属</Link></div>)}</div> : <EmptyState title="没有待整理的阅读文件" description="在资源库添加漫画或小说目录并扫描后，文件会显示在这里。" />}
    </> : visibleWorks.length ? <div className="work-grid">{visibleWorks.map(work => <WorkCard key={work.id} work={work} />)}</div> : <EmptyState title="书架还没有作品" description="扫描阅读目录后，在待整理中建立漫画或小说作品。" />}
  </div>;
}
