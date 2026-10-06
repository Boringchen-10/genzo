import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, Clock, Heart, HeartCrack, LoaderCircle, MessageCircle, Play, RefreshCw, Search, Star, Users, X } from "lucide-react";
import { api } from "../api";
import { androidApi } from "./api";
import type { AnimeWorkStructure, ExploreSubject, WeeklyCalendar, WeeklyCalendarDay, WorkStatus } from "../types";
import { comicExploreApi, type ComicItem, type ComicTheme } from "../comicExplore";

type ExploreTab = "anime" | "comic" | "novel";
type ExploreView = "feed" | "schedule";
type LoadState = "loading" | "ready" | "error";
type SubjectDetailTab = "episodes" | "overview" | "comments" | "characters" | "related" | "staff";

const pic = (path: string | null | undefined) => path
  ? (/^(https?:|asset:|data:|blob:)/.test(path) ? path : convertFileSrc(path))
  : undefined;
const cover = (subject: ExploreSubject) => pic(subject.coverUrl);
const comicCover = (item: ComicItem) => pic(item.cachedCoverPath) ?? pic(item.coverUrl);
const score = (value: number | null) => value == null ? "暂无评分" : value.toFixed(1);
const stars = (value: number | null) => {
  const filled = value == null ? 0 : Math.max(0, Math.min(5, Math.round(value / 2)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
};

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
const curatedTags = (items: ExploreSubject[], limit = 24) => {
  const counts = new Map<string, number>();
  for (const item of items) for (const genre of item.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
};
const flattenCalendar = (calendar: WeeklyCalendar | null): ExploreSubject[] => {
  const seen = new Map<string, ExploreSubject>();
  for (const day of calendar?.days ?? []) for (const item of day.items) if (!seen.has(item.externalId)) seen.set(item.externalId, item);
  return [...seen.values()].sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || (right.ratingCount ?? 0) - (left.ratingCount ?? 0));
};

const FOLLOW_STATUS: { id: WorkStatus | "none"; label: string }[] = [
  { id: "none", label: "未追" },
  { id: "in_progress", label: "在看" },
  { id: "planned", label: "想看" },
  { id: "paused", label: "搁置" },
  { id: "completed", label: "看过" },
  { id: "dropped", label: "抛弃" },
];
const SUBJECT_TABS: { id: SubjectDetailTab; label: string }[] = [
  { id: "episodes", label: "剧集" },
  { id: "overview", label: "概览" },
  { id: "comments", label: "吐槽" },
  { id: "characters", label: "角色" },
  { id: "related", label: "关联" },
  { id: "staff", label: "制作人员" },
];
const statusIdOf = (subject: ExploreSubject): WorkStatus | "none" => subject.inLibrary ? (subject.localStatus ?? "planned") : "none";
const StatusIcon = ({ id, size = 16 }: { id: WorkStatus | "none"; size?: number }) =>
  id === "none" ? <Heart size={size} />
    : id === "in_progress" ? <Heart size={size} fill="currentColor" />
      : id === "planned" ? <Star size={size} />
        : id === "paused" ? <Clock size={size} />
          : id === "completed" ? <Check size={size} />
            : <HeartCrack size={size} />;

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
  const [calendar, setCalendar] = useState<WeeklyCalendar | null>(null);
  const [animeState, setAnimeState] = useState<LoadState>("loading");
  const [animeError, setAnimeError] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [seasonalTag, setSeasonalTag] = useState("");
  const [seasonalVisible, setSeasonalVisible] = useState(30);
  const [scheduleDay, setScheduleDay] = useState(weekdayNumber);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
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

  const [subject, setSubject] = useState<ExploreSubject | null>(null);
  const [subjectTab, setSubjectTab] = useState<SubjectDetailTab>("overview");
  const [descExpanded, setDescExpanded] = useState(false);
  const [statusSheet, setStatusSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comicDetail, setComicDetail] = useState<ComicItem | null>(null);
  const [structure, setStructure] = useState<AnimeWorkStructure | null>(null);
  const [structureState, setStructureState] = useState<LoadState>("ready");

  const sentinelRef = useRef<HTMLDivElement>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const backHandler = useRef<() => boolean>(() => false);
  backHandler.current = () => {
    if (statusSheet) { setStatusSheet(false); return true; }
    if (subject) { setSubject(null); return true; }
    if (comicDetail) { setComicDetail(null); return true; }
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
    const [overviewResult, calendarResult] = await Promise.allSettled([api.exploreOverview(), api.weeklyCalendar()]);
    if (overviewResult.status === "fulfilled") setTrending(overviewResult.value.trending.slice(0, 12));
    if (calendarResult.status === "fulfilled") setCalendar(calendarResult.value); else setCalendar(null);
    if (overviewResult.status === "rejected" && calendarResult.status === "rejected") {
      setAnimeError(String(overviewResult.reason)); setAnimeState("error");
    } else setAnimeState("ready");
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

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setSeasonalVisible(value => value + 30);
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, seasonalTag, tagsOpen, animeState]);

  useEffect(() => {
    const workId = subject?.localWorkId;
    setStructure(null);
    if (!workId) { setStructureState("ready"); return; }
    let cancelled = false;
    setStructureState("loading");
    api.getAnimeWorkStructure(workId)
      .then(value => { if (!cancelled) { setStructure(value); setStructureState("ready"); } })
      .catch(() => { if (!cancelled) { setStructure(null); setStructureState("error"); } });
    return () => { cancelled = true; };
  }, [subject]);

  const openSubject = async (item: ExploreSubject) => {
    setSubject(item); setSubjectTab(item.localWorkId ? "episodes" : "overview"); setDescExpanded(false); setSearchOpen(false); setTagsOpen(false);
    try { setSubject(await api.getExploreSubject(item.externalId)); } catch { /* keep list data */ }
  };

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

  const saveStatus = async (status: WorkStatus | "none") => {
    setStatusSheet(false);
    if (!subject) return;
    if (status === "none") { onToast("移出媒体库暂不支持，请选择追番状态"); return; }
    setSaving(true);
    try {
      await api.saveExploreSubject({ externalId: subject.externalId, status, favorite: subject.favorite });
      setSubject(await api.getExploreSubject(subject.externalId));
      onToast("追番状态已更新");
    } catch (reason) { onToast(String(reason)); }
    finally { setSaving(false); }
  };

  const saveComic = async (item: ComicItem) => {
    setSaving(true);
    try {
      await comicExploreApi.save(item.pathWord, true);
      onToast("已加入媒体库");
    } catch (reason) { onToast(String(reason)); }
    finally { setSaving(false); }
  };

  const playEpisode = async (mediaFileId: string) => {
    try { await androidApi.play(mediaFileId); }
    catch (reason) { onToast(String(reason)); }
  };

  const selectTag = (tag: string) => { setSeasonalTag(tag); setSeasonalVisible(30); };
  const selectDay = (next: number) => { setSlideDir(next >= scheduleDay ? "right" : "left"); setScheduleDay(next); };

  const animeCard = (item: ExploreSubject) => <button className="gz-cover" key={item.externalId} onClick={() => void openSubject(item)}>
    <span className="gz-explore-poster">{cover(item) ? <img src={cover(item)} alt="" loading="lazy" /> : <BookOpen size={24} />}</span>
    <span className="gz-cover-label">{item.title}</span>
  </button>;

  const comicCard = (item: ComicItem) => <button className="gz-cover" key={item.pathWord} onClick={() => setComicDetail(item)}>
    <span className="gz-explore-poster">{comicCover(item) ? <img src={comicCover(item)} alt="" loading="lazy" /> : <BookOpen size={24} />}</span>
    <span className="gz-cover-label">{item.title}</span>
  </button>;

  const scheduleRow = (item: ExploreSubject) => <button className="gz-sched-row" key={item.externalId} onClick={() => void openSubject(item)}>
    <span className="gz-sched-cover">{cover(item) ? <img src={cover(item)} alt="" loading="lazy" /> : <BookOpen size={20} />}</span>
    <span className="gz-sched-body">
      <strong>{item.title}</strong>
      <span className="gz-meta">{[subjectTypeLabels[item.subjectType], ...item.genres.slice(0, 3)].filter(Boolean).join(" · ")}</span>
    </span>
    {item.score != null && <span className="gz-sched-score"><Star size={12} />{score(item.score)}</span>}
  </button>;

  const today = weekdayNumber();
  const seasonal = useMemo(() => flattenCalendar(calendar), [calendar]);
  const todayItems = calendar?.days.find(day => day.weekday === today)?.items ?? [];
  const todayFeed = todayItems.length ? todayItems : trending;
  const seasonalItems = seasonalTag ? seasonal.filter(item => item.genres.includes(seasonalTag)) : seasonal;
  const tagChips = useMemo(() => curatedTags(seasonal), [seasonal]);
  const seasonLabel = seasonLabelOf(scheduleYear, scheduleMonth);
  const seasonYears = Array.from({ length: 10 }, (_, index) => currentCour.year - index);
  const scheduleDays = isCurrentCour ? calendar?.days ?? null : seasonDays;
  const scheduleItems = scheduleDays?.find(day => day.weekday === scheduleDay)?.items ?? [];
  const subjectStatusId = subject ? statusIdOf(subject) : "none";

  useLayoutEffect(() => {
    const container = daysRef.current;
    if (!container || !scheduleDays) { setPill(null); return; }
    const index = scheduleDays.findIndex(day => day.weekday === scheduleDay);
    const button = container.querySelectorAll<HTMLElement>("button")[index];
    if (!button) { setPill(null); return; }
    setPill({ left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight });
  }, [scheduleDay, scheduleDays, view, isCurrentCour]);

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
            {scheduleDays && <div className={`gz-sched-days${pill ? " has-pill" : ""}`} role="tablist" aria-label="星期" ref={daysRef}>
              <span className="gz-sched-pill" ref={pillRef} aria-hidden="true" style={pill ? { transform: `translate(${pill.left}px, ${pill.top}px)`, width: `${pill.width}px`, height: `${pill.height}px` } : undefined} />
              {scheduleDays.map(day => <button key={day.weekday} role="tab" aria-selected={scheduleDay === day.weekday} className={scheduleDay === day.weekday ? "active" : ""} onClick={() => selectDay(day.weekday)}>
                <span className="gz-sched-day-label">{isCurrentCour && day.weekday === today ? "今天" : day.label}</span>
                <span className="gz-sched-day-num">{day.items.length}</span>
              </button>)}
            </div>}
            {scheduleItems.length ? <div className={`gz-sched-list is-${slideDir}`} key={scheduleDay}>{scheduleItems.map(scheduleRow)}</div> : <div className="gz-empty"><BookOpen size={26} /><h2>这天没有番组</h2><p>{isCurrentCour ? "换一周中的其他日子看看。" : "换个季度或换一天看看。"}</p></div>}
          </>}
  </div>;

  const subjectView = subject && <div className="gz-subject">
    <div className="gz-subject-topbar">
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => setSubject(null)}><ArrowLeft size={20} /></button>
    </div>
    <section className="gz-subject-hero">
      <h1 className="gz-subject-title">{subject.title}</h1>
      {subject.originalTitle && <p className="gz-subject-original">{subject.originalTitle}</p>}
      <div className="gz-subject-body">
        <span className="gz-subject-cover">{cover(subject) ? <img src={cover(subject)} alt="" /> : <BookOpen size={28} />}</span>
        <div className="gz-subject-stats">
          <div className="gz-subject-stat"><span>放送开始:</span><strong>{subject.airDate ?? "未提供"}</strong></div>
          <div className="gz-subject-stat"><span>{subject.ratingCount > 0 ? `${subject.ratingCount} 人评分:` : "评分:"}</span><strong className="gz-subject-score">{score(subject.score)}<em>{stars(subject.score)}</em></strong></div>
          <div className="gz-subject-stat"><span>Bangumi Ranked:</span><strong>{subject.rank != null ? `#${subject.rank}` : "未上榜"}</strong></div>
          <button type="button" className="gz-status-pill" aria-haspopup="dialog" aria-expanded={statusSheet} disabled={saving} onClick={() => setStatusSheet(true)}>
            <StatusIcon id={subjectStatusId} /><span>{FOLLOW_STATUS.find(row => row.id === subjectStatusId)?.label}</span>
          </button>
        </div>
      </div>
    </section>
    <div className="gz-detail-tabs" role="tablist" aria-label="条目详情分类">
      {SUBJECT_TABS.map(tab => <button type="button" role="tab" key={tab.id} aria-selected={subjectTab === tab.id} className={subjectTab === tab.id ? "active" : ""} onClick={() => setSubjectTab(tab.id)}>{tab.label}</button>)}
    </div>
    {subjectTab === "episodes" && <section className="gz-section">
      {!subject.localWorkId
        ? <div className="gz-empty"><BookOpen size={26} /><h2>该条目尚未加入媒体库</h2><p>加入媒体库并关联本地文件后，这里会显示可播放的剧集。</p></div>
        : structureState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取剧集…</p>
          : structure && structure.episodes.length ? <>
            <div className="gz-section-head"><h2>剧集</h2><span className="gz-meta">{structure.episodes.length} 集</span></div>
            <div className="gz-episodes">{structure.episodes.map(episode => { const file = episode.localFiles[0]; const label = episode.episodeNumber != null ? `第 ${episode.episodeNumber} 集` : `#${episode.sortNumber}`; return <button className="gz-episode" key={episode.externalId} disabled={!file || file.missing} onClick={() => file && !file.missing && void playEpisode(file.id)}><div className="gz-episode-cover"><Play /><span>{label}</span></div><strong>{episode.title || label}</strong><span className="gz-meta">{file ? (file.missing ? "文件缺失" : file.fileName) : "无本地文件"}</span></button>; })}</div>
          </> : <div className="gz-empty"><BookOpen size={26} /><h2>暂无剧集资料</h2><p>Bangumi 未提供该条目的分集资料。</p></div>}
    </section>}
    {subjectTab === "overview" && <>
      <section className="gz-section">
        <div className="gz-section-head"><h2>简介</h2></div>
        <p className={`gz-description gz-clamp${descExpanded ? "" : " is-clamped"}`}>{subject.description || "Bangumi 未提供简介。"}</p>
        {subject.description.trim().length > 90 && <button className="gz-link" onClick={() => setDescExpanded(value => !value)}>{descExpanded ? "收起" : "加载更多"}</button>}
      </section>
      <section className="gz-section">
        <div className="gz-section-head"><h2>标签</h2>{subject.genres.length > 0 && <span className="gz-meta">{subject.genres.length} 个</span>}</div>
        {subject.genres.length ? <div className="gz-tag-grid">{subject.genres.map(genre => <span className="gz-tag" key={genre}>{genre}</span>)}</div> : <p className="gz-meta">暂无标签。</p>}
      </section>
      <section className="gz-section">
        <div className="gz-section-head"><h2>资料</h2></div>
        <div className="gz-subject-stats">
          <div className="gz-subject-stat"><span>类型:</span><strong>{subjectTypeLabels[subject.subjectType]}</strong></div>
          <div className="gz-subject-stat"><span>放送开始:</span><strong>{subject.airDate ?? "未提供"}</strong></div>
          <div className="gz-subject-stat"><span>收藏人数:</span><strong>{subject.collectionCount}</strong></div>
          <div className="gz-subject-stat"><span>数据来源:</span><strong>Bangumi</strong></div>
        </div>
      </section>
    </>}
    {subjectTab === "comments" && <section className="gz-section">
      <div className="gz-section-head"><h2>吐槽</h2><span className="gz-meta">Bangumi 条目评论</span></div>
      <div className="gz-empty"><MessageCircle size={26} /><h2>吐槽数据待接入</h2><p>吐槽来自 Bangumi 条目评论，后端接口尚未接入；接入后会在这里按时间展示真实评论。</p></div>
    </section>}
    {subjectTab === "characters" && <section className="gz-section">
      {structure && structure.characters.length
        ? <><div className="gz-section-head"><h2>角色</h2><span className="gz-meta">{structure.characters.length} 位</span></div><div className="gz-credit-list">{structure.characters.map(character => <div className="gz-credit" key={character.externalId}><span className="gz-credit-avatar">{character.name.slice(0, 1)}</span><span className="gz-credit-main"><strong>{character.name}</strong><span>{[character.role, character.actors.join(" / ")].filter(Boolean).join(" · ") || "角色"}</span></span></div>)}</div></>
        : <><div className="gz-section-head"><h2>角色</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>角色资料待接入</h2><p>角色来自 Bangumi 条目资料，后端接口尚未接入；接入后会在这里展示角色与声优。</p></div></>}
    </section>}
    {subjectTab === "related" && <section className="gz-section">
      {structure && structure.seasons.length
        ? <><div className="gz-section-head"><h2>关联</h2><span className="gz-meta">{structure.seasons.length} 部</span></div><div className="gz-related-list">{structure.seasons.map(season => <div className={`gz-related ${season.current ? "is-current" : ""}`} key={season.externalId}><span className="gz-credit-avatar">{season.title.slice(0, 1)}</span><span className="gz-related-main"><strong>{season.title}</strong><span>{[season.relation, season.seasonNumber ? `第 ${season.seasonNumber} 季` : null, season.current ? "当前作品" : null].filter(Boolean).join(" · ")}</span></span></div>)}</div></>
        : <><div className="gz-section-head"><h2>关联</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>关联资料待接入</h2><p>关联作品来自 Bangumi 条目资料，后端接口尚未接入；接入后会在这里展示系列与关联作品。</p></div></>}
    </section>}
    {subjectTab === "staff" && <section className="gz-section">
      {structure && structure.staff.length
        ? <><div className="gz-section-head"><h2>制作人员</h2><span className="gz-meta">{structure.staff.length} 位</span></div><div className="gz-credit-list">{structure.staff.map(credit => <div className="gz-credit" key={credit.externalId}><span className="gz-credit-avatar">{credit.name.slice(0, 1)}</span><span className="gz-credit-main"><strong>{credit.name}</strong><span>{credit.role}</span></span></div>)}</div></>
        : <><div className="gz-section-head"><h2>制作人员</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>制作人员待接入</h2><p>制作人员来自 Bangumi 条目资料，后端接口尚未接入；接入后会在这里展示。</p></div></>}
    </section>}
    {statusSheet && <div className="gz-scrim" onClick={() => setStatusSheet(false)}><section className="gz-sheet gz-status-sheet" role="dialog" aria-modal="true" aria-label="追番状态" onClick={event => event.stopPropagation()}>
      <span className="gz-sheet-handle" aria-hidden="true" />
      <h2 className="gz-sheet-title">追番状态</h2>
      <div className="gz-status-list">
        {FOLLOW_STATUS.map(row => <button type="button" key={row.id} className={`gz-status-row ${subjectStatusId === row.id ? "active" : ""}`} aria-pressed={subjectStatusId === row.id} disabled={saving} onClick={() => void saveStatus(row.id)}>
          <StatusIcon id={row.id} size={18} /><span>{row.label}</span>
        </button>)}
      </div>
    </section></div>}
  </div>;

  const comicDetailView = comicDetail && <div className="gz-subject">
    <div className="gz-subject-topbar">
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => setComicDetail(null)}><ArrowLeft size={20} /></button>
    </div>
    <section className="gz-subject-hero">
      <h1 className="gz-subject-title">{comicDetail.title}</h1>
      <div className="gz-subject-body">
        <span className="gz-subject-cover">{comicCover(comicDetail) ? <img src={comicCover(comicDetail)} alt="" /> : <BookOpen size={28} />}</span>
        <div className="gz-subject-stats">
          {comicDetail.authors.length > 0 && <div className="gz-subject-stat"><span>作者:</span><strong>{comicDetail.authors.join(" / ")}</strong></div>}
          <div className="gz-subject-stat"><span>来源:</span><strong>COPY 漫画</strong></div>
          <button type="button" className="gz-status-pill" disabled={saving} onClick={() => void saveComic(comicDetail)}><BookOpen size={16} /><span>加入媒体库</span></button>
        </div>
      </div>
    </section>
    <section className="gz-section">
      <div className="gz-section-head"><h2>简介</h2></div>
      <p className="gz-description">{comicDetail.summary || "来源未提供简介。"}</p>
    </section>
    {comicDetail.tags.length > 0 && <section className="gz-section">
      <div className="gz-section-head"><h2>标签</h2></div>
      <div className="gz-tag-grid">{comicDetail.tags.map(tag => <span className="gz-tag" key={tag}>{tag}</span>)}</div>
    </section>}
  </div>;

  if (subject) return <div className="gz-explore">{subjectView}</div>;
  if (comicDetail) return <div className="gz-explore">{comicDetailView}</div>;

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
          {seasonalItems.length ? <>
            <div className="gz-explore-grid">{seasonalItems.slice(0, seasonalVisible).map(animeCard)}</div>
            {seasonalItems.length > seasonalVisible && <div className="gz-sentinel" ref={sentinelRef} aria-hidden="true" />}
          </> : <p className="gz-panel gz-meta">{calendar ? (seasonalTag ? "这个标签下暂无番组。" : "本周放送日历里没有索引到番组。") : "正在读取当季番组…"}</p>}</section>
      </>)}
      <p className="gz-explore-source gz-meta">当季番组来自 Bangumi 每日放送接口（实时），与本地媒体库无关。</p>

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
      </> )}

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

  </div>;
}
