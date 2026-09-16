import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, Heart, Info, Library, RefreshCw, Search, X } from "lucide-react";
import { Link } from "react-router-dom";
import { dataProvider, getExploreProvider } from "../data";
import { EmptyState, ErrorState, IconButton, LoadingState } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { useToasts } from "../store";
import type { ExploreOverview, ExploreSubject, WorkStatus } from "../types";
import { formatDate, getErrorMessage, statusLabels } from "../utils";
import {
  COUR_MONTHS,
  EXPLORE_UNAVAILABLE_MESSAGE,
  courLabel,
  courOf,
  exploreSourceProblems,
  exploreStatusOptions,
  filterByTag,
  formatBroadcast,
  formatCount,
  formatLibraryState,
  formatRank,
  formatScore,
  seasonLabel,
  subjectTypeLabels,
} from "../explore";

type ExploreTab = "recommended" | "seasonal";

/** 封面：网络封面加载失败或缺失时回退到 Genzo 自制占位封面，不留破图。 */
function ExploreCover({ subject }: { subject: ExploreSubject }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [subject.externalId, subject.coverUrl]);
  if (subject.coverUrl && !failed) {
    return <img className="gnz-explore-cover" src={subject.coverUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <span className="gnz-explore-cover is-placeholder">
      <MediaVisual type="video" coverPath={null} alt={`${subject.title} 的占位封面`} />
    </span>
  );
}

function ExploreCard({ subject, onOpen }: { subject: ExploreSubject; onOpen: (subject: ExploreSubject) => void }) {
  return (
    <button type="button" className="gnz-explore-card" onClick={() => onOpen(subject)} aria-label={`查看 ${subject.title} 的条目详情`}>
      <span className="gnz-explore-poster">
        <ExploreCover subject={subject} />
        {subject.inLibrary ? <span className="gnz-explore-flag"><Library size={12} />入库</span> : null}
        {subject.favorite ? <span className="gnz-explore-flag is-favorite"><Heart size={12} fill="currentColor" />收藏</span> : null}
      </span>
      <span className="gnz-explore-card-body">
        <strong title={subject.title}>{subject.title}</strong>
        <span className="gnz-explore-card-meta">{formatScore(subject.score)} · {formatRank(subject.rank)}</span>
        <span className="gnz-explore-card-sub">{formatBroadcast(subject.airDate, subject.broadcast)}</span>
        <span className="gnz-explore-card-tags">
          {subject.genres.length ? subject.genres.slice(0, 3).map((genre) => <em key={genre}>{genre}</em>) : <em className="is-empty">暂无标签</em>}
        </span>
      </span>
    </button>
  );
}

