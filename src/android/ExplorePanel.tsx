import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, Clock, Download, Heart, HeartCrack, LoaderCircle, MessageCircle, Play, RefreshCw, Search, Star, Users, X } from "lucide-react";
import { api } from "../api";
import { androidApi } from "./api";
import type { AnimeWorkStructure, BangumiComment, ExploreSubject, WeeklyCalendar, WeeklyCalendarDay, WorkStatus } from "../types";
import { appendComicPage, comicExploreApi, novelExploreApi, type ComicDetail, type ComicItem, type ComicTheme, type CopyComment } from "../comicExplore";
import { appendSourcePage, bookContentApi, type SourceEntry, type SourcePage } from "../bookContent";
import BookReader from "./BookReader";
import { BANGUMI_NETWORK_CHANGED } from "../bangumiNetwork";

type ExploreTab = "anime" | "comic" | "novel";
type ExploreView = "feed" | "schedule";
type LoadState = "loading" | "ready" | "error";
type PopularSnapshot = { items: ExploreSubject[]; page: number; hasMore: boolean };
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
let animeExploreCache: { trending: ExploreSubject[]; seasonal: ExploreSubject[]; calendar: WeeklyCalendar | null; rankingPage: number; rankingHasMore: boolean; popularError: string } | null = null;
const comicExploreCache = new Map<string, ComicItem[]>();
let comicThemeCache: ComicTheme[] = [];
const bookExplorePages = new Map<string, ComicPageState>();

type ComicPageState = { page: number; total: number; items: ComicItem[]; stale: boolean };

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

