import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PlaybackOverview } from "../playback";
import { api } from "../api";
import type { ScanTask } from "../scanTasks";

export interface VideoSource {
  id: string; kind: "saf" | "webdav"; label: string; enabled: boolean;
  state: string; lastScannedAt: string | null;
  error?: Failure;
}
export interface Failure { code: string; message: string; retryable: boolean }
export interface SubtitleTrack { id: string; label: string; kind: "embedded" | "sidecar"; language?: string; available: boolean }
export type PlayerAction = { type: "play" | "pause" | "close" }
  | { type: "seek"; positionMs: number } | { type: "rate"; speed: number }
  | { type: "audio" | "subtitle"; trackId: string } | { type: "subtitle-delay"; offsetMs: number }
  | { type: "orientation"; orientation: "portrait" | "landscape" | "system" };
export interface PlayerSnapshot {
  sessionId: string | null; mediaFileId: string | null; status: string;
  positionMs: number; durationMs: number | null;
  revision: number; seekable: boolean; rate: number;
  audioTracks: { id: string; label: string; language?: string }[]; subtitleTracks: SubtitleTrack[];
  audioTrackId: string | null; subtitleTrackId: string | null; subtitleOffsetMs: number;
  error?: Failure | null;
}
export interface DocumentEntry {
  documentId: string; name: string; mimeType: string;
  size: number | null; modifiedMs: number | null; uri: string;
}
export interface TreeListing {
  status: string; label?: string | null; uri?: string; files?: DocumentEntry[];
}
export const isDirectoryEntry = (entry: DocumentEntry) => entry.mimeType === "vnd.android.document/directory";
export const androidApi = {
  sources: () => invoke<VideoSource[]>("get_video_source_states"),
  authorize: (sourceId?: string, reuseAuthorized = false) => invoke<{ status: string; source?: VideoSource }>("authorize_video_source", { sourceId, reuseAuthorized }),
  scan: (sourceId: string) => invoke<{ taskId: string }>("scan_video_source", { sourceId }),
  tasks: () => invoke<ScanTask[]>("list_scan_tasks"),
  cancel: (id: string) => invoke<void>("cancel_scan_task", { id }),
  retry: (id: string) => invoke<void>("retry_scan_task", { id }),
  listTree: (uri?: string, sourceId?: string) => invoke<TreeListing>("android_native", { command: "listTree", payload: { uri, sourceId } }),
  play: (mediaFileId: string, restart = false, subtitleId?: string) => invoke<PlayerSnapshot>("open_internal_player", { mediaFileId, restart, subtitleId }),
  state: (sessionId?: string) => invoke<PlayerSnapshot>("get_internal_player_state", { sessionId }),
  control: (sessionId: string, action: PlayerAction) => invoke<PlayerSnapshot>("control_internal_player", { sessionId, action }),
  pickSubtitle: (sessionId: string) => invoke<{ status: "selected" | "cancelled" | "permission_denied" | "subtitle_error"; track?: SubtitleTrack }>("pick_external_subtitle", { sessionId }),
  subtitleCandidates: (mediaFileId: string) => invoke<SubtitleTrack[]>("list_subtitle_candidates", { mediaFileId }),
  progress: async (): Promise<PlaybackOverview> => { await androidApi.state(); return api.playbackProgress(); },
  appearance: (dark: boolean) => invoke<void>("set_android_appearance", { dark }),
};

/** Subscribe first, then read snapshots. Each stream/entity owns its revision. */
export async function listenAndroidChanges(onChange: (name: string) => void): Promise<() => void> {
  const revisions = new Map<string, number>();
  const unlisten: (() => void)[] = [];
  try {
    for (const name of ["android-source-state", "scan-task-updated", "recognition-updated", "player-state"]) {
      unlisten.push(await listen<{ revision: number; sourceId?: string; task?: ScanTask; sessionId?: string }>(name, ({ payload }) => {
        const key = `${name}:${payload.sourceId ?? payload.task?.id ?? payload.sessionId ?? "global"}`;
        if (!Number.isFinite(payload.revision) || payload.revision <= (revisions.get(key) ?? -1)) return;
        revisions.set(key, payload.revision); onChange(name);
      }));
    }
    return () => unlisten.forEach(stop => stop());
  } catch (error) { unlisten.forEach(stop => stop()); throw error; }
}
