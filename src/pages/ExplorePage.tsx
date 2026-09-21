import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, Heart, Info, Library, RefreshCw, Search, X } from "lucide-react";
import { Link } from "react-router-dom";
import { dataProvider, getAnimeRankingProvider, getExploreProvider } from "../data";
import { createExploreRequests } from "../exploreRequests";
import { EmptyState, ErrorState, IconButton, LoadingState, useOffline } from "../components/common";
import { MediaVisual } from "../components/MediaVisual";
import { useToasts } from "../store";
import type { ExploreOverview, ExploreSubject, WorkStatus } from "../types";
import { formatDate, getErrorMessage, statusLabels } from "../utils";
import {
  COUR_MONTHS,
  EXPLORE_UNAVAILABLE_MESSAGE,
  courLabel,
  courOf,
  courSeason,
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
const overviewRequests = createExploreRequests((year, month) => {
  const provider = getExploreProvider();
  if (!provider) return Promise.reject(new Error(EXPLORE_UNAVAILABLE_MESSAGE));
  return provider.exploreOverview(year, month);
});

/** 年份筛选的最早年份：本季筛选从 2000 年起都可选（Bangumi 索引里的动画年份范围）。 */
const YEAR_MIN = 2000;

/** 动画排行榜每页条数（「加载更多」每次追加一页）。 */
const RANKING_PAGE_SIZE = 12;

/** 后台封面缓存完成后的有限次复查，避免远程图片长期停留在占位状态。 */
const COVER_REFRESH_MAX = 3;
const COVER_REFRESH_DELAY = 2500;

/**
 * 标签的**编辑序**（热门 → 冷门）：常见的 ACGN 类型排在前面，未收录的标签保持后端返回的原序
 * （后端 `explore.rs` 目前是字母序去重）。同时收录常见的中文 / 日文 / 英文写法，使后端完成标签
 * 本地化前后顺序都稳定。
 *
 * 注意：这是**编辑排序**，不是后端统计值 —— 真正的「按热度」需要后端提供每个标签的计数
 * （已登记 `EXPLORE-026 / NEW_REQUIRED`，见能力矩阵）。
 */
const TAG_PRIORITY = [
  "恋爱", "爱情", "ラブコメ", "romance",
  "喜剧", "搞笑", "コメディ", "comedy", "gag", "ギャグ",
  "动作", "アクション", "action",
  "热血", "战斗", "バトル", "battle",
  "奇幻", "ファンタジー", "fantasy",
  "冒险", "アドベンチャー", "adventure",
  "科幻", "sf", "sci-fi", "science fiction",
  "悬疑", "推理", "ミステリー", "mystery",
  "日常", "slice of life",
  "治愈", "癒し", "healing",
  "校园", "学園", "school",
  "青春", "youth",
  "剧情", "ドラマ", "drama",
  "后宫", "ハーレム", "harem",
  "异世界", "異世界", "isekai",
  "魔法", "magic",
  "超能力", "super power",
  "机战", "ロボット", "mecha", "robot",
  "运动", "スポーツ", "sports",
  "音乐", "音楽", "music",
  "恐怖", "ホラー", "horror",
  "百合", "yuri",
  "耽美", "bl",
  "战争", "戦争", "war",
  "历史", "歴史", "history",
  "游戏", "ゲーム", "game",
  "儿童", "子供",
  "泡面番", "short",
  "3d", "cg",
  "国产", "国创",
];

const TAG_RANK = new Map(TAG_PRIORITY.map((value, index) => [value.toLowerCase(), index]));

/** 按编辑序重排标签；未收录的标签保持原序（稳定排序）。 */
const orderTags = (values: string[]) => values
  .map((value, index) => ({ value, index, rank: TAG_RANK.get(value.trim().toLowerCase()) ?? TAG_PRIORITY.length }))
  .sort((left, right) => left.rank - right.rank || left.index - right.index)
  .map((item) => item.value);

/** 浏览器优先加载可见封面，缺失时显示占位。 */
function ExploreCover({ subject, onNeedsCover }: { subject: ExploreSubject; onNeedsCover?: () => void }) {
  const [failed, setFailed] = useState(false);
  /* 地址变化（例如后台缓存完成后从远程 URL 变成本地文件）时重置失败标记。 */
  useEffect(() => { setFailed(false); }, [subject.coverUrl]);

  /* 后台缓存完成后有限次复查本地地址。 */
  useEffect(() => {
    if (!subject.coverUrl || /^https?:/i.test(subject.coverUrl)) onNeedsCover?.();
  }, [subject.externalId, subject.coverUrl, onNeedsCover]);

  if (subject.coverUrl && !failed) {
    return (
      <img
        className="gnz-explore-cover"
        src={subject.coverUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => { setFailed(true); onNeedsCover?.(); }}
      />
    );
  }
  return (
    <span className="gnz-explore-cover is-placeholder">
      <MediaVisual type="video" coverPath={null} alt={`${subject.title} 的占位封面`} />
    </span>
  );
}

function ExploreCard({ subject, onOpen, onNeedsCover }: { subject: ExploreSubject; onOpen: (subject: ExploreSubject) => void; onNeedsCover?: () => void }) {
  return (
    <button type="button" className="gnz-explore-card" onClick={() => onOpen(subject)} aria-label={`查看 ${subject.title} 的条目详情`}>
      <span className="gnz-explore-poster">
        <ExploreCover subject={subject} onNeedsCover={onNeedsCover} />
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
  /** 离线只作低干扰提示：探索数据来自网络，离线时可能只能读缓存或直接失败。 */
  const offline = useOffline();
  const toast = useToasts((state) => state.push);
  /** 「全部年份 / 全部月份」时的默认季度：按当前日期取所在季度（1 / 4 / 7 / 10 月）。 */
  const initialCour = useMemo(() => courOf(new Date()), []);
  const [overview, setOverview] = useState<ExploreOverview | null>(() => overviewRequests.cached(null, null) ?? null);
  /**
   * 「推荐」标签页的数据：**始终取当前季度**的热度榜（后端只在当前季度返回
   * Bangumi 每日放送热度，历史季度该列表为空），因此它不随年份 / 季度筛选变化。
   */
  const [hot, setHot] = useState<ExploreOverview | null>(() => overviewRequests.cached(null, null) ?? null);
  const [loading, setLoading] = useState(() => !overviewRequests.cached(null, null));
  const loadGeneration = useRef(0);
  const [error, setError] = useState("");
  /** `null` = 全部年份 / 全部月份；请求时传 null，由后端规范化到季度。 */
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [tab, setTab] = useState<ExploreTab>("recommended");
  const [tag, setTag] = useState<string | null>(null);
  /** 标签区默认只显示 3 行，超出时提供「展开全部 / 收起」；裁切高度按实际行高测量。 */
  const tagsRef = useRef<HTMLDivElement>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [tagsOverflow, setTagsOverflow] = useState(false);
  const [tagsClampHeight, setTagsClampHeight] = useState<number | null>(null);
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

  /** 动画排行榜（按 Bangumi 评分排名）：后端已完成，与「最近 30 日注目动画」不是同一件事。 */
  const rankingProvider = useMemo(() => getAnimeRankingProvider(), []);
  const [ranking, setRanking] = useState<ExploreSubject[]>([]);
  const [rankingPage, setRankingPage] = useState(1);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState("");
  const [rankingDone, setRankingDone] = useState(false);

  /** 筛选为「全部」时，本季按当前日期所在季度自动取值。 */
  const effectiveYear = year ?? initialCour.year;
  const effectiveMonth = month ?? initialCour.month;

  const load = useCallback(async (targetYear: number | null, targetMonth: number | null) => {
    const generation = ++loadGeneration.current;
    if (!provider) {
      setOverview(null);
      setHot(null);
      setLoading(false);
      setError(EXPLORE_UNAVAILABLE_MESSAGE);
      return;
    }
    const cached = overviewRequests.cached(targetYear, targetMonth);
    setOverview(cached ?? null);
    setLoading(!cached);
    setError("");
    try {
      const seasonalRequest = overviewRequests.load(targetYear, targetMonth);
      /* 「全部年份 / 全部月份」时两个请求本来就一样，复用同一个 Promise，避免重复调用。 */
      const hotRequest = targetYear === null && targetMonth === null
        ? seasonalRequest
        : overviewRequests.load(null, null);
      const [seasonal, hotOverview] = await Promise.all([seasonalRequest, hotRequest]);
      if (generation !== loadGeneration.current) return;
      setOverview(seasonal);
      setHot(hotOverview);
    } catch (loadError: unknown) {
      if (generation !== loadGeneration.current) return;
      setError(getErrorMessage(loadError));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [provider]);

  useEffect(() => { void load(year, month); return () => { loadGeneration.current += 1; }; }, [load, year, month]);

  const refresh = useCallback(async () => {
    if (!provider) return;
    const generation = loadGeneration.current;
    try {
      const seasonalRequest = overviewRequests.load(year, month);
      const hotRequest = year === null && month === null
        ? seasonalRequest
        : overviewRequests.load(null, null);
      const [seasonal, hotOverview] = await Promise.all([seasonalRequest, hotRequest]);
      if (generation !== loadGeneration.current) return;
      setOverview(seasonal);
      setHot(hotOverview);
    } catch {
      /* 静默刷新失败时保留现有列表，避免把已展示的数据整页替换成错误态 */
    }
  }, [provider, year, month]);

  /** 列表里是否还有条目没有封面、或封面仍指向远程地址（说明后台缓存可能仍在进行）。 */
  const needsCoverCache = useCallback(
    (items: ExploreSubject[]) => items.some((item) => !item.coverUrl || /^https?:/i.test(item.coverUrl)),
    [],
  );

  /**
   * 静默复查缓存：不设置 `loading`，所以不会整页闪烁、不会回到顶部，
   * 分类 Tab / 年份 / 季节 / 标签 / 搜索状态与滚动位置都保持不变。
   */
  const coverRefreshAttempts = useRef(0);
  const coverRefreshTimer = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => { aliveRef.current = true; return () => {
    aliveRef.current = false;
    if (coverRefreshTimer.current !== null) window.clearTimeout(coverRefreshTimer.current);
  }; }, []);

  const scheduleCoverRefresh = useCallback(() => {
    if (!aliveRef.current || coverRefreshAttempts.current >= COVER_REFRESH_MAX) return;
    if (coverRefreshTimer.current !== null) return;
    coverRefreshTimer.current = window.setTimeout(() => {
      coverRefreshTimer.current = null;
      if (!aliveRef.current) return;
      coverRefreshAttempts.current += 1;
      void refreshRef.current().finally(() => {
        if (aliveRef.current && coverRefreshAttempts.current < COVER_REFRESH_MAX) {
          scheduleCoverRefresh();
        }
      });
    }, COVER_REFRESH_DELAY);
  }, []);

  /** 切换分类 / 季节 / 年份 / 搜索时重置复查预算：新上下文重新开始有限次数的重试。 */
  useEffect(() => {
    coverRefreshAttempts.current = 0;
    if (coverRefreshTimer.current !== null) {
      window.clearTimeout(coverRefreshTimer.current);
      coverRefreshTimer.current = null;
    }
  }, [year, month, tab, searchTerm]);

  /** 动画排行榜：`page === 1` 覆盖，其余追加（「加载更多」）。失败保留已加载的条目。 */
  const loadRanking = useCallback(async (page: number) => {
    if (!rankingProvider) return;
    setRankingLoading(true);
    setRankingError("");
    try {
      const items = await rankingProvider.animeRanking(page, RANKING_PAGE_SIZE);
      setRanking((previous) => (page === 1 ? items : [...previous, ...items]));
      setRankingPage(page);
      setRankingDone(items.length < RANKING_PAGE_SIZE);
    } catch (rankingLoadError: unknown) {
      setRankingError(getErrorMessage(rankingLoadError));
    } finally {
      setRankingLoading(false);
    }
  }, [rankingProvider]);
  useEffect(() => { void loadRanking(1); }, [loadRanking]);

  const problems = useMemo(() => exploreSourceProblems(overview?.sources ?? []), [overview]);
  const hotProblems = useMemo(() => exploreSourceProblems(hot?.sources ?? []), [hot]);
  /** 展示用的季度：优先用后端规范化后的年份 / 月份，未取到时回落到「全部」时的当前季度。 */
  const shownYear = overview?.year ?? effectiveYear;
  const shownMonth = overview?.month ?? effectiveMonth;
  const hotYear = hot?.year ?? initialCour.year;
  const hotMonth = hot?.month ?? initialCour.month;
  const activeList = tab === "seasonal" ? overview?.seasonal ?? [] : hot?.trending ?? [];
  const availableTags = overview?.availableTags ?? [];
  const hotTags = useMemo(() => Array.from(new Set((hot?.trending ?? []).flatMap((item) => item.genres))), [hot]);
  const visible = useMemo(() => filterByTag(activeList, tag), [activeList, tag]);
  const filterTags = useMemo(() => {
    const values = searchTerm !== null
      ? Array.from(new Set(results.flatMap((item) => item.genres)))
      : tab === "seasonal" ? availableTags : hotTags;
    /* 显示顺序＝编辑序（热门 → 冷门），未收录的保持后端原序。 */
    return orderTags(values);
  }, [searchTerm, results, availableTags, hotTags, tab]);

  /**
   * 标签默认只显示 3 行：测量第 3 行的**实际底边**作为裁切高度 ——
   * 不写死行高，长标签换行、系统字体缩放、窗口缩放都能自适应；只有真的超过 3 行才出现展开入口。
   */
  const measureTags = useCallback(() => {
    const node = tagsRef.current;
    if (!node) return;
    const chips = Array.from(node.querySelectorAll<HTMLElement>(":scope > button"));
    if (!chips.length) { setTagsOverflow(false); setTagsClampHeight(null); return; }
    const top = node.getBoundingClientRect().top;
    const rowTops: number[] = [];
    for (const chip of chips) {
      const rowTop = Math.round(chip.getBoundingClientRect().top - top);
      if (!rowTops.includes(rowTop)) rowTops.push(rowTop);
    }
    rowTops.sort((left, right) => left - right);
    if (rowTops.length <= 3) { setTagsOverflow(false); setTagsClampHeight(null); return; }
    const thirdRowTop = rowTops[2] ?? 0;
    const thirdRowBottom = chips.reduce((max, chip) => {
      const rect = chip.getBoundingClientRect();
      return Math.round(rect.top - top) === thirdRowTop ? Math.max(max, rect.bottom - top) : max;
    }, thirdRowTop);
    setTagsOverflow(true);
    setTagsClampHeight(Math.ceil(thirdRowBottom));
  }, []);

  useEffect(() => {
    measureTags();
    const node = tagsRef.current;
    const observer = node && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measureTags()) : null;
    if (observer && node) observer.observe(node);
    window.addEventListener("resize", measureTags);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureTags);
    };
  }, [measureTags, filterTags]);

  /** 切换分类 / 搜索时回到收起态，避免把上一个列表的展开状态带过去。 */
  useEffect(() => { setTagsExpanded(false); }, [tab, searchTerm]);
  const gridSubjects = searchTerm !== null ? filterByTag(results, tag) : visible;
  const [visibleLimit, setVisibleLimit] = useState(48);
  useEffect(() => { setVisibleLimit(48); }, [year, month, tab, tag, searchTerm]);
  const heading = searchTerm !== null
    ? { title: "搜索结果", detail: `「${searchTerm}」共 ${gridSubjects.length} 条` }
    : tab === "seasonal"
      ? { title: "本季番组", detail: `${courLabel(shownYear, shownMonth)} · 来自 bangumi-data 番组索引` }
      : { title: "本季热度", detail: `${courLabel(hotYear, hotMonth)} · 按 Bangumi 评分人数与收藏人数排序 · 不受年份 / 季节筛选影响` };

  /** 当前列表仍有缺失 / 远程封面时，安排一次有限次数的静默重读；数据加载中不打扰。 */
  const activeNeedsCover = useMemo(() => needsCoverCache(gridSubjects), [gridSubjects, needsCoverCache]);
  useEffect(() => {
    if (loading || (!activeNeedsCover && !overview?.sources.some(source => source.warning))) return;
    scheduleCoverRefresh();
  }, [loading, activeNeedsCover, overview, scheduleCoverRefresh]);

  useEffect(() => {
    if (tag && !filterTags.includes(tag)) setTag(null);
  }, [filterTags, tag]);

  const clearSearch = () => { setSearchTerm(null); setResults([]); setQuery(""); };
  const openTab = (next: ExploreTab) => { clearSearch(); setTab(next); };
  /** 标签筛选（对「推荐」和「本季」都生效）单独重置。 */
  const resetTagFilter = () => setTag(null);
  /** 本季的季节 / 年份筛选重置：回到「全部」时按当前日期所在季节取值。 */
  const resetSeasonFilter = () => { setYear(null); setMonth(null); };

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

  /** 年份选项：从 2000 年到明年，**新的在前**，方便先看到近几年。 */
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let value = initialCour.year + 1; value >= YEAR_MIN; value -= 1) years.push(value);
    return years;
  }, [initialCour.year]);

  const emptyState = searchTerm !== null
    ? <EmptyState title="没有匹配的条目" description="换一个关键词，或清除搜索回到本季列表。" />
    : tab === "seasonal"
      ? <EmptyState title="这个季节没有索引到番组" description={`bangumi-data 番组索引里没有 ${courLabel(effectiveYear, effectiveMonth)} 的条目，换一个年份或季节再试。`} />
      : <EmptyState title="热度榜暂时没有数据" description={hotProblems.blockers[0]?.warning ?? `Bangumi 每日放送里暂时没有 ${courLabel(hotYear, hotMonth)} 的热度条目，稍后刷新再试。`} />;

  /* 条目详情：与作品详情页共用同一套版面（detail-page / detail-hero / detail-body）。 */
  if (selected) {
    const detailSeason = selected.year !== null ? seasonLabel(selected.year, selected.month ?? 1) : null;
    /* 顶部背景优先用条目自带的**横版横幅**（Bangumi/AniList banner），没有才退回竖版封面。 */
    const detailBanner = selected.bannerUrl ?? null;
    const detailArtwork = detailBanner ?? selected.coverUrl ?? null;
    return (
      <div
        className={`detail-page gnz-explore-detail-page${detailBanner ? " has-detail-banner" : selected.coverUrl ? " has-detail-artwork" : ""}`}
        style={detailArtwork ? ({ "--detail-artwork": `url("${detailArtwork}")` } as CSSProperties) : undefined}
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
          <span>{overview ? `本季 ${overview.seasonal.length} 部 · 热度榜 ${hot?.trending.length ?? 0} 部` : loading ? "正在读取网络数据" : "暂无数据"}</span>
          {overview ? <span>数据时间 {formatDate(overview.fetchedAt)}</span> : null}
        </div>
      </section>

      {offline ? (
        <div className="gnz-explore-notice" role="status">
          <Info size={15} />
          <div>
            <strong>当前网络已断开</strong>
            <p>探索数据来自 Bangumi 网络接口，离线时可能只能显示本地缓存或加载失败；这不影响本地媒体库。</p>
          </div>
        </div>
      ) : null}

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

      {overview ? (
        <>
          {/* 筛选面板（位置 / 间距 / 结构对齐 Open Design v1.1.2）：只放标签筛选，对「推荐 / 本季」都生效；
              季节与年份属于「本季」自己的界面，见下方本节。 */}
          <section className="gnz-filter-preview" aria-labelledby="explore-filter-title">
            <div className="gnz-filter-head">
              <h2 id="explore-filter-title">筛选</h2>
              <p>共 {gridSubjects.length} 部作品</p>
              <button type="button" className="button secondary compact" onClick={resetTagFilter} disabled={!tag}>重置标签</button>
            </div>
            <div className="gnz-filter-field">
              <div className="gnz-filter-field-head">
                <span className="gnz-filter-label" id="explore-tag-label">动漫标签</span>
                {tagsOverflow ? (
                  <button type="button" className="gnz-filter-more" aria-expanded={tagsExpanded} onClick={() => setTagsExpanded((value) => !value)}>
                    {tagsExpanded ? "收起" : `展开全部（${filterTags.length} 个）`}
                  </button>
                ) : null}
              </div>
              <div
                ref={tagsRef}
                className={`gnz-filter-chips${tagsOverflow && !tagsExpanded ? " is-clamped" : ""}`}
                style={tagsOverflow && !tagsExpanded && tagsClampHeight !== null ? { maxHeight: `${tagsClampHeight}px` } : undefined}
                role="group"
                aria-labelledby="explore-tag-label"
              >
                {filterTags.length ? filterTags.map((value) => (
                  <button key={value} type="button" className={tag === value ? "active" : ""} aria-pressed={tag === value} onClick={() => setTag(tag === value ? null : value)}>{value}</button>
                )) : <span className="quiet-inline">当前列表还没有可用标签。</span>}
              </div>
            </div>
          </section>

          <section className="gnz-explore-trending" aria-busy={loading}>
            <div className="section-heading">
              <div><h2>{heading.title}</h2><span>{loading ? "正在读取网络数据" : heading.detail}</span></div>
              {searchTerm !== null ? (
                <button type="button" className="button secondary compact" onClick={clearSearch}>清除搜索</button>
              ) : tab === "seasonal" ? (
                /* 季节 / 年份只作用于「本季」：与本季番组标题同一行、靠右；全部时按当前日期所在季节取值。 */
                <div className="gnz-season-filter" role="group" aria-label="本季的季节与年份筛选">
                  <label className="gnz-filter-select"><span>季节</span>
                    <select
                      value={month === null ? "" : String(month)}
                      onChange={(event) => setMonth(event.target.value === "" ? null : Number(event.target.value))}
                      aria-label="按季节筛选"
                      disabled={!provider}
                    >
                      <option value="">全部季节</option>
                      {COUR_MONTHS.map((value) => <option key={value} value={value}>{courSeason(value)}（{value} 月）</option>)}
                    </select>
                  </label>
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
                  <button type="button" className="button secondary compact" onClick={resetSeasonFilter} disabled={year === null && month === null}>重置</button>
                </div>
              ) : null}
            </div>
            {loading || searching ? (
              <LoadingState label={searching ? "正在搜索 Bangumi 条目" : "正在读取 Bangumi 探索数据"} />
            ) : gridSubjects.length ? (
              <div className="gnz-explore-grid">
                {gridSubjects.slice(0, visibleLimit).map((subject) => <ExploreCard key={subject.externalId} subject={subject} onOpen={(next) => void openDetail(next)} onNeedsCover={scheduleCoverRefresh} />)}
              </div>
            ) : emptyState}
            {!loading && !searching && gridSubjects.length > visibleLimit ? (
              <button type="button" className="button secondary" onClick={() => setVisibleLimit(limit => limit + 48)}>
                加载更多作品（已显示 {Math.min(visibleLimit, gridSubjects.length)} / {gridSubjects.length}）
              </button>
            ) : null}
          </section>

          {tab === "recommended" && searchTerm === null ? (
            <>
              <section className="gnz-explore-ranking" aria-busy={rankingLoading}>
                <div className="section-heading">
                  <div>
                    <h2>动画排行</h2>
                    <span>按 Bangumi 评分排名 · 与本地媒体库状态同步</span>
                  </div>
                  <button type="button" className="button secondary compact" onClick={() => void loadRanking(1)} disabled={!rankingProvider || rankingLoading}>刷新排行</button>
                </div>

                {rankingProvider === null ? (
                  <div className="future-empty">当前运行环境未提供排行榜能力（Provider 未实现该方法）。</div>
                ) : rankingError && !ranking.length ? (
                  <ErrorState message={rankingError} retry={() => void loadRanking(1)} />
                ) : rankingLoading && !ranking.length ? (
                  <LoadingState label="正在读取动画排行榜" />
                ) : ranking.length ? (
                  <>
                    <ol className="gnz-ranking-list">
                      {ranking.map((subject, index) => (
                        <li key={subject.externalId}>
                          <button type="button" className="gnz-ranking-row" onClick={() => void openDetail(subject)} aria-label={`查看 ${subject.title} 的条目详情`}>
                            <span className="gnz-ranking-index">{subject.rank ?? index + 1}</span>
                            <span className="gnz-ranking-poster"><ExploreCover subject={subject} /></span>
                            <span className="gnz-ranking-body">
                              <strong title={subject.title}>{subject.title}</strong>
                              <span className="gnz-explore-card-meta">
                                {formatScore(subject.score)} · {subject.ratingCount > 0 ? `${formatCount(subject.ratingCount)} 人评分` : "暂无评分人数"}
                              </span>
                              <span className="gnz-explore-card-sub">{formatBroadcast(subject.airDate, subject.broadcast)}</span>
                            </span>
                            <span className="gnz-ranking-flags">
                              {subject.inLibrary ? <span className="gnz-ranking-flag"><Library size={12} />入库</span> : null}
                              {subject.favorite ? <span className="gnz-ranking-flag is-favorite"><Heart size={12} fill="currentColor" />收藏</span> : null}
                              {subject.stale ? <span className="gnz-ranking-flag is-stale"><Info size={12} />缓存</span> : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                    {rankingError ? <p className="gnz-ranking-error" role="alert">{rankingError}（已加载的排行条目仍然可用）</p> : null}
                    {!rankingDone ? (
                      <div className="gnz-ranking-more">
                        <button type="button" className="button secondary" onClick={() => void loadRanking(rankingPage + 1)} disabled={rankingLoading}>
                          {rankingLoading ? "加载中…" : "加载更多"}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <EmptyState title="排行榜暂时没有数据" description="Bangumi 排行榜没有返回条目，稍后刷新再试。" />
                )}
              </section>

              <section className="gnz-explore-future">
                <div className="section-heading">
                  <div>
                    <h2>注目动画<span className="future-badge">Future</span></h2>
                    <span>需要新增后端，暂未开放</span>
                  </div>
                </div>
                <div className="future-empty">
                  <p><strong>注目动画 · 最近 30 日标记</strong>没有可靠数据源：现有 Bangumi 每日放送只返回当季条目，不含最近 30 日的标记 / 关注数据，所以不提供入口，也不用排行榜或本季热度冒充。</p>
                  <p>已登记为新增后端能力（见 BACKEND_CAPABILITY_MATRIX 的 EXPLORE-021）；接入后会补在这里。</p>
                </div>
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {!error && !overview && loading ? <LoadingState label="正在读取 Bangumi 探索数据" /> : null}

    </div>
  );
}