type ExploreTransition = { finished: Promise<void> };
const startExploreTransition = (callback: () => void | Promise<void>): ExploreTransition | null => {
  const doc = document as Document & { startViewTransition?: (callback: () => void | Promise<void>) => ExploreTransition };
  if (typeof doc.startViewTransition !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  return doc.startViewTransition(callback);
};
const exploreCoverName = (id: string) => `gz-explore-cover-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export default function ExplorePanel({ onToast, registerBack }: { onToast: (message: string) => void; registerBack?: (handler: (() => boolean) | null) => void }) {
  const [tab, setTab] = useState<ExploreTab>("anime");
  const [view, setView] = useState<ExploreView>("feed");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [animeResults, setAnimeResults] = useState<ExploreSubject[]>([]);
  const [comicResults, setComicResults] = useState<ComicItem[]>([]);
  const [novelResults, setNovelResults] = useState<ComicItem[]>([]);

  const [trending, setTrending] = useState<ExploreSubject[]>(() => animeExploreCache?.trending ?? []);
  const [seasonal, setSeasonal] = useState<ExploreSubject[]>(() => animeExploreCache?.seasonal ?? []);
  const [calendar, setCalendar] = useState<WeeklyCalendar | null>(() => animeExploreCache?.calendar ?? null);
  const [animeState, setAnimeState] = useState<LoadState>(() => animeExploreCache ? "ready" : "loading");
  const [animeError, setAnimeError] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [seasonalVisible, setSeasonalVisible] = useState(30);
  const [rankingPage, setRankingPage] = useState(() => animeExploreCache?.rankingPage ?? 1);
  const [rankingHasMore, setRankingHasMore] = useState(() => animeExploreCache?.rankingHasMore ?? true);
  const [rankingLoadingMore, setRankingLoadingMore] = useState(false);
  const [scheduleDay, setScheduleDay] = useState(weekdayNumber);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
  const [currentCour] = useState(() => ({ year: new Date().getFullYear(), month: courStartMonth() }));
  const [scheduleYear, setScheduleYear] = useState(currentCour.year);
  const [scheduleMonth, setScheduleMonth] = useState(currentCour.month);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [seasonDays, setSeasonDays] = useState<WeeklyCalendarDay[] | null>(null);
  const [seasonState, setSeasonState] = useState<LoadState>("ready");
  const isCurrentCour = scheduleYear === currentCour.year && scheduleMonth === currentCour.month;

  const [themes, setThemes] = useState<ComicTheme[]>(() => comicThemeCache);
  const [theme, setTheme] = useState("");
  const [comics, setComics] = useState<ComicItem[]>(() => comicExploreCache.get("") ?? []);
  const [comicState, setComicState] = useState<LoadState>(() => comicExploreCache.has("") ? "ready" : "loading");
  const [comicError, setComicError] = useState("");
  const [novelThemes, setNovelThemes] = useState<ComicTheme[]>([]);
  const [novelTheme, setNovelTheme] = useState("");
  const [novels, setNovels] = useState<ComicItem[]>([]);
  const [novelState, setNovelState] = useState<LoadState>("loading");
  const [novelError, setNovelError] = useState("");
  const [bookPage, setBookPage] = useState(1);
  const [bookTotal, setBookTotal] = useState(0);
  const [bookLoadingMore, setBookLoadingMore] = useState(false);

  const [subject, setSubject] = useState<ExploreSubject | null>(null);
  const [subjectTab, setSubjectTab] = useState<SubjectDetailTab>("overview");
  const [descExpanded, setDescExpanded] = useState(false);
  const [statusSheet, setStatusSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comicDetail, setComicDetail] = useState<ComicDetail | null>(null);
  const [comicDetailKind, setComicDetailKind] = useState<"comic" | "novel">("comic");
  const [bookDetailState, setBookDetailState] = useState<LoadState>("ready");
  const [bookSource, setBookSource] = useState<SourcePage | null>(null);
  const [bookSourceState, setBookSourceState] = useState<LoadState>("ready");
  const [bookComments, setBookComments] = useState<CopyComment[]>([]);
  const [bookCommentsState, setBookCommentsState] = useState<LoadState>("ready");
  const [bookCommentsTotal, setBookCommentsTotal] = useState(0);
  const [bookCommentsLoadingMore, setBookCommentsLoadingMore] = useState(false);
  const [readerEntry, setReaderEntry] = useState<SourceEntry | null>(null);
  const [structure, setStructure] = useState<AnimeWorkStructure | null>(null);
  const [structureState, setStructureState] = useState<LoadState>("ready");
  const [subjectComments, setSubjectComments] = useState<BangumiComment[]>([]);
  const [subjectCommentsState, setSubjectCommentsState] = useState<LoadState>("ready");
  const [subjectCommentsTotal, setSubjectCommentsTotal] = useState(0);
  const [subjectCommentsLoadingMore, setSubjectCommentsLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const hotSentinelRef = useRef<HTMLDivElement>(null);
  const bookSentinelRef = useRef<HTMLDivElement>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const animeLoadRef = useRef(0);
  const popularSnapshotRef = useRef<PopularSnapshot | null>(null);
  const [popularLoading, setPopularLoading] = useState(false);
  const exploreCoverRef = useRef<HTMLElement | null>(null);
  const exploreDetailId = useRef<string | null>(null);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const backHandler = useRef<() => boolean>(() => false);
  const runExploreMorph = useCallback((id: string, direction: "forward" | "back", commit: () => void) => {
    document.querySelectorAll<HTMLElement>("[data-explore-cover-id]").forEach(node => node.style.removeProperty("view-transition-name"));
    const source = direction === "forward"
      ? document.querySelector<HTMLElement>(`[data-explore-cover-id="${CSS.escape(id)}"]`)
      : exploreCoverRef.current;
    if (!source) { commit(); return; }
    source.style.setProperty("view-transition-name", exploreCoverName(id));
    const root = document.documentElement;
    root.dataset.trans = "morph"; root.dataset.nav = direction;
    const transition = startExploreTransition(() => { flushSync(commit); document.querySelector<HTMLElement>(`[data-explore-cover-id="${CSS.escape(id)}"]`)?.style.setProperty("view-transition-name", exploreCoverName(id)); });
    if (!transition) {
      commit();
      window.setTimeout(() => { source.style.removeProperty("view-transition-name"); delete root.dataset.trans; delete root.dataset.nav; }, 420);
      return;
    }
    void transition.finished.finally(() => { source.style.removeProperty("view-transition-name"); document.querySelectorAll<HTMLElement>("[data-explore-cover-id]").forEach(node => node.style.removeProperty("view-transition-name")); delete root.dataset.trans; delete root.dataset.nav; });
  }, []);
  backHandler.current = () => {
    if (statusSheet) { setStatusSheet(false); return true; }
    if (subject) { const id = exploreDetailId.current ?? subject.externalId; runExploreMorph(id, "back", () => setSubject(null)); return true; }
    if (readerEntry) { setReaderEntry(null); return true; }
    if (comicDetail) { const id = comicDetail.item.pathWord; runExploreMorph(id, "back", () => setComicDetail(null)); return true; }
    if (seasonOpen) { setSeasonOpen(false); return true; }
    if (view === "schedule") { setView("feed"); return true; }
    return false;
  };
  useEffect(() => {
    if (!registerBack) return;
    registerBack(() => backHandler.current());
    return () => registerBack(null);
  }, [registerBack]);

  const loadAnime = useCallback(async (force = false) => {
    if (!force && animeExploreCache) {
      setTrending(animeExploreCache.trending);
      setSeasonal(animeExploreCache.seasonal);
      setCalendar(animeExploreCache.calendar);
      setRankingPage(animeExploreCache.rankingPage); setRankingHasMore(animeExploreCache.rankingHasMore);
      popularSnapshotRef.current = { items: animeExploreCache.trending, page: animeExploreCache.rankingPage, hasMore: animeExploreCache.rankingHasMore };
      setAnimeError(animeExploreCache.popularError); setPopularLoading(false);
      setAnimeState("ready");
      return;
    }
    const loadId = ++animeLoadRef.current;
    popularSnapshotRef.current = null;
    const active = () => animeLoadRef.current === loadId;
    setAnimeState("loading"); setAnimeError(""); setPopularLoading(true);
    let rankingError: unknown = null;
    let overviewError: unknown = null;
    let calendarError: unknown = null;
    const rankingTask = api.animePopular(1, force).then(value => {
      if (active()) {
        popularSnapshotRef.current = { items: value.items, page: 1, hasMore: value.hasMore };
        setTrending(value.items); setRankingPage(1); setRankingHasMore(value.hasMore); setPopularLoading(false); setAnimeState("ready");
      }
      return value;
    }).catch(reason => { rankingError = reason; if (active()) { setPopularLoading(false); setAnimeError(String(reason)); } return null; });
    const overviewTask = api.exploreOverview().then(value => {
      if (active()) {
        setSeasonal(value.seasonal);
        setAnimeState("ready");
      }
      return value;
    }).catch(reason => { overviewError = reason; return null; });
    const calendarTask = api.weeklyCalendar().then(value => {
      if (active()) setCalendar(value);
      return value;
    }).catch(reason => { calendarError = reason; return null; });
    const [ranking, overview, calendar] = await Promise.all([rankingTask, overviewTask, calendarTask]);
    if (!active()) return;
    // Pagination can update this ref while the independent calendar/overview requests finish.
    const popularSnapshot = popularSnapshotRef.current as PopularSnapshot | null;
    const nextTrending = popularSnapshot?.items ?? [];
    const nextSeasonal = overview?.seasonal ?? [];
    if (ranking || overview || calendar) {
      setTrending(nextTrending);
      setSeasonal(nextSeasonal);
      setCalendar(calendar);
      const nextRankingPage = popularSnapshot?.page ?? 1;
      const nextRankingHasMore = popularSnapshot?.hasMore ?? false;
      setRankingPage(nextRankingPage); setRankingHasMore(nextRankingHasMore);
      const popularError = rankingError ? String(rankingError) : "";
      setAnimeError(popularError);
      animeExploreCache = { trending: nextTrending, seasonal: nextSeasonal, calendar, rankingPage: nextRankingPage, rankingHasMore: nextRankingHasMore, popularError };
      setAnimeState("ready");
    } else {
      setAnimeError(String(overviewError ?? rankingError ?? calendarError ?? "Bangumi 数据读取失败。"));
      setAnimeState("error");
    }
  }, []);

  const loadMoreRanking = useCallback(async () => {
    if (rankingLoadingMore || !rankingHasMore) return;
    const loadId = animeLoadRef.current;
    setRankingLoadingMore(true);
    try {
      const page = rankingPage + 1;
      const next = await api.animePopular(page);
      if (loadId !== animeLoadRef.current) return;
      const hasMore = next.hasMore;
      const items = [...new Map([...(popularSnapshotRef.current?.items ?? []), ...next.items].map(item => [item.externalId, item])).values()];
      popularSnapshotRef.current = { items, page, hasMore };
      setTrending(items);
      setRankingPage(page); setRankingHasMore(hasMore);
      animeExploreCache = animeExploreCache ? { ...animeExploreCache, trending: items, rankingPage: page, rankingHasMore: hasMore } : animeExploreCache;
    } catch (reason) { onToast(String(reason)); }
    finally { setRankingLoadingMore(false); }
  }, [onToast, rankingHasMore, rankingLoadingMore, rankingPage]);

  const loadBooks = useCallback(async (kind: "comic" | "novel", nextTheme: string, nextPage = 1, append = false) => {
    const key = `${kind}:${nextTheme}`;
    const cached = bookExplorePages.get(key);
    if (!append && nextPage === 1 && cached) {
      if (kind === "comic") { setComics(cached.items); setComicState("ready"); }
      else { setNovels(cached.items); setNovelState("ready"); }
      setBookPage(cached.page); setBookTotal(cached.total);
      return;
    }
    if (append) setBookLoadingMore(true);
    else if (kind === "comic") { setComicState("loading"); setComicError(""); }
    else { setNovelState("loading"); setNovelError(""); }
    try {
      const page = kind === "comic"
        ? await comicExploreApi.list({ query: "", theme: nextTheme, top: "", sort: "popular", page: nextPage })
        : await novelExploreApi.list({ query: "", theme: nextTheme, top: "", sort: "popular", page: nextPage });
      const previous = append && cached ? { items: cached.items, total: cached.total, page: cached.page, stale: cached.stale } : { items: [], total: 0, page: 0, stale: false };
      const merged = append && previous.page > 0 ? appendComicPage(previous, page) : page;
      bookExplorePages.set(key, { items: merged.items, total: merged.total, page: page.page, stale: merged.stale });
      if (kind === "comic") { comicExploreCache.set(nextTheme, merged.items); setComics(merged.items); setComicState("ready"); }
      else { setNovels(merged.items); setNovelState("ready"); }
      setBookPage(page.page); setBookTotal(merged.total);
    } catch (reason) {
      if (kind === "comic") { setComicError(String(reason)); setComicState("error"); }
      else { setNovelError(String(reason)); setNovelState("error"); }
    } finally { setBookLoadingMore(false); }
  }, []);

  useEffect(() => { void loadAnime(); }, [loadAnime]);
  useEffect(() => {
    const changed = () => { animeExploreCache = null; void loadAnime(true); };
    window.addEventListener(BANGUMI_NETWORK_CHANGED, changed);
    return () => window.removeEventListener(BANGUMI_NETWORK_CHANGED, changed);
  }, [loadAnime]);
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
    if (!themes.length) void comicExploreApi.themes().then(value => { comicThemeCache = value; setThemes(value); }).catch(() => {});
    void loadBooks("comic", theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "novel") return;
    if (!novelThemes.length) void novelExploreApi.themes().then(setNovelThemes).catch(() => {});
    void loadBooks("novel", novelTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const node = bookSentinelRef.current;
    if (!node || (tab !== "comic" && tab !== "novel")) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || bookLoadingMore || bookPage * 24 >= bookTotal) return;
      void loadBooks(tab, tab === "comic" ? theme : novelTheme, bookPage + 1, true);
    }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [bookLoadingMore, bookPage, bookTotal, loadBooks, novelTheme, tab, theme]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setSeasonalVisible(value => value + 30);
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, selectedTags, tagsOpen, animeState]);

  useEffect(() => {
    const node = hotSentinelRef.current;
    if (!node || tab !== "anime" || !rankingHasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreRanking();
    }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMoreRanking, rankingHasMore, tab, trending.length, selectedTags.length]);

  useEffect(() => {
    const workId = subject?.localWorkId;
    setStructure(null);
    if (!subject) { setStructureState("ready"); return; }
    let cancelled = false;
    setStructureState("loading");
    (workId ? api.getAnimeWorkStructure(workId) : api.getBangumiSubjectStructure(subject.externalId))
      .then(value => { if (!cancelled) { setStructure(value); setStructureState("ready"); } })
      .catch(() => { if (!cancelled) { setStructure(null); setStructureState("error"); } });
    return () => { cancelled = true; };
  }, [subject]);

  useEffect(() => {
    exploreCoverRef.current = subject || comicDetail
      ? document.querySelector<HTMLElement>(`[data-explore-cover-id="${CSS.escape(subject?.externalId ?? comicDetail?.item.pathWord ?? "")}"]`)
      : null;
  });

  const openSubject = async (item: ExploreSubject) => {
    exploreDetailId.current = item.externalId;
    runExploreMorph(item.externalId, "forward", () => { setSubject(item); setSubjectTab(item.localWorkId ? "episodes" : "overview"); setDescExpanded(false); setSearchOpen(false); setTagsOpen(false); });
    setSubjectComments([]); setSubjectCommentsState("loading"); setSubjectCommentsTotal(0);
    try { setSubject(await api.getExploreSubject(item.externalId)); } catch { /* keep list data */ }
    try {
      const comments = await api.bangumiComments(item.externalId);
      setSubjectComments(comments.items); setSubjectCommentsTotal(comments.total); setSubjectCommentsState("ready");
    } catch { setSubjectCommentsState("error"); }
  };

  const openBook = async (item: ComicItem, kind: "comic" | "novel") => {
    setComicDetailKind(kind);
    runExploreMorph(item.pathWord, "forward", () => setComicDetail({ item, aliases: [], chapterCount: null, stale: false }));
    setBookDetailState("loading"); setBookSource(null); setBookSourceState("loading");
    setBookComments([]); setBookCommentsState("loading"); setBookCommentsTotal(0); setBookCommentsLoadingMore(false);
    try {
      const [detail, source] = await Promise.all([
        kind === "comic" ? comicExploreApi.detail(item.pathWord) : novelExploreApi.detail(item.pathWord),
        bookContentApi.entries(kind, item.pathWord),
      ]);
      setComicDetail(detail); setBookDetailState("ready"); setBookSource(source); setBookSourceState("ready");
    } catch (reason) {
      setBookDetailState("error"); setBookSourceState("error");
      onToast(String(reason));
    }
    try {
      const comments = kind === "comic" ? await comicExploreApi.comments(item.pathWord) : await novelExploreApi.comments(item.pathWord);
      setBookComments(comments.items); setBookCommentsTotal(comments.total); setBookCommentsState("ready");
    } catch {
      setBookCommentsState("error");
    }
  };

  const loadMoreBookComments = async () => {
    if (!comicDetail || bookCommentsLoadingMore || bookComments.length >= bookCommentsTotal) return;
    setBookCommentsLoadingMore(true);
    try {
      const next = comicDetailKind === "comic"
        ? await comicExploreApi.comments(comicDetail.item.pathWord, bookComments.length)
        : await novelExploreApi.comments(comicDetail.item.pathWord, bookComments.length);
      setBookComments(previous => [...new Map([...previous, ...next.items].map(comment => [comment.id, comment])).values()]);
      setBookCommentsTotal(next.total);
    } catch (reason) { onToast(String(reason)); }
    finally { setBookCommentsLoadingMore(false); }
  };

  const loadMoreSubjectComments = async () => {
    if (!subject || subjectCommentsLoadingMore || subjectComments.length >= subjectCommentsTotal) return;
    setSubjectCommentsLoadingMore(true);
    try {
      const next = await api.bangumiComments(subject.externalId, subjectComments.length);
      setSubjectComments(previous => [...new Map([...previous, ...next.items].map(comment => [comment.id, comment])).values()]);
      setSubjectCommentsTotal(next.total);
    } catch (reason) { onToast(String(reason)); }
    finally { setSubjectCommentsLoadingMore(false); }
  };

  const loadMoreBookEntries = async () => {
    if (!bookSource || bookSource.entries.length >= bookSource.total || bookSourceState === "loading") return;
    setBookSourceState("loading");
    try {
      const next = await bookContentApi.entries(comicDetailKind, comicDetail?.item.pathWord ?? "", bookSource.group, bookSource.offset + bookSource.entries.length);
      setBookSource(appendSourcePage(bookSource, next)); setBookSourceState("ready");
    } catch (reason) { setBookSourceState("error"); onToast(String(reason)); }
  };

  const switchTab = (next: ExploreTab) => {
    setTab(next);
    setSearchTerm(null); setQuery(""); setSearchOpen(false);
    setAnimeResults([]); setComicResults([]); setNovelResults([]);
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
      } else {
        const page = await novelExploreApi.list({ query: term, theme: "", top: "", sort: "popular", page: 1 });
        setNovelResults(page.items);
      }
    } catch (reason) { onToast(String(reason)); }
    finally { setSearching(false); }
  };

  const clearSearch = () => { setSearchTerm(null); setQuery(""); setAnimeResults([]); setComicResults([]); setNovelResults([]); };

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

  const saveBook = async (item: ComicItem, kind: "comic" | "novel") => {
    setSaving(true);
    try {
      if (kind === "comic") await comicExploreApi.save(item.pathWord, true);
      else await novelExploreApi.save(item.pathWord, true);
      onToast("已加入书架");
    } catch (reason) { onToast(String(reason)); }
    finally { setSaving(false); }
  };

  const playEpisode = async (mediaFileId: string) => {
    try { await androidApi.play(mediaFileId); }
    catch (reason) { onToast(String(reason)); }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(tags => tags.includes(tag) ? tags.filter(value => value !== tag) : [...tags, tag]);
    setSeasonalVisible(30);
  };
  const selectDay = (next: number) => { setSlideDir(next >= scheduleDay ? "right" : "left"); setScheduleDay(next); };

  const animeCard = (item: ExploreSubject) => <button className="gz-cover" key={item.externalId} onClick={() => void openSubject(item)}>
    <span className="gz-explore-poster" data-explore-cover-id={item.externalId}>{cover(item) ? <img src={cover(item)} alt="" loading="lazy" /> : <BookOpen size={24} />}</span>
    <span className="gz-cover-label">{item.title}</span>
  </button>;

  const comicCard = (item: ComicItem, kind: "comic" | "novel" = "comic") => <button className="gz-cover" key={item.pathWord} onClick={() => void openBook(item, kind)}>
    <span className="gz-explore-poster" data-explore-cover-id={item.pathWord}>{comicCover(item) ? <img src={comicCover(item)} alt="" loading="lazy" /> : <BookOpen size={24} />}</span>
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
  const popularItems = trending;
  const hotItems = selectedTags.length
    ? popularItems.filter(item => selectedTags.some(tag => item.genres.includes(tag)))
    : popularItems;
  const tagChips = useMemo(() => curatedTags(popularItems), [popularItems]);
  const seasonalItems = seasonal;
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
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => { const id = exploreDetailId.current ?? subject.externalId; runExploreMorph(id, "back", () => setSubject(null)); }}><ArrowLeft size={20} /></button>
    </div>
    <section className="gz-subject-hero">
      <h1 className="gz-subject-title">{subject.title}</h1>
      {subject.originalTitle && <p className="gz-subject-original">{subject.originalTitle}</p>}
      <div className="gz-subject-body">
        <span className="gz-subject-cover" data-explore-cover-id={subject.externalId}>{cover(subject) ? <img src={cover(subject)} alt="" /> : <BookOpen size={28} />}</span>
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
      {structureState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取剧集…</p>
          : structure && structure.episodes.length ? <>
            <div className="gz-section-head"><h2>剧集</h2><span className="gz-meta">{structure.episodes.length} 集</span></div>
            <div className="gz-episodes">{structure.episodes.map(episode => { const file = episode.localFiles[0]; const label = episode.episodeNumber != null ? `第 ${episode.episodeNumber} 集` : `#${episode.sortNumber}`; return <button className="gz-episode" key={episode.externalId} disabled={!file || file.missing} onClick={() => file && !file.missing && void playEpisode(file.id)}><div className="gz-episode-cover"><Play /><span>{label}</span></div><strong>{episode.title || label}</strong><span className="gz-meta">{file ? (file.missing ? "文件缺失" : file.fileName) : "未关联本地文件"}</span></button>; })}</div>
          </> : structureState === "error" ? <div className="gz-error" role="alert"><span>Bangumi 分集资料读取失败。</span><button className="gz-iconbtn" aria-label="重试分集资料" onClick={() => setSubject({ ...subject })}><RefreshCw size={16} /></button></div> : <div className="gz-empty"><BookOpen size={26} /><h2>暂无剧集资料</h2><p>Bangumi 未提供该条目的分集资料。</p></div>}
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
        {structure?.warnings.map((warning, index) => <p className="gz-meta" key={`${warning}-${index}`}>{warning}</p>)}
      </section>
    </>}
    {subjectTab === "comments" && <section className="gz-section">
      <div className="gz-section-head"><h2>吐槽</h2><span className="gz-meta">Bangumi 条目评论</span></div>
      {subjectCommentsState === "loading" ? <p className="gz-loading"><LoaderCircle className="gz-spin" />正在读取吐槽…</p>
        : subjectCommentsState === "error" ? <div className="gz-error" role="alert"><span>吐槽读取失败，请检查 Bangumi 网络设置。</span><button className="gz-iconbtn" aria-label="重试吐槽" onClick={() => void api.bangumiComments(subject.externalId).then(page => { setSubjectComments(page.items); setSubjectCommentsTotal(page.total); setSubjectCommentsState("ready"); }).catch(() => setSubjectCommentsState("error"))}><RefreshCw size={16} /></button></div>
          : subjectComments.length ? <><div className="gz-credit-list">{subjectComments.map(comment => <article className="gz-credit" key={comment.id}><span className="gz-credit-avatar">{comment.userName.slice(0, 1) || "匿"}</span><span className="gz-credit-main"><strong>{comment.userName || "匿名用户"}</strong><span>{comment.comment}</span></span></article>)}</div>{subjectComments.length < subjectCommentsTotal && <button className="gz-btn" type="button" disabled={subjectCommentsLoadingMore} onClick={() => void loadMoreSubjectComments()}>{subjectCommentsLoadingMore ? "加载中…" : "加载更多吐槽"}</button>}</>
          : <div className="gz-empty"><MessageCircle size={26} /><h2>暂无吐槽</h2><p>Bangumi 尚未提供该条目的公开吐槽。</p></div>}
    </section>}
    {subjectTab === "characters" && <section className="gz-section">
      {structureState === "loading" ? <p className="gz-loading"><LoaderCircle className="gz-spin" />正在读取角色资料…</p> : structure && structure.characters.length
        ? <><div className="gz-section-head"><h2>角色</h2><span className="gz-meta">{structure.characters.length} 位</span></div><div className="gz-credit-list">{structure.characters.map(character => <div className="gz-credit" key={character.externalId}><span className="gz-credit-avatar">{character.name.slice(0, 1)}</span><span className="gz-credit-main"><strong>{character.name}</strong><span>{[character.role, character.actors.join(" / ")].filter(Boolean).join(" · ") || "角色"}</span></span></div>)}</div></>
        : <><div className="gz-section-head"><h2>角色</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>{structureState === "error" ? "角色资料读取失败" : "暂无角色资料"}</h2><p>{structureState === "error" ? "请检查网络设置后重试。" : "Bangumi 尚未提供该条目的角色与声优。"}</p></div></>}
    </section>}
    {subjectTab === "related" && <section className="gz-section">
      {structureState === "loading" ? <p className="gz-loading"><LoaderCircle className="gz-spin" />正在读取关联作品…</p> : structure && structure.seasons.length
        ? <><div className="gz-section-head"><h2>关联</h2><span className="gz-meta">{structure.seasons.length} 部</span></div><div className="gz-related-list">{structure.seasons.map(season => <div className={`gz-related ${season.current ? "is-current" : ""}`} key={season.externalId}><span className="gz-credit-avatar">{season.title.slice(0, 1)}</span><span className="gz-related-main"><strong>{season.title}</strong><span>{[season.relation, season.seasonNumber ? `第 ${season.seasonNumber} 季` : null, season.current ? "当前作品" : null].filter(Boolean).join(" · ")}</span></span></div>)}</div></>
        : <><div className="gz-section-head"><h2>关联</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>{structureState === "error" ? "关联资料读取失败" : "暂无关联作品"}</h2><p>{structureState === "error" ? "请检查网络设置后重试。" : "Bangumi 尚未提供该条目的关联作品。"}</p></div></>}
    </section>}
    {subjectTab === "staff" && <section className="gz-section">
      {structureState === "loading" ? <p className="gz-loading"><LoaderCircle className="gz-spin" />正在读取制作人员…</p> : structure && structure.staff.length
        ? <><div className="gz-section-head"><h2>制作人员</h2><span className="gz-meta">{structure.staff.length} 位</span></div><div className="gz-credit-list">{structure.staff.map(credit => <div className="gz-credit" key={credit.externalId}><span className="gz-credit-avatar">{credit.name.slice(0, 1)}</span><span className="gz-credit-main"><strong>{credit.name}</strong><span>{credit.role}</span></span></div>)}</div></>
        : <><div className="gz-section-head"><h2>制作人员</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>{structureState === "error" ? "制作人员读取失败" : "暂无制作人员资料"}</h2><p>{structureState === "error" ? "请检查网络设置后重试。" : "Bangumi 尚未提供该条目的制作人员。"}</p></div></>}
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
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => runExploreMorph(comicDetail.item.pathWord, "back", () => setComicDetail(null))}><ArrowLeft size={20} /></button>
    </div>
    <section className="gz-subject-hero">
      <h1 className="gz-subject-title">{comicDetail.item.title}</h1>
      <div className="gz-subject-body">
        <span className="gz-subject-cover" data-explore-cover-id={comicDetail.item.pathWord}>{comicCover(comicDetail.item) ? <img src={comicCover(comicDetail.item)} alt="" /> : <BookOpen size={28} />}</span>
        <div className="gz-subject-stats">
          {comicDetail.item.authors.length > 0 && <div className="gz-subject-stat"><span>作者:</span><strong>{comicDetail.item.authors.join(" / ")}</strong></div>}
          <div className="gz-subject-stat"><span>来源:</span><strong>COPY {comicDetailKind === "comic" ? "漫画" : "轻小说"}</strong></div>
          <div className="gz-subject-stat"><span>章节:</span><strong>{comicDetail.chapterCount ?? (bookSource?.total ?? "—")}</strong></div>
          <button type="button" className="gz-status-pill" disabled={saving} onClick={() => void saveBook(comicDetail.item, comicDetailKind)}><BookOpen size={16} /><span>加入书架</span></button>
        </div>
      </div>
    </section>
    {bookDetailState === "loading" && <p className="gz-loading"><LoaderCircle className="gz-spin" />正在读取作品资料…</p>}
    {bookDetailState === "error" && <div className="gz-error" role="alert"><span>作品资料读取失败，当前显示列表缓存。</span><button className="gz-iconbtn" aria-label="重试作品资料" onClick={() => void openBook(comicDetail.item, comicDetailKind)}><RefreshCw size={16} /></button></div>}
    <section className="gz-section">
      <div className="gz-section-head"><h2>简介</h2></div>
      <p className="gz-description">{comicDetail.item.summary || "来源未提供简介。"}</p>
    </section>
    {comicDetail.item.tags.length > 0 && <section className="gz-section">
      <div className="gz-section-head"><h2>标签</h2></div>
      <div className="gz-tag-grid">{comicDetail.item.tags.map(tag => <span className="gz-tag" key={tag}>{tag}</span>)}</div>
    </section>}
    <section className="gz-section gz-book-source" aria-label="在线章节">
      <div className="gz-section-head"><div><h2>在线章节</h2><p className="gz-meta">来自 COPY，可直接在应用内阅读</p></div></div>
      {bookSourceState === "loading" && <p className="gz-loading"><LoaderCircle className="gz-spin" />正在读取章节目录…</p>}
      {bookSourceState === "error" && <div className="gz-error" role="alert"><span>章节目录读取失败，请重试。</span><button className="gz-iconbtn" aria-label="重试章节目录" onClick={() => void openBook(comicDetail.item, comicDetailKind)}><RefreshCw size={16} /></button></div>}
      {bookSourceState === "ready" && bookSource?.entries.length ? <>
        <div className="gz-chapter-grid">{bookSource.entries.map(entry => <div className="gz-chapter-card" key={entry.id}><button type="button" className="gz-chapter" onClick={() => setReaderEntry(entry)}><strong>{entry.title}</strong><span className="gz-chapter-badge">{entry.count ? `${entry.count} 页` : "在线"}</span></button><button type="button" className="gz-iconbtn gz-chapter-download" aria-label={`下载${entry.title}`} disabled={saving} onClick={() => void (async () => { setSaving(true); try { await bookContentApi.cache(comicDetailKind, comicDetail.item.pathWord, entry.id, bookSource.group); onToast(`${entry.title} 已缓存，可离线阅读`); } catch (reason) { onToast(String(reason)); } finally { setSaving(false); } })()}><Download size={16} /></button></div>)}</div>
        {bookSource.entries.length < bookSource.total && <button type="button" className="gz-btn" onClick={() => void loadMoreBookEntries()}>加载更多章节</button>}
      </> : bookSourceState === "ready" ? <p className="gz-panel gz-meta">来源暂未提供章节目录。</p> : null}
    </section>
    <section className="gz-section">
      <div className="gz-section-head"><h2>评论</h2><span className="gz-meta">COPY</span></div>
      {bookCommentsState === "loading" ? <p className="gz-loading"><LoaderCircle className="gz-spin" />正在读取评论…</p>
        : bookCommentsState === "error" ? <p className="gz-meta">评论暂时无法读取，请检查阅读网络设置。</p>
          : bookComments.length ? <div className="gz-credit-list">{bookComments.map(comment => <article className="gz-credit" key={comment.id}><span className="gz-credit-avatar">{comment.userName.slice(0, 1) || "匿"}</span><span className="gz-credit-main"><strong>{comment.userName || "匿名用户"}</strong><span>{comment.comment}</span></span></article>)}</div>
            : <p className="gz-meta">暂无评论。</p>}
      {bookComments.length > 0 && bookComments.length < bookCommentsTotal && <button className="gz-btn" type="button" disabled={bookCommentsLoadingMore} onClick={() => void loadMoreBookComments()}>{bookCommentsLoadingMore ? "加载中…" : "加载更多评论"}</button>}
    </section>
  </div>;

  if (subject) return <div className="gz-explore">{subjectView}</div>;
  if (comicDetail) return <div className="gz-explore">{comicDetailView}{readerEntry && <BookReader kind={comicDetailKind} pathWord={comicDetail.item.pathWord} entryId={readerEntry.id} group={bookSource?.group ?? ""} onClose={() => setReaderEntry(null)} />}</div>;

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
        <button className="gz-btn" onClick={() => void loadAnime(true)}><RefreshCw size={16} />重试</button>
      </> : animeState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取 Bangumi 数据…</p> : <>
        <section className="gz-section"><div className="gz-section-head">
          <button className="gz-section-toggle" aria-expanded={tagsOpen} onClick={() => setTagsOpen(value => !value)}>
            <h2>热门番组</h2><ChevronDown size={16} className={tagsOpen ? "is-open" : ""} />
          </button>
          <span className="gz-meta">{hotItems.length} 部</span></div>
          {tagsOpen && <div className="gz-chips" role="group" aria-label="热门番组标签">
            {tagChips.map(tag => <button key={tag} className={`gz-chip ${selectedTags.includes(tag) ? "active" : ""}`} role="checkbox" aria-checked={selectedTags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>)}
            {selectedTags.length > 0 && <button className="gz-link" onClick={() => { setSelectedTags([]); setSeasonalVisible(30); }}>清除</button>}
          </div>}
          {popularLoading ? <p className="gz-loading"><LoaderCircle />正在读取热门番组…</p> : animeError ? <>
            <div className="gz-error" role="alert">{animeError}</div><button className="gz-btn" onClick={() => void loadAnime(true)}><RefreshCw size={16} />重试热门番组</button>
          </> : hotItems.length ? <><div className="gz-explore-grid">{hotItems.map(animeCard)}</div>{rankingHasMore && selectedTags.length === 0 && <div className="gz-sentinel" ref={hotSentinelRef} aria-hidden="true" />}{rankingLoadingMore && <p className="gz-loading"><LoaderCircle className="gz-spin" />正在加载更多热门番组…</p>}</> : <p className="gz-panel gz-meta">没有符合所选标签的热门番组。</p>}
        </section>
        <section className="gz-section"><div className="gz-section-head"><h2>当季番组</h2>
          <button className="gz-link" onClick={() => setView("schedule")}><CalendarDays size={16} />时间表<ChevronRight size={16} /></button></div>
          {seasonalItems.length ? <>
            <div className="gz-explore-grid">{seasonalItems.slice(0, seasonalVisible).map(animeCard)}</div>
            {seasonalItems.length > seasonalVisible && <div className="gz-sentinel" ref={sentinelRef} aria-hidden="true" />}
          </> : <p className="gz-panel gz-meta">{calendar ? "本周放送日历里没有索引到番组。" : "正在读取当季番组…"}</p>}</section>
      </>)}
      {tab === "anime" && <p className="gz-explore-source gz-meta">热门番组按 Bangumi 动画目录热度排序；当季番组来自每日放送接口。{trending.some(item => item.stale) ? "热门番组当前显示离线缓存。" : ""}</p>}

      {tab === "comic" && (searchTerm !== null ? <>
        <p className="gz-meta">「{searchTerm}」共 {comicResults.length} 条</p>
        {searching ? <p className="gz-loading"><LoaderCircle />正在搜索…</p> : comicResults.length
          ? <div className="gz-explore-grid">{comicResults.map(item => comicCard(item))}</div>
          : <div className="gz-empty"><Search size={26} /><h2>没有匹配的漫画</h2><p>换一个关键词再试。</p></div>}
      </> : <>
        <div className="gz-chips" role="radiogroup" aria-label="漫画主题">
          <button className={`gz-chip ${theme === "" ? "active" : ""}`} role="radio" aria-checked={theme === ""} onClick={() => { setTheme(""); void loadBooks("comic", ""); }}>全部</button>
          {themes.map(item => <button key={item.pathWord} className={`gz-chip ${theme === item.pathWord ? "active" : ""}`} role="radio" aria-checked={theme === item.pathWord} onClick={() => { setTheme(item.pathWord); void loadBooks("comic", item.pathWord); }}>{item.name}</button>)}
        </div>
        {comicState === "error" ? <>
          <div className="gz-error" role="alert"><span>{comicError || "漫画来源读取失败。"}</span></div>
          <button className="gz-btn" onClick={() => void loadBooks("comic", theme)}><RefreshCw size={16} />重试</button>
        </> : comicState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取漫画来源…</p> : comics.length
           ? <><div className="gz-explore-grid">{comics.map(item => comicCard(item))}</div>{comics.length < bookTotal && <div className="gz-sentinel" ref={bookSentinelRef} aria-hidden="true" />}{bookLoadingMore && <p className="gz-loading"><LoaderCircle className="gz-spin" />正在加载更多…</p>}</>
          : <div className="gz-empty"><BookOpen size={26} /><h2>没有漫画</h2><p>这个主题下暂无作品。</p></div>}
      </> )}

      {tab === "novel" && (searchTerm !== null ? <>
        <p className="gz-meta">「{searchTerm}」共 {novelResults.length} 条</p>
        {searching ? <p className="gz-loading"><LoaderCircle />正在搜索…</p> : novelResults.length
          ? <div className="gz-explore-grid">{novelResults.map(item => comicCard(item, "novel"))}</div>
          : <div className="gz-empty"><Search size={26} /><h2>没有匹配的轻小说</h2><p>换一个关键词再试。</p></div>}
      </> : <>
        <div className="gz-chips" role="radiogroup" aria-label="轻小说题材">
          <button className={`gz-chip ${novelTheme === "" ? "active" : ""}`} role="radio" aria-checked={novelTheme === ""} onClick={() => { setNovelTheme(""); void loadBooks("novel", ""); }}>全部</button>
          {novelThemes.map(item => <button key={item.pathWord} className={`gz-chip ${novelTheme === item.pathWord ? "active" : ""}`} role="radio" aria-checked={novelTheme === item.pathWord} onClick={() => { setNovelTheme(item.pathWord); void loadBooks("novel", item.pathWord); }}>{item.name}</button>)}
        </div>
        {novelState === "error" ? <><div className="gz-error" role="alert"><span>{novelError || "轻小说来源读取失败。"}</span></div><button className="gz-btn" onClick={() => void loadBooks("novel", novelTheme)}><RefreshCw size={16} />重试</button></>
          : novelState === "loading" ? <p className="gz-loading"><LoaderCircle />正在读取轻小说来源…</p>
            : novels.length ? <><div className="gz-explore-grid">{novels.map(item => comicCard(item, "novel"))}</div>{novels.length < bookTotal && <div className="gz-sentinel" ref={bookSentinelRef} aria-hidden="true" />}{bookLoadingMore && <p className="gz-loading"><LoaderCircle className="gz-spin" />正在加载更多…</p>}</>
              : <div className="gz-empty"><BookOpen size={26} /><h2>没有轻小说</h2><p>这个题材下暂无作品。</p></div>}
      </>)}
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
