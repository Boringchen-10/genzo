import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../components/common";
import { WorkCard } from "../components/WorkCard";
import type { WorkListItem } from "../types";
import { getErrorMessage } from "../utils";

export function FavoritesPage() {
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setWorks((await api.listWorks()).filter((work) => work.favorite)); }
    catch (reason: unknown) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => void load(), [load]);
  const filtered = useMemo(() => works.filter((work) => !query.trim() || `${work.title} ${work.originalTitle ?? ""}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN"))), [query, works]);
  return <div className="page workspace-page gnz-favorites-page">
    <PageHeader title="收藏" description={`${works.length} 部收藏作品`} actions={<div className="search-box gnz-header-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索收藏" aria-label="搜索收藏"/></div>} />
    {loading ? <LoadingState label="正在读取收藏"/> : null}
    {!loading && error ? <ErrorState message={error} retry={() => void load()}/> : null}
    {!loading && !error && !filtered.length ? <EmptyState title={works.length ? "没有符合条件的收藏" : "还没有收藏作品"} description={works.length ? "换一个关键词再试。" : "在作品编辑中开启收藏后，会显示在这里。"} action={<Heart size={18}/>}/> : null}
    {!loading && !error && filtered.length ? <div className="work-grid gnz-favorite-grid">{filtered.map((work) => <WorkCard key={work.id} work={work}/>)}</div> : null}
  </div>;
}
