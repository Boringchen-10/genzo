import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BookOpen, Heart, RefreshCw, Search, X } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { appendComicPage, comicExploreApi, comicListParams, comicQueryFromParams, type ComicDetail, type ComicItem, type ComicPage, type ComicQuery, type ComicTheme } from "../comicExplore";
import { EmptyState, ErrorState, IconButton, LoadingState, useOffline } from "../components/common";
import { ResilientImage, RetryImagesButton } from "../components/ResilientImage";
import { getErrorMessage } from "../utils";
import "../comic-explore.css";

function ComicCover({ item, detail = false }: { item: ComicItem; detail?: boolean }) {
  return <div className={`comic-explore-cover${detail ? " is-detail" : ""}`}>
    <ResilientImage sources={[item.coverUrl]} alt={`${item.title} 封面`} fallback={<span className="comic-cover-placeholder"><BookOpen size={32} />暂无封面</span>} />
  </div>;
}

// Session snapshots keep expanded lists when returning from the bookshelf.
const lists = new Map<string, ComicPage>();
const scrollPositions = new Map<string, number>();
function rememberList(key: string, page: ComicPage) {
  lists.delete(key);
  lists.set(key, page);
  if (lists.size > 8) lists.delete(lists.keys().next().value!);
}

export function ComicExplorePage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const pageElement = useRef<HTMLDivElement>(null);
  const activeLocation = useRef(location.key);
  activeLocation.current = location.key;
  const input = comicQueryFromParams(params);
  const listInput = { ...input, page: 1 };
  const listKey = JSON.stringify(listInput);
  const listRef = useRef(listKey);
  listRef.current = listKey;
  const listRequest = useRef(0);
  const selectedId = params.get("comic");
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const offline = useOffline();
  const [query, setQuery] = useState(input.query);
  const [page, setPage] = useState<ComicPage | null>(() => lists.get(listKey) ?? null);
  const [themes, setThemes] = useState<ComicTheme[]>([]);
  const [themeError, setThemeError] = useState("");
  const [themesAttempt, setThemesAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const lastListRefresh = useRef(0);
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState("");
  const [detail, setDetail] = useState<ComicDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRefresh, setDetailRefresh] = useState(0);
  const lastDetailRefresh = useRef(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const main = pageElement.current?.closest("main");
    if (!main) return;
    if (selectedId) { main.scrollTop = 0; return; }
    const saved = scrollPositions.get(location.key) ?? 0;
    const remember = () => {
      if (activeLocation.current !== location.key || selectedRef.current) return;
      scrollPositions.set(location.key, main.scrollTop);
      if (scrollPositions.size > 50) scrollPositions.delete(scrollPositions.keys().next().value!);
    };
    // Restore after the shell's route scroll reset and before recording new scrolls.
    const frame = window.requestAnimationFrame(() => {
      main.scrollTop = saved;
      main.addEventListener("scroll", remember, { passive: true });
    });
    return () => { window.cancelAnimationFrame(frame); main.removeEventListener("scroll", remember); };
  }, [location.key, selectedId]);

  useEffect(() => { setQuery(input.query); }, [input.query]);
  useEffect(() => {
    let cancelled = false;
    listRequest.current += 1;
    const cached = lists.get(listKey) ?? null;
    setPage(cached); setError(""); setExpandError(""); setExpanding(false);
    const force = lastListRefresh.current !== refresh;
    lastListRefresh.current = refresh;
    if (selectedId || (cached && !force)) { setLoading(false); return; }
    setLoading(true);
    void comicExploreApi.list(JSON.parse(listKey) as ComicQuery, force)
      .then(value => { if (!cancelled) { rememberList(listKey, value); setPage(value); } })
      .catch(reason => { if (!cancelled) setError(getErrorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listKey, refresh, selectedId]);
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

  const changeList = (changes: Partial<ComicQuery>) => setParams(comicListParams({ ...listInput, ...changes }));
  const search = (event: FormEvent) => {
    event.preventDefault(); changeList({ query: query.trim(), theme: "", top: "" });
  };
  const open = (item: ComicItem) => {
    scrollPositions.set(location.key, pageElement.current?.closest("main")?.scrollTop ?? 0);
    selectedRef.current = item.pathWord;
    const next = comicListParams(listInput); next.set("comic", item.pathWord);
    setParams(next, { state: { comicDetail: true } });
  };
  const close = () => {
    if (location.state?.comicDetail) navigate(-1);
    else setParams(comicListParams(listInput), { replace: true });
  };
  const expand = async () => {
    if (!page || loading || expanding) return;
    const key = listKey;
    const request = ++listRequest.current;
    setExpanding(true); setExpandError("");
    try {
      const next = await comicExploreApi.list({ ...listInput, page: page.page + 1 });
      if (listRef.current !== key || listRequest.current !== request) return;
      const expanded = appendComicPage(page, next);
      rememberList(key, expanded); setPage(expanded);
    } catch (reason) {
      if (listRef.current === key && listRequest.current === request) setExpandError(getErrorMessage(reason));
    } finally {
      if (listRef.current === key && listRequest.current === request) setExpanding(false);
    }
  };
  const save = async (favorite: boolean) => {
    if (!detail || saving) return;
    const id = detail.item.pathWord;
    setSaving(true); setSaveError("");
    try {
      const workId = await comicExploreApi.save(id, favorite);
      if (selectedRef.current !== id) return;
      setDetail(previous => previous && { ...previous, item: { ...previous.item, localWorkId: workId, favorite } });
      for (const [key, snapshot] of lists) {
        lists.set(key, { ...snapshot, items: snapshot.items.map(item => item.pathWord === id ? { ...item, localWorkId: workId, favorite } : item) });
      }
      setPage(lists.get(listRef.current) ?? null);
    } catch (reason) { if (selectedRef.current === id) setSaveError(getErrorMessage(reason)); }
    finally { if (selectedRef.current === id) setSaving(false); }
  };

  if (selectedId) return <div ref={pageElement} className="detail-page gnz-explore-detail-page comic-explore-detail-page">
    <div className="detail-backdrop" aria-hidden="true" />
    <div className="detail-inner">
      <div className="detail-topbar">
        <button type="button" className="icon-button detail-back" aria-label="返回探索" data-tooltip="返回探索" onClick={close}><ArrowLeft size={17} /></button>
        <strong>漫画作品详情</strong><span className="detail-topbar-fill" />
        <IconButton tooltip="刷新漫画资料" onClick={() => setDetailRefresh(value => value + 1)} disabled={saving}><RefreshCw size={18} /></IconButton>
      </div>
      {detailError ? <ErrorState message={detailError} retry={() => setDetailRefresh(value => value + 1)} /> : !detail ? <LoadingState label="正在读取漫画资料" /> : <>
        <section className="detail-hero">
          <div className="detail-cover"><ComicCover item={detail.item} detail /></div>
          <div className="detail-copy">
            <span className="detail-eyebrow">漫画 · 拷贝漫画</span><h1>{detail.item.title}</h1>
            {detail.aliases.length > 0 && <p className="original-title">{detail.aliases.join(" / ")}</p>}
            <p className="quiet-inline">作者：{detail.item.authors.join(" / ") || "未提供"}</p>
            <div className="detail-actions">
              {detail.item.localWorkId ? <Link className="button primary icon-text" to={`/bookshelf/${encodeURIComponent(detail.item.localWorkId)}`}><BookOpen size={16} />打开书架详情</Link> : <>
                <button className="button primary icon-text" disabled={saving} onClick={() => void save(false)}><BookOpen size={16} />{saving ? "正在加入" : "加入书架"}</button>
                <button className="button secondary icon-text" disabled={saving} onClick={() => void save(true)}><Heart size={16} />收藏到书架</button>
              </>}
            </div>
            {saveError && <p className="recognition-error" role="alert">{saveError}</p>}
          </div>
        </section>
        {detail.stale && <p className="comic-explore-notice" role="status">当前显示缓存资料，来源更新暂不可用。</p>}
        <div className="detail-body">
          <main className="detail-main">
            <section className="detail-section">
              <dl className="gnz-explore-detail-stats">
                <div><dt>连载状态</dt><dd>{detail.item.status || "未提供"}</dd></div>
                <div><dt>章节总数</dt><dd>{detail.chapterCount !== null ? `${detail.chapterCount} 话` : "未提供"}</dd></div>
                <div><dt>最新章节</dt><dd>{detail.item.latestChapter || "未提供"}</dd></div>
                <div><dt>更新日期</dt><dd>{detail.item.updatedAt || "未提供"}</dd></div>
              </dl>
            </section>
            <section className="detail-section">
              <div className="detail-section-head"><h2>简介</h2></div>
              <p className="detail-description">{detail.item.summary || "来源暂未提供简介。"}</p>
              <div className="detail-tags">{detail.item.tags.map(tag => <span className="detail-tag" key={tag}>{tag}</span>)}</div>
            </section>
          </main>
          <aside className="detail-side">
            <section className="detail-metadata-panel">
              <div className="metadata-head"><h2>作品信息</h2></div>
              <dl className="metadata-grid">
                <div><dt>类型</dt><dd>漫画</dd></div>
                <div><dt>作者</dt><dd>{detail.item.authors.join(" / ") || "未提供"}</dd></div>
                <div><dt>别名</dt><dd>{detail.aliases.join(" / ") || "未提供"}</dd></div>
                <div><dt>我的书架</dt><dd>{detail.item.localWorkId ? detail.item.favorite ? "已收藏到书架" : "已加入书架" : "尚未加入"}</dd></div>
                <div><dt>数据来源</dt><dd>拷贝漫画</dd></div>
              </dl>
              <p className="quiet-inline">Bangumi 未收录的作品也能加入书架。章节阅读将在后续接入。</p>
            </section>
          </aside>
        </div>
      </>}
    </div>
  </div>;

  return <div ref={pageElement} className="page workspace-page gnz-explore-page comic-explore-page">
    <header className="gnz-compact-header">
      <div><strong>探索</strong><span>漫画 · 拷贝目录</span></div>
      <form className="search-box gnz-explore-search" role="search" onSubmit={search}>
        <Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索漫画作品" aria-label="搜索漫画作品" maxLength={200} />
        {input.query && <button type="button" className="gnz-explore-search-clear" aria-label="清除漫画搜索" onClick={() => changeList({ query: "" })}><X size={15} /></button>}
      </form>
      <IconButton tooltip="刷新漫画探索" disabled={loading || expanding} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} /></IconButton>
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
    {loading && !page ? <LoadingState label="正在读取漫画目录" /> : error && !page ? <ErrorState message={error} retry={() => setRefresh(value => value + 1)} /> : page && <>
      <div className="section-heading"><h2>{input.query ? "搜索结果" : "漫画作品"}</h2><span>已显示 {page.items.length.toLocaleString()} / {page.total.toLocaleString()} 部</span></div>
      {page.items.length ? <div className="comic-explore-grid">{page.items.map(item => <button key={item.pathWord} type="button" className="comic-explore-card" onClick={() => open(item)} aria-label={`查看漫画 ${item.title}`}>
        <ComicCover item={item} /><strong title={item.title}>{item.title}</strong>
        <span>{item.authors.join(" / ") || "作者未提供"}</span>
        <span>{item.localWorkId ? item.favorite ? "已收藏到书架" : "已加入书架" : item.updatedAt ? `更新 ${item.updatedAt}` : "拷贝漫画"}</span>
      </button>)}</div> : <EmptyState title="没有找到漫画" description="试试其他作品名称，或清除筛选。" />}
      {error && <ErrorState message={error} retry={() => setRefresh(value => value + 1)} />}
      <div className="gnz-explore-more" aria-live="polite">
        {expandError && <p className="recognition-error" role="alert">{expandError}</p>}
        {page.page * 24 < page.total && page.page < 10_000 && <button type="button" className="button secondary" disabled={loading || expanding} onClick={() => void expand()}>
          {expanding ? "正在展开…" : expandError ? "重试展开" : `展开更多作品（已显示 ${page.items.length} / ${page.total}）`}
        </button>}
      </div>
    </>}
  </div>;
}
