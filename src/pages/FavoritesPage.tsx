import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { dataProvider as api } from "../data";
import { EmptyState, ErrorState, LoadingState } from "../components/common";
import { WorkCard } from "../components/WorkCard";
import type { WorkListItem } from "../types";
import { getErrorMessage } from "../utils";
import { matchesLibraryCategory } from "../libraryCategory";
import "../favorites.css";
import { useSyncRefresh } from "../useSyncRefresh";

const categories = [["all", "全部"], ["anime", "动漫"], ["movie", "电影"], ["tv", "电视剧"], ["comic", "漫画"], ["novel", "小说"], ["game", "游戏"]] as const;

export function FavoritesPage() {
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const category = categories.find(([value]) => value === params.get("category"))?.[0] ?? "all";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true); setError("");
    try { setWorks((await api.listWorks()).filter((work) => work.favorite)); }
    catch (reason: unknown) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => void load(), [load]);
  useSyncRefresh(() => void load(true));
  const filtered = useMemo(() => works.filter((work) => matchesLibraryCategory(work, category) && (!query.trim() || `${work.title} ${work.originalTitle ?? ""}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")))), [category, query, works]);
  return <div className="page workspace-page gnz-favorites-page">
    <header className="page-header gnz-favorites-header">
      <div className="gnz-favorites-title">
        <h1>收藏</h1>
        <div className="gnz-favorites-filters">
          <p>{filtered.length} 部收藏作品</p>
          <div className="scope-tabs" role="group" aria-label="收藏分类">
            {categories.map(([value, label]) => <button key={value} type="button" className={category === value ? "active" : ""} aria-pressed={category === value} onClick={() => setParams(previous => {
              const next = new URLSearchParams(previous);
              if (value === "all") next.delete("category"); else next.set("category", value);
              return next;
            })}>{label}</button>)}
          </div>
        </div>
      </div>
      <div className="page-actions"><div className="search-box gnz-header-search"><Search size={16}/><input value={query} onChange={(event) => {
        const value = event.target.value;
        setParams(previous => {
          const next = new URLSearchParams(previous);
          if (value) next.set("q", value); else next.delete("q");
          return next;
        }, { replace: true });
      }} placeholder="搜索收藏" aria-label="搜索收藏"/></div></div>
    </header>
    {loading ? <LoadingState label="正在读取收藏"/> : null}
    {!loading && error ? <ErrorState message={error} retry={() => void load()}/> : null}
    {!loading && !error && !filtered.length ? <EmptyState title={works.length ? "没有符合条件的收藏" : "还没有收藏作品"} description={works.length ? "切换分类或换一个关键词再试。" : "在作品编辑中开启收藏后，会显示在这里。"} action={<Heart size={18}/>}/> : null}
    {!loading && !error && filtered.length ? <div className="work-grid gnz-favorite-grid">{filtered.map((work) => <WorkCard key={work.id} work={work}/>)}</div> : null}
  </div>;
}
