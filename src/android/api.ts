import { invoke } from "@tauri-apps/api/core";
import type { PlaybackOverview } from "../playback";
import { api } from "../api";
import type { ScanTask } from "../scanTasks";

export interface VideoSource {
  id: string; kind: "saf" | "webdav"; label: string; enabled: boolean;
  state: string; lastScannedAt: string | null;
}
export interface PlayerSnapshot {
  sessionId: string | null; mediaFileId: string | null; status: string;
  positionMs: number; durationMs: number | null;
  error?: { code: string; message: string; retryable: boolean } | null;
}
export const androidApi = {
  sources: () => invoke<VideoSource[]>("get_video_source_states"),
  authorize: (sourceId?: string, reuseAuthorized = false) => invoke<{ status: string; source?: VideoSource }>("authorize_video_source", { sourceId, reuseAuthorized }),
  scan: (sourceId: string) => invoke<{ taskId: string }>("scan_video_source", { sourceId }),
  tasks: () => invoke<ScanTask[]>("list_scan_tasks"),
  cancel: (id: string) => invoke<void>("cancel_scan_task", { id }),
  retry: (id: string) => invoke<void>("retry_scan_task", { id }),
  play: (mediaFileId: string, restart = false) => invoke<PlayerSnapshot>("open_internal_player", { mediaFileId, restart }),
  state: () => invoke<PlayerSnapshot>("get_internal_player_state"),
  progress: async (): Promise<PlaybackOverview> => { await androidApi.state(); return api.playbackProgress(); },
  appearance: (dark: boolean) => invoke<void>("set_android_appearance", { dark }),
};
