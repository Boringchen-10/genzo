import { convertFileSrc } from "@tauri-apps/api/core";
import type { Work, WorkCategory, MediaType, RecognitionStatus, RootKind, UnassignedMediaGroup, WorkStatus } from "./types";

export const mediaLabels: Record<MediaType, string> = {
  video: "视频",
  comic: "漫画",
  novel: "小说",
  game: "游戏",
  other: "其他",
};

export const workCategoryLabels: Record<WorkCategory, string> = {
  ...mediaLabels, video: "未分类视频", anime: "动漫", movie: "电影", tv: "电视剧",
};

export function workCategoryLabel(work: Pick<Work, "type" | "category">): string {
  return workCategoryLabels[work.category ?? work.type] ?? mediaLabels[work.type];
}

export function workDetailPath(work: Pick<Work, "id" | "type" | "category">): string {
  const category = work.category ?? work.type;
  return `/${category === "comic" || category === "novel" ? "bookshelf" : "library"}/${encodeURIComponent(work.id)}`;
}

export const statusLabels: Record<WorkStatus, string> = {
  planned: "计划中",
  in_progress: "进行中",
  completed: "已完成",
  paused: "搁置",
  dropped: "已放弃",
};

export const rootKindLabels: Record<RootKind, string> = {
  auto: "自动识别",
  video: "视频",
  comic: "漫画",
  novel: "小说",
  game: "游戏",
  mixed: "混合目录",
};

export function unassignedStatusRank(status: RecognitionStatus, missingCount: number, fileCount: number): number {
  if (missingCount >= fileCount) return 3;
  if (status === "candidate_pending") return 0;
  if (status === "error") return 1;
  return 2;
}

/** 待整理里可以继续识别的作品组：视频作品组，且不是全部文件缺失。 */
export function recognisableGroups(groups: UnassignedMediaGroup[]): UnassignedMediaGroup[] {
  return groups.filter((group) => group.mediaType === "video" && group.missingCount < group.fileCount);
}

/** 优先用「待确认」的作品组作为识别入口，方便直接查看候选。 */
export function recognitionEntryGroup(groups: UnassignedMediaGroup[]): UnassignedMediaGroup | null {
  const candidates = recognisableGroups(groups);
  return candidates.find((group) => group.recognitionStatus === "candidate_pending") ?? candidates[0] ?? null;
}

export function recognitionActionLabel(group: UnassignedMediaGroup): string {
  return group.recognitionStatus === "candidate_pending" ? "查看候选" : "识别";
}

export function formatDate(value: string | null): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const unit = units[index] ?? "B";
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${unit}`;
}

export function coverUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^(https?:|asset:|data:|blob:)/i.test(path) || path.startsWith("/demo/") || path.startsWith("/design/")) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}
