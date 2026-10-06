import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, CalendarDays, ChevronDown, ChevronRight, Heart, LoaderCircle, RefreshCw, Search, Star, X } from "lucide-react";
import { api } from "../api";
import type { ExploreSubject, WeeklyCalendar, WeeklyCalendarDay } from "../types";
import { comicExploreApi, type ComicItem, type ComicTheme } from "../comicExplore";

type ExploreTab = "anime" | "comic" | "novel";
type ExploreView = "feed" | "schedule";
type LoadState = "loading" | "ready" | "error";

const pic = (path: string | null | undefined) => path
  ? (/^(https?:|asset:|data:|blob:)/.test(path) ? path : convertFileSrc(path))
  : undefined;
const cover = (subject: ExploreSubject) => pic(subject.coverUrl);
const comicCover = (item: ComicItem) => pic(item.cachedCoverPath) ?? pic(item.coverUrl);
const score = (value: number | null) => value == null ? "暂无评分" : value.toFixed(1);

const subjectTypeLabels: Record<ExploreSubject["subjectType"], string> = { tv: "TV", web: "WEB", movie: "剧场版", ova: "OVA" };
const weekdayNumber = (date = new Date()) => (date.getDay() === 0 ? 7 : date.getDay());
const SEASONS = [
  { label: "冬季", month: 1 },
  { label: "春季", month: 4 },
  { label: "夏季", month: 7 },
  { label: "秋季", month: 10 },
] as const;
const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const courStartMonth = (date = new Date()) => {
  const month = date.getMonth() + 1;
  return month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
};
const seasonLabelOf = (year: number, month: number) => `${year} ${SEASONS.find(season => season.month === month)?.label ?? ""}`;
const subjectWeekday = (subject: ExploreSubject): number | null => {
  const raw = (subject.broadcast?.replace(/^R\//, "").split("/")[0] || subject.airDate || "").trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getDay();
  return day === 0 ? 7 : day;
};
const groupByWeekday = (items: ExploreSubject[]): WeeklyCalendarDay[] =>
  [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, label: WEEKDAY_LABELS[weekday] ?? "", items: items.filter(item => subjectWeekday(item) === weekday) }));
