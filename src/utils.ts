import { convertFileSrc } from "@tauri-apps/api/core";
import type { MediaType, RootKind, WorkStatus } from "./types";

export const mediaLabels: Record<MediaType, string> = {
  video: "动漫",
  comic: "漫画",
  novel: "小说",
  game: "游戏",
  other: "其他",
};

export const statusLabels: Record<WorkStatus, string> = {
  planned: "计划中",
  in_progress: "进行中",
  completed: "已完成",
  paused: "搁置",
  dropped: "已放弃",
};

export const rootKindLabels: Record<RootKind, string> = {
  auto: "自动识别",
  video: "动漫",
  comic: "漫画",
  novel: "小说",
  game: "游戏",
  mixed: "混合目录",
};

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
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}
