export interface PlaybackProgress {
  mediaFileId: string;
  workId: string | null;
  fileName: string;
  title: string;
  toolId: string | null;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  updatedAt: string;
  missing: boolean;
}
export interface PlaybackOverview {
  items: PlaybackProgress[];
  sessions: { mediaFileId: string; status: string; message: string }[];
}
/** 按实际观看时间选择，不能按集号、文件名或进度大小选择。 */
export function latestPlayback(items: PlaybackProgress[], workId: string, mediaIds?: string[]) {
  return items.filter(item => item.workId === workId && (!mediaIds || mediaIds.includes(item.mediaFileId)))
    .reduce<PlaybackProgress | undefined>((latest, item) =>
      !latest || Date.parse(item.updatedAt) > Date.parse(latest.updatedAt) ? item : latest, undefined);
}

export function playbackPercent(item: PlaybackProgress): number {
  return item.durationMs > 0 ? Math.min(100, Math.max(0, item.positionMs / item.durationMs * 100)) : 0;
}
export function playbackTime(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
