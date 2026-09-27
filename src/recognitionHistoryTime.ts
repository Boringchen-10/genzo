import type { RecognitionHistoryEntry } from "./types";

export type HistoryRange = "1" | "7" | "30" | "all";

export function historyInRange(items: RecognitionHistoryEntry[], range: HistoryRange, now: number) {
  const cutoff = range === "all" ? null : now - Number(range) * 24 * 60 * 60 * 1000;
  return items.filter(item => {
    const time = Date.parse(item.createdAt);
    return cutoff === null || (Number.isFinite(time) && time >= cutoff && time <= now);
  }).slice().sort((a, b) => {
    const time = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
    return (time(b.createdAt) - time(a.createdAt)) || b.id.localeCompare(a.id);
  });
}

export function historyDay(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date) : "时间未知";
}

export function historyTimestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(date) : "时间未知";
}