export function ExplorePage() {
  const provider = useMemo(() => getExploreProvider(), []);
  const toast = useToasts((state) => state.push);
  /** 「全部年份 / 全部月份」时的默认季度：按当前日期取所在季度（1 / 4 / 7 / 10 月）。 */
  const initialCour = useMemo(() => courOf(new Date()), []);
  const [overview, setOverview] = useState<ExploreOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** `null` = 全部年份 / 全部月份；请求时传 null，由后端规范化到季度。 */
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [tab, setTab] = useState<ExploreTab>("recommended");
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [results, setResults] = useState<ExploreSubject[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ExploreSubject | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftStatus, setDraftStatus] = useState<WorkStatus>("planned");
  const [draftFavorite, setDraftFavorite] = useState(false);

  /** 筛选为「全部」时，本季按当前日期所在季度自动取值。 */
  const effectiveYear = year ?? initialCour.year;
  const effectiveMonth = month ?? initialCour.month;

  const load = useCallback(async (targetYear: number | null, targetMonth: number | null) => {
    if (!provider) {
      setOverview(null);
      setLoading(false);
      setError(EXPLORE_UNAVAILABLE_MESSAGE);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setOverview(await provider.exploreOverview(targetYear, targetMonth));
    } catch (loadError: unknown) {
      setOverview(null);
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => { void load(year, month); }, [load, year, month]);

  const refresh = useCallback(async () => {
    if (!provider) return;
    try {
      setOverview(await provider.exploreOverview(year, month));
    } catch {
      /* 静默刷新失败时保留现有列表，避免把已展示的数据整页替换成错误态 */
    }
  }, [provider, year, month]);

  const problems = useMemo(() => exploreSourceProblems(overview?.sources ?? []), [overview]);
  /** 展示用的季度：优先用后端规范化后的年份 / 月份，未取到时回落到「全部」时的当前季度。 */
  const shownYear = overview?.year ?? effectiveYear;
  const shownMonth = overview?.month ?? effectiveMonth;
  const activeList = tab === "seasonal" ? overview?.seasonal ?? [] : overview?.trending ?? [];
  const availableTags = overview?.availableTags ?? [];
  const visible = useMemo(() => filterByTag(activeList, tag), [activeList, tag]);
  const filterTags = useMemo(() => searchTerm !== null
    ? Array.from(new Set(results.flatMap((item) => item.genres))).sort((left, right) => left.localeCompare(right, "zh-CN"))
    : availableTags, [searchTerm, results, availableTags]);
  const gridSubjects = searchTerm !== null ? filterByTag(results, tag) : visible;
  const heading = searchTerm !== null
    ? { title: "搜索结果", detail: `「${searchTerm}」共 ${gridSubjects.length} 条` }
    : { title: "推荐作品", detail: tab === "seasonal" ? `${courLabel(shownYear, shownMonth)} · 来自 bangumi-data 番组索引` : "按 Bangumi 评分人数与收藏人数排序" };

  useEffect(() => {
    if (tag && !filterTags.includes(tag)) setTag(null);
  }, [filterTags, tag]);

  const clearSearch = () => { setSearchTerm(null); setResults([]); setQuery(""); };
  const openTab = (next: ExploreTab) => { clearSearch(); setTab(next); };
  /** 重置回「全部年份 / 全部月份」，此时本季自动取当前季度。 */
  const resetFilters = () => { setTag(null); setYear(null); setMonth(null); };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || searching) return;
    const trimmed = query.trim();
    if (!trimmed) {
      toast("请输入要搜索的作品名", "info");
      return;
    }
    setSearching(true);
    try {
      const items = await provider.searchExplore(trimmed);
      setResults(items);
      setSearchTerm(trimmed);
      if (!items.length) toast(`没有找到与「${trimmed}」匹配的 Bangumi 条目`, "info");
    } catch (searchError: unknown) {
      toast(getErrorMessage(searchError), "error");
    } finally {
      setSearching(false);
    }
  };

  const openDetail = useCallback(async (subject: ExploreSubject) => {
    setSelected(subject);
    setDraftStatus(subject.localStatus ?? "planned");
    setDraftFavorite(subject.favorite);
    setDetailError("");
    if (!provider) {
      setDetailError(EXPLORE_UNAVAILABLE_MESSAGE);
      return;
    }
    setDetailLoading(true);
    try {
      const fresh = await provider.getExploreSubject(subject.externalId);
      setSelected(fresh);
      setDraftStatus(fresh.localStatus ?? "planned");
      setDraftFavorite(fresh.favorite);
    } catch (detailLoadError: unknown) {
      setDetailError(getErrorMessage(detailLoadError));
    } finally {
      setDetailLoading(false);
    }
  }, [provider]);

  const save = async () => {
    if (!provider || !selected || saving) return;
    setSaving(true);
    try {
      await provider.saveExploreSubject({ externalId: selected.externalId, status: draftStatus, favorite: draftFavorite });
      const fresh = await provider.getExploreSubject(selected.externalId);
      setSelected(fresh);
      setDraftStatus(fresh.localStatus ?? draftStatus);
      setDraftFavorite(fresh.favorite);
      const suffix = dataProvider.meta.mock ? "（示例数据，未写入后端）" : "";
      toast(`${fresh.inLibrary ? "已更新媒体库条目" : "已加入媒体库"}：${fresh.title}${suffix}`, "success");
      await refresh();
    } catch (saveError: unknown) {
      toast(getErrorMessage(saveError), "error");
    } finally {
      setSaving(false);
    }
  };

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let value = initialCour.year - 6; value <= initialCour.year + 1; value += 1) years.push(value);
    return years;
  }, [initialCour.year]);

  const emptyState = searchTerm !== null
    ? <EmptyState title="没有匹配的条目" description="换一个关键词，或清除搜索回到本季列表。" />
    : tab === "seasonal"
      ? <EmptyState title="这个季度没有索引到番组" description={`bangumi-data 番组索引里没有 ${courLabel(effectiveYear, effectiveMonth)} 的条目，换一个年份或季度再试。`} />
      : <EmptyState title="没有可显示的作品" description={problems.blockers[0]?.warning ?? "当前季度没有可用的番组日历数据；历史季度只有本季番组列表。"} />;

  /* 条目详情：与作品详情页共用同一套版面（detail-page / detail-hero / detail-body）。 */
  if (selected) {
    const detailSeason = selected.year !== null ? seasonLabel(selected.year, selected.month ?? 1) : null;
    return (
      <div
        className={`detail-page gnz-explore-detail-page${selected.coverUrl ? " has-detail-artwork" : ""}`}
        style={selected.coverUrl ? ({ "--detail-artwork": `url("${selected.coverUrl}")` } as CSSProperties) : undefined}
      >
        <div className="detail-backdrop" aria-hidden="true" />
        <div className="detail-inner">
          <div className="detail-topbar">
            <button type="button" className="icon-button detail-back" aria-label="返回探索" data-tooltip="返回探索" onClick={() => setSelected(null)}>
              <ArrowLeft size={17} />
            </button>
            <strong>条目详情</strong>
            <span className="detail-topbar-fill" />
            <IconButton
              tooltip={draftFavorite ? "取消收藏" : "加入收藏"}
              aria-pressed={draftFavorite}
              onClick={() => setDraftFavorite(!draftFavorite)}
              disabled={saving || !provider}
            >
              <Heart size={17} fill={draftFavorite ? "currentColor" : "none"} />
            </IconButton>
          </div>

          <section className="detail-hero">
            <div className="detail-cover"><ExploreCover subject={selected} /></div>
            <div className="detail-copy">
              <span className="detail-eyebrow">
                {subjectTypeLabels[selected.subjectType]}{detailSeason ? ` · ${detailSeason}` : ""}
              </span>
              <h1>{selected.title}</h1>
              {selected.originalTitle
                ? <p className="original-title">{selected.originalTitle}</p>
                : <p className="original-title quiet-inline">Bangumi 未提供原文标题。</p>}
              {selected.aliases.length ? <p className="quiet-inline">别名：{selected.aliases.join(" / ")}</p> : null}
              <div className="detail-actions">
                {selected.localWorkId ? (
                  <Link className="button secondary icon-text" to={`/library/${selected.localWorkId}`}>
                    <Library size={16} />打开作品
                  </Link>
                ) : null}
                <button type="button" className="button primary" onClick={() => void save()} disabled={saving || !provider}>
                  {saving ? "正在保存…" : selected.inLibrary ? "更新媒体库条目" : "加入媒体库"}
                </button>
                <label className="field gnz-explore-status"><span>追番状态</span>
                  <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as WorkStatus)} disabled={saving || !provider}>
                    {exploreStatusOptions.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
                  </select>
                </label>
              </div>
              {detailLoading ? <p className="quiet-inline" role="status">正在读取条目详情…</p> : null}
              {detailError ? <p className="gnz-explore-detail-error" role="alert">{detailError}（上面显示的是列表里已有的信息）</p> : null}
            </div>
          </section>

          <div className="detail-body">
            <main className="detail-main">
              <section className="detail-section">
                <dl className="gnz-explore-detail-stats">
                  <div><dt>网络评分</dt><dd>{formatScore(selected.score)}</dd></div>
                  <div><dt>网络排名</dt><dd>{formatRank(selected.rank)}</dd></div>
                  <div><dt>评分人数</dt><dd>{selected.ratingCount > 0 ? formatCount(selected.ratingCount) : "暂无数据"}</dd></div>
                  <div><dt>收藏人数</dt><dd>{selected.collectionCount > 0 ? formatCount(selected.collectionCount) : "暂无数据"}</dd></div>
                </dl>
                <p className="gnz-explore-detail-note">网络评分与排名来自 Bangumi，不会写入你的个人评分。</p>
              </section>

              <section className="detail-section">
                <div className="detail-section-head"><h2>简介</h2></div>
                {selected.description.trim()
                  ? <p className="detail-description">{selected.description}</p>
                  : <p className="quiet-inline">Bangumi 没有提供该条目的简介。</p>}
                <div className="detail-tags">
                  {selected.genres.length
                    ? selected.genres.map((genre) => <span className="detail-tag" key={genre}>{genre}</span>)
                    : <span className="quiet-inline">暂无标签</span>}
                </div>
              </section>
            </main>

            <aside className="detail-side">
              <section className="detail-metadata-panel">
                <div className="metadata-head"><h2>条目信息</h2></div>
                <dl className="metadata-grid">
                  <div><dt>类型</dt><dd>{subjectTypeLabels[selected.subjectType]}</dd></div>
                  <div><dt>年份</dt><dd>{detailSeason ?? "未提供"}</dd></div>
                  <div><dt>放送</dt><dd>{formatBroadcast(selected.airDate, selected.broadcast)}</dd></div>
                  <div><dt>原名</dt><dd>{selected.originalTitle ?? "未提供"}</dd></div>
                  <div><dt>别名</dt><dd>{selected.aliases.length ? selected.aliases.join(" / ") : "未提供"}</dd></div>
                  <div><dt>本地媒体库</dt><dd>{formatLibraryState(selected)}</dd></div>
                  <div><dt>数据来源</dt><dd>Bangumi #{selected.externalId}</dd></div>
                </dl>
                {selected.stale ? <p className="quiet-inline" role="status">该条目详情来自本地过期缓存。</p> : null}
              </section>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page workspace-page gnz-explore-page">
      <header className="gnz-compact-header">
        <div>
          <strong>探索</strong>
          <span>{overview ? `${courLabel(shownYear, shownMonth)} · Bangumi 网络数据` : "Bangumi 网络数据"}</span>
        </div>
        <form className="search-box gnz-explore-search" role="search" onSubmit={submitSearch}>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Bangumi 条目"
            aria-label="搜索 Bangumi 条目"
            maxLength={200}
            disabled={!provider}
          />
          {searchTerm !== null ? (
            <button type="button" className="gnz-explore-search-clear" onClick={clearSearch} aria-label="清除搜索"><X size={15} /></button>
          ) : null}
        </form>
        <IconButton tooltip="刷新探索数据" onClick={() => void load(year, month)} disabled={loading || !provider}>
          <RefreshCw size={18} />
        </IconButton>
      </header>

      <section className="gnz-explore-heading">
        <div>
          <h1>探索</h1>
          <p>浏览本季番组与当前热度作品，并把要追的条目加入本地媒体库。评分与排名来自 Bangumi 网络数据，不是你的个人评分。</p>
        </div>
        <div className="gnz-explore-source-note">
          <strong>{courLabel(shownYear, shownMonth)} · Bangumi 数据源</strong>
          <span>{overview ? `本季 ${overview.seasonal.length} 部 · 热度 ${overview.trending.length} 部` : loading ? "正在读取网络数据" : "暂无数据"}</span>
          {overview ? <span>数据时间 {formatDate(overview.fetchedAt)}</span> : null}
        </div>
      </section>

      {overview?.stale && problems.staleNotices.length ? (
        <div className="gnz-explore-notice" role="status">
          <Info size={15} />
          <div>
            <strong>当前使用本地缓存数据</strong>
            <p>{problems.staleNotices.map((source) => `${source.label}：${source.warning ?? "网络更新失败，使用过期缓存"}`).join("；")}</p>
          </div>
        </div>
      ) : null}

      {problems.blockers.length ? (
        <div className="gnz-explore-notice is-error" role="alert">
          <AlertTriangle size={15} />
          <div>
            <strong>部分数据源不可用</strong>
            <p>{problems.blockers.map((source) => `${source.label}：${source.warning ?? "数据源不可用"}`).join("；")}</p>
            <p className="gnz-explore-notice-hint">这不会影响本地媒体库，已收藏的作品仍可正常浏览。</p>
          </div>
        </div>
      ) : null}

      <div className="gnz-primary-tabs" role="tablist" aria-label="探索分类">
        <button type="button" role="tab" aria-selected={tab === "recommended"} className={tab === "recommended" ? "active" : ""} onClick={() => openTab("recommended")}>推荐</button>
        <button type="button" role="tab" aria-selected={tab === "seasonal"} className={tab === "seasonal" ? "active" : ""} onClick={() => openTab("seasonal")}>本季</button>
        <button type="button" disabled title="需要新增后端：全年 / 全量动画浏览查询（当前契约只提供本季番组与热度）">动画<span className="future-badge">Future</span></button>
        <button type="button" disabled title="需要新增后端：漫画探索数据源（当前只接入 Bangumi 动画条目）">漫画<span className="future-badge">Future</span></button>
      </div>

      {error ? <ErrorState message={error} retry={() => void load(year, month)} /> : null}

      {!error && overview ? (
        <>
          {/* 筛选面板：位置 / 间距 / 结构对齐 Open Design v1.1.2 —— 位于分类 Tab 之下、作品网格之上。 */}
          <section className="gnz-filter-preview" aria-labelledby="explore-filter-title">
            <div className="gnz-filter-head">
              <h2 id="explore-filter-title">筛选</h2>
              <p>共 {gridSubjects.length} 部作品</p>
              <button type="button" className="button secondary compact" onClick={resetFilters} disabled={!tag && year === null && month === null}>重置</button>
            </div>
            <div className="gnz-filter-field">
              <span className="gnz-filter-label" id="explore-tag-label">动漫标签</span>
              <div className="gnz-filter-chips" role="group" aria-labelledby="explore-tag-label">
                {filterTags.length ? filterTags.map((value) => (
                  <button key={value} type="button" className={tag === value ? "active" : ""} aria-pressed={tag === value} onClick={() => setTag(tag === value ? null : value)}>{value}</button>
                )) : <span className="quiet-inline">当前列表还没有可用标签。</span>}
              </div>
            </div>
            <div className="gnz-filter-selects">
              <label className="gnz-filter-select"><span>年份</span>
                <select
                  value={year === null ? "" : String(year)}
                  onChange={(event) => setYear(event.target.value === "" ? null : Number(event.target.value))}
                  aria-label="按年份筛选"
                  disabled={!provider}
                >
                  <option value="">全部年份</option>
                  {yearOptions.map((value) => <option key={value} value={value}>{value} 年</option>)}
                </select>
              </label>
              <label className="gnz-filter-select"><span>月份</span>
                <select
                  value={month === null ? "" : String(month)}
                  onChange={(event) => setMonth(event.target.value === "" ? null : Number(event.target.value))}
                  aria-label="按季度筛选"
                  disabled={!provider}
                >
                  <option value="">全部月份</option>
                  {COUR_MONTHS.map((value) => <option key={value} value={value}>{value} 月新番</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="gnz-explore-trending" aria-busy={loading}>
            <div className="section-heading">
              <div><h2>{heading.title}</h2><span>{loading ? "正在读取网络数据" : heading.detail}</span></div>
              {searchTerm !== null ? (
                <button type="button" className="button secondary compact" onClick={clearSearch}>清除搜索</button>
              ) : null}
            </div>
            {loading || searching ? (
              <LoadingState label={searching ? "正在搜索 Bangumi 条目" : "正在读取 Bangumi 探索数据"} />
            ) : gridSubjects.length ? (
              <div className="gnz-explore-grid">
                {gridSubjects.map((subject) => <ExploreCard key={subject.externalId} subject={subject} onOpen={(next) => void openDetail(next)} />)}
              </div>
            ) : emptyState}
          </section>
        </>
      ) : null}

      {!error && !overview && loading ? <LoadingState label="正在读取 Bangumi 探索数据" /> : null}

    </div>
  );
}
