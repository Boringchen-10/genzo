import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookInbox } from "../components/BookInbox";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../components/common";
import { WorkCard } from "../components/WorkCard";
import { dataProvider as api } from "../data";
import type { WorkListItem } from "../types";
import { getErrorMessage } from "../utils";
import "../resource-library.css";

export function BookshelfPage() {
  const [params, setParams] = useSearchParams();
  const inbox = params.get("tab") === "inbox";
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextWorks = await api.listWorks();
      setWorks(nextWorks);
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, inbox]);
  const needle = search.trim().toLocaleLowerCase("zh-CN");
  const bookWorks = useMemo(() => works.filter(work => work.type === "comic" || work.type === "novel"), [works]);
  const visibleWorks = bookWorks.filter(work => !needle || work.title.toLocaleLowerCase("zh-CN").includes(needle));
  const changeTab = (nextInbox: boolean) => setParams(nextInbox ? { tab: "inbox" } : {}, { replace: true });

  return <div className="page workspace-page">
    <PageHeader title="书架" description="漫画与小说作品，以及尚未归档的阅读文件。" />
    <div className="scope-tabs" role="tablist" aria-label="书架页面">
      <button type="button" role="tab" aria-selected={!inbox} className={!inbox ? "active" : ""} onClick={() => changeTab(false)}>作品 {bookWorks.length}</button>
      <button type="button" role="tab" aria-selected={inbox} className={inbox ? "active" : ""} onClick={() => changeTab(true)}>待整理</button>
    </div>
    <div className="bookshelf-toolbar"><input aria-label="搜索书架" placeholder={inbox ? "搜索待整理文件" : "搜索书架作品"} value={search} onChange={event => setSearch(event.target.value)} /><button type="button" className="button secondary compact" onClick={() => void load()} disabled={loading}>刷新</button></div>
    {loading ? <LoadingState /> : error ? <ErrorState message={error} retry={() => void load()} /> : inbox ? <BookInbox /> : visibleWorks.length ? <div className="work-grid">{visibleWorks.map(work => <WorkCard key={work.id} work={work} />)}</div> : <EmptyState title="书架还没有作品" description="扫描阅读目录后，在待整理中建立漫画或小说作品。" />}
  </div>;
}
