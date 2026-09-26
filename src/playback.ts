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
export function playbackTime(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
