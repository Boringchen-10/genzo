/**
 * 探索页的纯函数辅助（不依赖 React / Tauri / Provider）。
 *
 * 归属：Open Design 前端层（`src/` 根目录的展示辅助）。放在这里是为了让
 * 「网络评分 / 排名 / 空值 / 数据源状态」等展示规则可被单元测试覆盖。
 */
import type { ExploreSourceStatus, ExploreSubject, ExploreSubjectType, WorkStatus } from "./types";
import { statusLabels } from "./utils";

export const subjectTypeLabels: Record<ExploreSubjectType, string> = {
  tv: "电视动画",
  web: "网络动画",
  movie: "剧场版",
  ova: "OVA",
};

/** 保存到媒体库时可选的状态（与后端 `WorkStatus` 一致）。 */
export const exploreStatusOptions: WorkStatus[] = ["planned", "in_progress", "completed", "paused", "dropped"];

/** 桌面壳 Provider 尚未补齐探索方法时显示的说明（不伪造数据）。 */
export const EXPLORE_UNAVAILABLE_MESSAGE =
  "探索后端尚未接入：Tauri Provider 还没有映射 get_explore_overview / search_explore_subjects / get_explore_subject / save_explore_subject。浏览器预览使用示例数据。";

/** `2026 年 9 月`；用于对比与测试，避免页面里散落字符串拼接。 */
export function seasonLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

/**
 * 后端把任意月份规范化到 1 / 4 / 7 / 10 月的季度（cour），
 * 因此探索筛选只提供这四个季度，不再按 12 个自然月展示。
 */
export const COUR_MONTHS: number[] = [1, 4, 7, 10];

/** 季度标签：`2026 年 4 月新番`。 */
export function courLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月新番`;
}

/** 按日期取所在季度；筛选为「全部」时用它作为本季的默认季度。 */
export function courOf(date: Date): { year: number; month: number } {
  const month = date.getMonth() + 1;
  let cour = 1; // 1 月新番
  for (const value of COUR_MONTHS) {
    if (value <= month) cour = value;
  }
  return { year: date.getFullYear(), month: cour };
}

/** 网络评分：`null` 时不显示数字，避免与个人评分混淆。 */
export function formatScore(score: number | null): string {
  return score === null ? "暂无网络评分" : score.toFixed(1);
}

/** 网络排名：`null` 时明确「暂无排名」。 */
export function formatRank(rank: number | null): string {
  return rank === null ? "暂无排名" : `#${rank}`;
}

/** 放送信息：日期与周期任一缺失时降级显示，两者都没有时为「未公布」。 */
export function formatBroadcast(airDate: string | null, broadcast: string | null): string {
  const parts = [airDate, broadcast].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(" · ") : "未公布";
}

/** 评分人数 / 收藏人数等计数。 */
export function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

/** 媒体库标记：未加入时明确说明，不留空。 */
export function formatLibraryState(subject: Pick<ExploreSubject, "inLibrary" | "localStatus">): string {
  if (!subject.inLibrary) return "未加入媒体库";
  return `已在媒体库 · ${statusLabels[subject.localStatus ?? "planned"]}`;
}

export interface ExploreSourceProblems {
  /** 数据源不可用，必须按错误呈现。 */
  blockers: ExploreSourceStatus[];
  /** 数据源可用但用的是过期缓存，按提示呈现。 */
  staleNotices: ExploreSourceStatus[];
}

/** 拆分数据源状态：`available === false` 是错误，`stale === true` 是缓存提示。 */
export function exploreSourceProblems(sources: ExploreSourceStatus[]): ExploreSourceProblems {
  return {
    blockers: sources.filter((source) => !source.available),
    staleNotices: sources.filter((source) => source.available && source.stale),
  };
}

/** 按标签筛选当前列表；`null` 表示不筛选。 */
export function filterByTag(subjects: ExploreSubject[], tag: string | null): ExploreSubject[] {
  if (!tag) return subjects;
  return subjects.filter((subject) => subject.genres.includes(tag));
}
