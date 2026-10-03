import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, Heart, RefreshCw, Search, X } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { comicExploreApi, comicListParams, comicQueryFromParams, type ComicDetail, type ComicItem, type ComicPage, type ComicQuery, type ComicTheme } from "../comicExplore";
import { EmptyState, ErrorState, IconButton, LoadingState, Modal, useOffline } from "../components/common";
import { ResilientImage, RetryImagesButton } from "../components/ResilientImage";
import { getErrorMessage } from "../utils";
import "../comic-explore.css";

function ComicCover({ item, detail = false }: { item: ComicItem; detail?: boolean }) {
  return <div className={`comic-explore-cover${detail ? " is-detail" : ""}`}>
    <ResilientImage sources={[item.coverUrl]} alt={`${item.title} 封面`} fallback={<span className="comic-cover-placeholder"><BookOpen size={32} />暂无封面</span>} />
  </div>;
}

export function ComicExplorePage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const input = comicQueryFromParams(params);
  const listKey = JSON.stringify(input);
  const selectedId = params.get("comic");
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const offline = useOffline();
  const [query, setQuery] = useState(input.query);
  const [page, setPage] = useState<ComicPage | null>(null);
  const [themes, setThemes] = useState<ComicTheme[]>([]);
  const [themeError, setThemeError] = useState("");
  const [themesAttempt, setThemesAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const lastListRefresh = useRef(0);
  const [detail, setDetail] = useState<ComicDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRefresh, setDetailRefresh] = useState(0);
  const lastDetailRefresh = useRef(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => { setQuery(input.query); }, [input.query]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setPage(null);
    const force = lastListRefresh.current !== refresh;
    lastListRefresh.current = refresh;
    void comicExploreApi.list(JSON.parse(listKey) as ComicQuery, force)
      .then(value => { if (!cancelled) setPage(value); })
      .catch(reason => { if (!cancelled) setError(getErrorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listKey, refresh]);
  useEffect(() => {
    let cancelled = false;
    void comicExploreApi.themes().then(value => {
      if (!cancelled) { setThemes(value); setThemeError(""); }
    }).catch(reason => { if (!cancelled) setThemeError(getErrorMessage(reason)); });
    return () => { cancelled = true; };
  }, [themesAttempt]);
  useEffect(() => {
    let cancelled = false;
    setDetail(null); setDetailError(""); setSaveError(""); setSaving(false);
    const force = lastDetailRefresh.current !== detailRefresh;
    lastDetailRefresh.current = detailRefresh;
    if (selectedId) void comicExploreApi.detail(selectedId, force)
      .then(value => { if (!cancelled) setDetail(value); })
      .catch(reason => { if (!cancelled) setDetailError(getErrorMessage(reason)); });
    return () => { cancelled = true; };
  }, [selectedId, detailRefresh]);

  const changeList = (changes: Partial<ComicQuery>) => setParams(comicListParams({ ...input, page: 1, ...changes }));
  const search = (event: FormEvent) => {
    event.preventDefault(); changeList({ query: query.trim(), theme: "", top: "" });
  };
  const open = (item: ComicItem) => {
    const next = comicListParams(input); next.set("comic", item.pathWord);
    setParams(next, { state: { comicOverlay: true } });
  };
  const close = () => {
    if (location.state?.comicOverlay) navigate(-1);
    else setParams(comicListParams(input), { replace: true });
  };
  const save = async (favorite: boolean) => {
    if (!detail || saving) return;
    const id = detail.item.pathWord;
    setSaving(true); setSaveError("");
    try {
      const workId = await comicExploreApi.save(id, favorite);
      if (selectedRef.current !== id) return;
      setDetail(previous => previous && { ...previous, item: { ...previous.item, localWorkId: workId, favorite } });
      setPage(previous => previous && { ...previous, items: previous.items.map(item => item.pathWord === id ? { ...item, localWorkId: workId, favorite } : item) });
    } catch (reason) { if (selectedRef.current === id) setSaveError(getErrorMessage(reason)); }
    finally { if (selectedRef.current === id) setSaving(false); }
  };

  return <div className="page workspace-page gnz-explore-page comic-explore-page">
    <header className="gnz-compact-header">
      <div><strong>探索</strong><span>漫画 · 拷贝目录</span></div>
      <form className="search-box gnz-explore-search" role="search" onSubmit={search}>
        <Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索漫画作品" aria-label="搜索漫画作品" maxLength={200} />
        {input.query && <button type="button" className="gnz-explore-search-clear" aria-label="清除漫画搜索" onClick={() => changeList({ query: "" })}><X size={15} /></button>}
      </form>
      <IconButton tooltip="刷新漫画探索" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} /></IconButton>
    </header>
    <section className="gnz-explore-heading"><div><h1>探索漫画</h1><p>浏览作品资料，把喜欢的漫画加入书架。加入后可管理收藏、阅读状态，并手动补充 Bangumi 资料。</p></div></section>
    <div className="gnz-primary-tabs" role="tablist" aria-label="探索分类">
      <Link role="tab" aria-selected={false} to="/explore">推荐</Link>
      <Link role="tab" aria-selected={false} to="/explore?tab=seasonal">动漫</Link>
      <button type="button" role="tab" className="active" aria-selected>漫画</button>
    </div>
    {offline && <p className="comic-explore-notice" role="status">网络已断开，已缓存的作品资料仍可浏览。</p>}
    {page?.stale && <p className="comic-explore-notice" role="status">来源暂时不可用，当前显示上次缓存的资料。</p>}
    <section className="gnz-filter-preview" aria-label="漫画筛选">
      <div className="comic-explore-filters">
        <label>目录<select aria-label="漫画目录" value={input.top} disabled={!!input.query} onChange={event => changeList({ top: event.target.value })}>
          <option value="">全部漫画</option><option value="finish">已完结</option><option value="korea">韩漫</option><option value="west">美漫</option>
        </select></label>
        <label>题材<select aria-label="漫画题材" value={input.theme} disabled={!!input.query || !themes.length} onChange={event => changeList({ theme: event.target.value })}>
          <option value="">全部题材</option>{themes.map(theme => <option key={theme.pathWord} value={theme.pathWord}>{theme.name}</option>)}
        </select></label>
        <label>排序<select aria-label="漫画排序" value={input.sort} disabled={!!input.query} onChange={event => changeList({ sort: event.target.value as ComicQuery["sort"] })}>
          <option value="popular">热度</option><option value="updated">最近更新</option>
        </select></label>
        <RetryImagesButton />
      </div>
      {input.query && <p className="quiet-inline">正在搜索「{input.query}」，清除搜索后可使用目录筛选。</p>}
      {themeError && <p className="quiet-inline" role="status">题材暂时无法加载。<button className="button secondary compact" onClick={() => setThemesAttempt(value => value + 1)}>重试题材</button></p>}
    </section>
    {loading ? <LoadingState label="正在读取漫画目录" /> : error ? <ErrorState message={error} retry={() => setRefresh(value => value + 1)} /> : page && <>
      <div className="section-heading"><h2>{input.query ? "搜索结果" : "漫画作品"}</h2><span>共 {page.total.toLocaleString()} 部 · 第 {page.page} 页</span></div>
      {page.items.length ? <div className="comic-explore-grid">{page.items.map(item => <button key={item.pathWord} type="button" className="comic-explore-card" onClick={() => open(item)} aria-label={`查看漫画 ${item.title}`}>
        <ComicCover item={item} /><strong title={item.title}>{item.title}</strong>
        <span>{item.authors.join(" / ") || "作者未提供"}</span>
        <span>{item.localWorkId ? item.favorite ? "已收藏到书架" : "已加入书架" : item.updatedAt ? `更新 ${item.updatedAt}` : "拷贝漫画"}</span>
      </button>)}</div> : <EmptyState title="没有找到漫画" description="试试其他作品名称，或清除筛选。" />}
      <nav className="comic-explore-paging" aria-label="漫画分页">
        <button className="button secondary" disabled={input.page <= 1} onClick={() => changeList({ page: input.page - 1 })}>上一页</button>
        <span>第 {input.page} 页</span>
        <button className="button secondary" disabled={input.page * 24 >= page.total || input.page >= 10_000} onClick={() => changeList({ page: input.page + 1 })}>下一页</button>
      </nav>
    </>}
    {selectedId && <Modal title={detail?.item.title ?? "漫画作品详情"} width="large" onClose={close}>
      {detailError ? <ErrorState message={detailError} retry={() => setDetailRefresh(value => value + 1)} /> : !detail ? <LoadingState label="正在读取漫画资料" /> : <>
        <div className="comic-explore-detail">
          <ComicCover item={detail.item} detail />
          <div><p className="quiet-inline">拷贝漫画 · 作品资料</p><h2>{detail.item.title}</h2>
            {detail.aliases.length > 0 && <p className="quiet-inline">{detail.aliases.join(" / ")}</p>}
            <p>作者：{detail.item.authors.join(" / ") || "未提供"}</p>
            <div className="tag-row">{detail.item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
            <p>{[detail.item.status, detail.chapterCount !== null ? `${detail.chapterCount} 话` : "", detail.item.latestChapter && `更新至 ${detail.item.latestChapter}`].filter(Boolean).join(" · ") || "暂无连载信息"}</p>
            {detail.item.updatedAt && <p className="quiet-inline">更新日期：{detail.item.updatedAt}</p>}
            <p className="comic-explore-summary">{detail.item.summary || "来源暂未提供简介。"}</p>
          </div>
        </div>
        {detail.stale && <p className="comic-explore-notice" role="status">当前显示缓存资料，来源更新暂不可用。</p>}
        {saveError && <p className="recognition-error" role="alert">{saveError}</p>}
        <div className="comic-explore-detail-actions">
          {detail.item.localWorkId ? <Link className="button primary" to={`/bookshelf/${encodeURIComponent(detail.item.localWorkId)}`}>打开书架详情</Link> : <>
            <button className="button primary icon-text" disabled={saving} onClick={() => void save(false)}><BookOpen size={16} />{saving ? "正在加入" : "加入书架"}</button>
            <button className="button secondary icon-text" disabled={saving} onClick={() => void save(true)}><Heart size={16} />收藏到书架</button>
          </>}
          <button className="button secondary icon-text" onClick={() => setDetailRefresh(value => value + 1)} disabled={saving}><RefreshCw size={16} />刷新资料</button>
        </div>
        <p className="quiet-inline">章节阅读将在后续接入；现在可以保存作品和个人阅读状态。Bangumi 未收录的作品也能加入书架。</p>
      </>}
    </Modal>}
  </div>;
}
