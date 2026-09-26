import type { MediaFile, MediaType } from "./types";

export function recentlyAdded<T extends { id: string; createdAt: string }>(works: T[]): T[] {
  return [...works].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id));
}

export function availableForWork(file: MediaFile, type: MediaType): boolean {
  return file.mediaType === type && (!file.missing || file.path.startsWith("webdav://"));
}

/** 视频作品不能把字幕、字体或压缩附件当成播放入口。 */
export function firstWorkFile(files: MediaFile[], type: MediaType): MediaFile | undefined {
  return files.filter(file => availableForWork(file, type)).sort((a, b) =>
    Number(Boolean(a.parsedSpecialType)) - Number(Boolean(b.parsedSpecialType)) ||
    (a.parsedSeason ?? 0) - (b.parsedSeason ?? 0) ||
    (a.parsedEpisodeStart ?? Number.MAX_SAFE_INTEGER) - (b.parsedEpisodeStart ?? Number.MAX_SAFE_INTEGER) ||
    a.fileName.localeCompare(b.fileName, "zh-CN", { numeric: true }))[0];
}