const weekDayNumbers = () => {
  const monday = new Date();
  monday.setDate(monday.getDate() - (weekdayNumber() - 1));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date.getDate();
  });
};
const curatedTags = (items: ExploreSubject[], limit = 24) => {
  const counts = new Map<string, number>();
  for (const item of items) for (const genre of item.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
};

export default function ExplorePanel({ onToast, registerBack }: { onToast: (message: string) => void; registerBack?: (handler: (() => boolean) | null) => void }) {
  const [tab, setTab] = useState<ExploreTab>("anime");
  const [view, setView] = useState<ExploreView>("feed");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [animeResults, setAnimeResults] = useState<ExploreSubject[]>([]);
  const [comicResults, setComicResults] = useState<ComicItem[]>([]);

  const [trending, setTrending] = useState<ExploreSubject[]>([]);
  const [seasonal, setSeasonal] = useState<ExploreSubject[]>([]);
  const [ranking, setRanking] = useState<ExploreSubject[]>([]);
  const [calendar, setCalendar] = useState<WeeklyCalendar | null>(null);
  const [animeState, setAnimeState] = useState<LoadState>("loading");
  const [animeError, setAnimeError] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [seasonalTag, setSeasonalTag] = useState("");
  const [seasonalLimit, setSeasonalLimit] = useState(24);
  const [scheduleDay, setScheduleDay] = useState(weekdayNumber);
  const [currentCour] = useState(() => ({ year: new Date().getFullYear(), month: courStartMonth() }));
  const [scheduleYear, setScheduleYear] = useState(currentCour.year);
  const [scheduleMonth, setScheduleMonth] = useState(currentCour.month);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [seasonDays, setSeasonDays] = useState<WeeklyCalendarDay[] | null>(null);
  const [seasonState, setSeasonState] = useState<LoadState>("ready");
  const isCurrentCour = scheduleYear === currentCour.year && scheduleMonth === currentCour.month;

  const [themes, setThemes] = useState<ComicTheme[]>([]);
  const [theme, setTheme] = useState("");
  const [comics, setComics] = useState<ComicItem[]>([]);
  const [comicState, setComicState] = useState<LoadState>("loading");
  const [comicError, setComicError] = useState("");

  const [detail, setDetail] = useState<
    { kind: "anime"; item: ExploreSubject } | { kind: "comic"; item: ComicItem } | null
  >(null);
  const [saving, setSaving] = useState(false);

  const backHandler = useRef<() => boolean>(() => false);
  backHandler.current = () => {
    if (detail) { setDetail(null); return true; }
    if (seasonOpen) { setSeasonOpen(false); return true; }
    if (view === "schedule") { setView("feed"); return true; }
    return false;
  };
  useEffect(() => {
    if (!registerBack) return;
    registerBack(() => backHandler.current());
    return () => registerBack(null);
  }, [registerBack]);

  const loadAnime = useCallback(async () => {
    setAnimeState("loading"); setAnimeError("");
    try {
      const [overview, ranks] = await Promise.all([api.exploreOverview(), api.animeRanking(1, 12)]);
      setTrending(overview.trending.slice(0, 12));
      setSeasonal(overview.seasonal);
      setRanking(ranks);
      setAnimeState("ready");
    } catch (reason) { setAnimeError(String(reason)); setAnimeState("error"); }
    try { setCalendar(await api.weeklyCalendar()); } catch { setCalendar(null); }
  }, []);

  const loadComics = useCallback(async (nextTheme: string) => {
    setComicState("loading"); setComicError("");
    try {
      const page = await comicExploreApi.list({ query: "", theme: nextTheme, top: "", sort: "popular", page: 1 });
      setComics(page.items);
      setComicState("ready");
    } catch (reason) { setComicError(String(reason)); setComicState("error"); }
  }, []);

  useEffect(() => { void loadAnime(); }, [loadAnime]);
  useEffect(() => {
    if (isCurrentCour) { setSeasonDays(null); setSeasonState("ready"); return; }
    let cancelled = false;
    setSeasonState("loading");
    api.exploreOverview(scheduleYear, scheduleMonth)
      .then(overview => { if (!cancelled) { setSeasonDays(groupByWeekday(overview.seasonal)); setSeasonState("ready"); } })
      .catch(() => { if (!cancelled) { setSeasonDays(null); setSeasonState("error"); } });
    return () => { cancelled = true; };
  }, [isCurrentCour, scheduleYear, scheduleMonth]);
  useEffect(() => {
    if (tab !== "comic") return;
    if (!themes.length) void comicExploreApi.themes().then(setThemes).catch(() => {});
    void loadComics(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const switchTab = (next: ExploreTab) => {
    setTab(next);
    setSearchTerm(null); setQuery(""); setSearchOpen(false);
    setAnimeResults([]); setComicResults([]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) { onToast("请输入要搜索的名称"); return; }
    setSearching(true); setSearchTerm(term);
    try {
      if (tab === "anime") setAnimeResults(await api.searchExplore(term));
      else if (tab === "comic") {
        const page = await comicExploreApi.list({ query: term, theme: "", top: "", sort: "popular", page: 1 });
        setComicResults(page.items);
      } else onToast("轻小说搜索待接入数据源");
    } catch (reason) { onToast(String(reason)); }
    finally { setSearching(false); }
  };

  const clearSearch = () => { setSearchTerm(null); setQuery(""); setAnimeResults([]); setComicResults([]); };

  const saveAnime = async (subject: ExploreSubject, favorite: boolean) => {
    setSaving(true);
    try {
      await api.saveExploreSubject({ externalId: subject.externalId, status: "planned", favorite });
      const fresh = await api.getExploreSubject(subject.externalId);
      setDetail({ kind: "anime", item: fresh });
      onToast("已加入媒体库");
    } catch (reason) { onToast(String(reason)); }
    finally { setSaving(false); }
  };

  const saveComic = async (item: ComicItem, favorite: boolean) => {
    setSaving(true);
    try {
      await comicExploreApi.save(item.pathWord, favorite);
      onToast("已加入媒体库");
    } catch (reason) { onToast(String(reason)); }
    finally { setSaving(false); }
  };

  const selectTag = (tag: string) => { setSeasonalTag(tag); setSeasonalLimit(24); };

  const animeCard = (subject: ExploreSubject) => <button className="gz-cover" key={subject.externalId} onClick={() => setDetail({ kind: "anime", item: subject })}>
    <span className="gz-explore-poster">{cover(subject) ? <img src={cover(subject)} alt="" loading="lazy" /> : <BookOpen size={24} />}</span>
    <span className="gz-cover-label">{subject.title}</span>
  </button>;

  const comicCard = (item: ComicItem) => <button className="gz-cover" key={item.pathWord} onClick={() => setDetail({ kind: "comic", item })}>
    <span className="gz-explore-poster">{comicCover(item) ? <img src={comicCover(item)} alt="" loading="lazy" /> : <BookOpen size={24} />}</span>
    <span className="gz-cover-label">{item.title}</span>
  </button>;

  const scheduleRow = (subject: ExploreSubject) => <button className="gz-sched-row" key={subject.externalId} onClick={() => setDetail({ kind: "anime", item: subject })}>
    <span className="gz-sched-cover">{cover(subject) ? <img src={cover(subject)} alt="" loading="lazy" /> : <BookOpen size={20} />}</span>
    <span className="gz-sched-body">
      <strong>{subject.title}</strong>
      <span className="gz-meta">{[subjectTypeLabels[subject.subjectType], ...subject.genres.slice(0, 3)].filter(Boolean).join(" · ")}</span>
    </span>
    {subject.score != null && <span className="gz-sched-score"><Star size={12} />{score(subject.score)}</span>}
  </button>;

  const today = weekdayNumber();
  const todayItems = calendar?.days.find(day => day.weekday === today)?.items ?? [];
  const todayFeed = todayItems.length ? todayItems : trending;
  const seasonalItems = seasonalTag ? seasonal.filter(item => item.genres.includes(seasonalTag)) : seasonal;
  const tagChips = useMemo(() => curatedTags(seasonal), [seasonal]);
  const dayNumbers = weekDayNumbers();
  const seasonLabel = seasonLabelOf(scheduleYear, scheduleMonth);
  const seasonYears = Array.from({ length: 10 }, (_, index) => currentCour.year - index);
  const scheduleDays = isCurrentCour ? calendar?.days ?? null : seasonDays;
  const scheduleItems = scheduleDays?.find(day => day.weekday === scheduleDay)?.items ?? [];

  const scheduleView = <div className="gz-schedule">
    <div className="gz-sched-head">
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => setView("feed")}><ArrowLeft size={20} /></button>
      <h2>放送时间表</h2>
      <button className="gz-season-btn" aria-haspopup="dialog" aria-expanded={seasonOpen} onClick={() => setSeasonOpen(true)}>{seasonLabel}<ChevronDown size={14} /></button>
    </div>
    {isCurrentCour && !calendar ? <p className="gz-loading"><LoaderCircle />正在读取放送时间表…</p>
      : !isCurrentCour && seasonState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取该季度番组…</p>
      : !isCurrentCour && seasonState === "error" ? <div className="gz-error" role="alert"><span>该季度数据读取失败。</span></div>
      : <>
        {scheduleDays && <div className="gz-sched-days" role="tablist" aria-label="星期">
          {scheduleDays.map((day, index) => <button key={day.weekday} role="tab" aria-selected={scheduleDay === day.weekday} className={scheduleDay === day.weekday ? "active" : ""} onClick={() => setScheduleDay(day.weekday)}>
            <span className="gz-sched-day-label">{isCurrentCour && day.weekday === today ? "今天" : day.label}</span>
            {isCurrentCour && <span className="gz-sched-day-num">{dayNumbers[index]}</span>}
          </button>)}
        </div>}
        {scheduleItems.length ? <div className="gz-sched-list">{scheduleItems.map(scheduleRow)}</div> : <div className="gz-empty"><BookOpen size={26} /><h2>这天没有番组</h2><p>{isCurrentCour ? "换一周中的其他日子看看。" : "换个季度或换一天看看。"}</p></div>}
      </>}
  </div>;

  return <div className="gz-explore">
    {view === "schedule" ? scheduleView : <>
      <div className="gz-explore-head">
        <div className="gz-seg gz-explore-tabs" role="tablist" aria-label="发现分类">
          {([["anime", "动漫"], ["comic", "漫画"], ["novel", "轻小说"]] as const).map(([id, label]) =>
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => switchTab(id)}>{label}</button>)}
        </div>
        <button className="gz-iconbtn" aria-label={searchOpen ? "关闭搜索" : "搜索"} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Search /></button>
      </div>
      {searchOpen && <form className="gz-search" role="search" onSubmit={submit}>
        <Search size={18} />
        <input type="search" aria-label={`搜索${tab === "anime" ? "动漫" : tab === "comic" ? "漫画" : "轻小说"}`} placeholder={tab === "anime" ? "搜索 Bangumi 条目" : tab === "comic" ? "搜索漫画" : "搜索轻小说"} value={query} onChange={event => setQuery(event.target.value)} />
        {searchTerm !== null && <button type="button" className="gz-iconbtn" aria-label="清除搜索" onClick={clearSearch}><X size={18} /></button>}
      </form>}

      {tab === "anime" && (searchTerm !== null ? <>
        <p className="gz-meta">「{searchTerm}」共 {animeResults.length} 条</p>
        {searching ? <p className="gz-loading"><LoaderCircle />正在搜索…</p> : animeResults.length
          ? <div className="gz-explore-grid">{animeResults.map(animeCard)}</div>
          : <div className="gz-empty"><Search size={26} /><h2>没有匹配的条目</h2><p>换一个关键词再试。</p></div>}
      </> : animeState === "error" ? <>
        <div className="gz-error" role="alert"><span>{animeError || "Bangumi 数据读取失败。"}</span></div>
        <button className="gz-btn" onClick={() => void loadAnime()}><RefreshCw size={16} />重试</button>
      </> : animeState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取 Bangumi 数据…</p> : <>
        <section className="gz-section"><div className="gz-section-head"><h2>今日更新</h2>
          <button className="gz-link" onClick={() => setView("schedule")}><CalendarDays size={16} />时间表<ChevronRight size={16} /></button></div>
          {todayFeed.length ? <div className="gz-rail gz-cover-rail">{todayFeed.slice(0, 12).map(animeCard)}</div> : <p className="gz-panel gz-meta">今天暂无索引到的更新番剧。</p>}</section>
        <section className="gz-section"><div className="gz-section-head">
          <button className="gz-section-toggle" aria-expanded={tagsOpen} onClick={() => setTagsOpen(value => !value)}>
            <h2>当季番组</h2><ChevronDown size={16} className={tagsOpen ? "is-open" : ""} />
          </button>
          <span className="gz-meta">{seasonalItems.length} 部</span></div>
          {tagsOpen && <div className="gz-chips" role="radiogroup" aria-label="番组标签">
            <button className={`gz-chip ${seasonalTag === "" ? "active" : ""}`} role="radio" aria-checked={seasonalTag === ""} onClick={() => selectTag("")}>全部</button>
            {tagChips.map(tag => <button key={tag} className={`gz-chip ${seasonalTag === tag ? "active" : ""}`} role="radio" aria-checked={seasonalTag === tag} onClick={() => selectTag(tag)}>{tag}</button>)}
          </div>}
          {seasonalItems.length ? <><div className="gz-explore-grid">{seasonalItems.slice(0, seasonalLimit).map(animeCard)}</div>{seasonalItems.length > seasonalLimit && <button className="gz-btn" onClick={() => setSeasonalLimit(seasonalLimit + 30)}>加载更多</button>}</> : <p className="gz-panel gz-meta">{seasonalTag ? "这个标签下暂无番组。" : "这个季度没有索引到番组。"}</p>}</section>
        <section className="gz-section"><div className="gz-section-head"><h2>动画排行</h2><span className="gz-meta">按 Bangumi 评分排名</span></div>
          {ranking.length ? <ol className="gz-rank-list">{ranking.map((subject, index) => <li key={subject.externalId}>
            <button className="gz-rank-row" onClick={() => setDetail({ kind: "anime", item: subject })}>
              <span className="gz-rank-index">{subject.rank ?? index + 1}</span>
              <span className="gz-rank-cover">{cover(subject) ? <img src={cover(subject)} alt="" loading="lazy" /> : <BookOpen size={18} />}</span>
              <span className="gz-rank-body"><strong>{subject.title}</strong><span className="gz-meta"><Star size={11} />{score(subject.score)}{subject.inLibrary ? " · 已入库" : ""}</span></span>
            </button>
          </li>)}</ol> : <p className="gz-panel gz-meta">排行榜暂时没有数据。</p>}</section>
      </>)}

      {tab === "comic" && (searchTerm !== null ? <>
        <p className="gz-meta">「{searchTerm}」共 {comicResults.length} 条</p>
        {searching ? <p className="gz-loading"><LoaderCircle />正在搜索…</p> : comicResults.length
          ? <div className="gz-explore-grid">{comicResults.map(comicCard)}</div>
          : <div className="gz-empty"><Search size={26} /><h2>没有匹配的漫画</h2><p>换一个关键词再试。</p></div>}
      </> : <>
        <div className="gz-chips" role="radiogroup" aria-label="漫画主题">
          <button className={`gz-chip ${theme === "" ? "active" : ""}`} role="radio" aria-checked={theme === ""} onClick={() => { setTheme(""); void loadComics(""); }}>全部</button>
          {themes.map(item => <button key={item.pathWord} className={`gz-chip ${theme === item.pathWord ? "active" : ""}`} role="radio" aria-checked={theme === item.pathWord} onClick={() => { setTheme(item.pathWord); void loadComics(item.pathWord); }}>{item.name}</button>)}
        </div>
        {comicState === "error" ? <>
          <div className="gz-error" role="alert"><span>{comicError || "漫画来源读取失败。"}</span></div>
          <button className="gz-btn" onClick={() => void loadComics(theme)}><RefreshCw size={16} />重试</button>
        </> : comicState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取漫画来源…</p> : comics.length
          ? <div className="gz-explore-grid">{comics.map(comicCard)}</div>
          : <div className="gz-empty"><BookOpen size={26} /><h2>没有漫画</h2><p>这个主题下暂无作品。</p></div>}
      </>)}

      {tab === "novel" && <div className="gz-empty"><BookOpen size={28} /><h2>轻小说发现 · 待接入数据源</h2><p>轻小说的在线目录源尚未接入，接入后会在这里显示分区与搜索。你已入库的轻小说仍可在书架查看。</p></div>}
    </>}

    {seasonOpen && <div className="gz-scrim" onClick={() => setSeasonOpen(false)}><section className="gz-sheet gz-season-sheet" role="dialog" aria-modal="true" aria-label="放送季度" onClick={event => event.stopPropagation()}>
      <span className="gz-sheet-handle" aria-hidden="true" />
      <button className="gz-iconbtn gz-sheet-close" aria-label="关闭" onClick={() => setSeasonOpen(false)}><X size={18} /></button>
      <h2 className="gz-season-title">放送季度</h2>
      <p className="gz-meta">正在查看 {scheduleYear} 年{SEASONS.find(season => season.month === scheduleMonth)?.label}</p>
      <div className="gz-season-groups">{seasonYears.map(year => <div className="gz-season-group" key={year}>
        <span className="gz-season-year">{year}</span>
        <div className="gz-seg gz-season-seg" role="radiogroup" aria-label={`${year} 年季度`}>
          {SEASONS.map(season => <button key={season.label} role="radio" aria-checked={scheduleYear === year && scheduleMonth === season.month} className={scheduleYear === year && scheduleMonth === season.month ? "active" : ""} onClick={() => { setScheduleYear(year); setScheduleMonth(season.month); setSeasonOpen(false); }}>{season.label}</button>)}
        </div>
      </div>)}</div>
    </section></div>}

    {detail && <div className="gz-scrim" onClick={() => setDetail(null)}><section className="gz-sheet gz-explore-sheet" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
      <span className="gz-sheet-handle" aria-hidden="true" />
      <button className="gz-iconbtn gz-sheet-close" aria-label="关闭" onClick={() => setDetail(null)}><X size={18} /></button>
      {detail.kind === "anime" ? <>
        <div className="gz-explore-detail">
          <span className="gz-explore-detail-cover">{cover(detail.item) ? <img src={cover(detail.item)} alt="" /> : <BookOpen size={28} />}</span>
          <div className="gz-explore-detail-info">
            <h2>{detail.item.title}</h2>
            {detail.item.originalTitle && <p className="gz-meta">{detail.item.originalTitle}</p>}
            <p className="gz-meta">{[detail.item.year ? `${detail.item.year} 年` : null, score(detail.item.score), detail.item.rank ? `排名 ${detail.item.rank}` : null].filter(Boolean).join(" · ")}</p>
            {detail.item.genres.length > 0 && <div className="gz-book-chips">{detail.item.genres.slice(0, 6).map(genre => <span className="gz-book-chip" key={genre}>{genre}</span>)}</div>}
          </div>
        </div>
        <p className="gz-description">{detail.item.description || "Bangumi 未提供简介。"}</p>
        <div className="gz-explore-detail-actions">
          <button className="gz-btn primary" disabled={saving} onClick={() => void saveAnime(detail.item, detail.item.favorite)}>{detail.item.inLibrary ? "更新媒体库条目" : "加入媒体库"}</button>
          <button className="gz-btn" disabled={saving} onClick={() => void saveAnime(detail.item, !detail.item.favorite)}><Heart size={16} fill={detail.item.favorite ? "currentColor" : "none"} />{detail.item.favorite ? "取消收藏" : "收藏"}</button>
        </div>
      </> : <>
        <div className="gz-explore-detail">
          <span className="gz-explore-detail-cover">{comicCover(detail.item) ? <img src={comicCover(detail.item)} alt="" /> : <BookOpen size={28} />}</span>
          <div className="gz-explore-detail-info">
            <h2>{detail.item.title}</h2>
            {detail.item.authors.length > 0 && <p className="gz-meta">作者：{detail.item.authors.join(" / ")}</p>}
            {detail.item.tags.length > 0 && <div className="gz-book-chips">{detail.item.tags.slice(0, 6).map(tag => <span className="gz-book-chip" key={tag}>{tag}</span>)}</div>}
          </div>
        </div>
        <p className="gz-description">{detail.item.summary || "来源未提供简介。"}</p>
        <div className="gz-explore-detail-actions">
          <button className="gz-btn primary" disabled={saving} onClick={() => void saveComic(detail.item, true)}>加入媒体库</button>
        </div>
      </>}
    </section></div>}
  </div>;
}
