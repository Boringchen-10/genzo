import type { MediaFile, RecognitionGroupScope } from "./types";
import { fileSeason } from "./filmTvRecognition";

export interface RecognitionTarget { media: MediaFile; scope: RecognitionGroupScope; label: string }

export function selectionGroups(files: MediaFile[]) {
  const groups = new Map<string, { key: string; label: string; files: MediaFile[] }>();
  for (const file of files) {
    const season = fileSeason(file);
    const key = file.parsedSpecialType ? `special:${file.parsedSpecialType}` : `season:${season ?? "unknown"}`;
    const label = file.parsedSpecialType ? `特别篇 / ${file.parsedSpecialType}` : season === null ? "正片 · 季度未知（请核对集号）" : `正片 · 第 ${season} 季`;
    if (!groups.has(key)) groups.set(key, { key, label, files: [] });
    groups.get(key)!.files.push(file);
  }
  return [...groups.values()];
}

export function toggleFiles(selected: string[], ids: string[], checked: boolean) {
  const result = new Set(selected);
  for (const id of ids) { if (checked) result.add(id); else result.delete(id); }
  return [...result];
}

// Never return to an already skipped item when an asynchronous refresh finishes.
export function remainingQueue<T extends { media: { id: string } }>(queue: { targets: T[]; index: number }, pending: Set<string>) {
  const targets = queue.targets.slice(queue.index).filter(target => pending.has(target.media.id));
  return targets.length ? { targets, index: 0 } : null;
}

export function uniqueTargets(targets: RecognitionTarget[]) {
  return [...new Map(targets.map(target => [`${target.scope}:${target.media.id}`, target])).values()];
}

export function selectedVideo(files: MediaFile[], selected: string[], preferredId: string) {
  const videos = files.filter(file => file.mediaType === "video" && !file.missing && selected.includes(file.id));
  return videos.find(file => file.id === preferredId) ?? videos[0] ?? null;
}
