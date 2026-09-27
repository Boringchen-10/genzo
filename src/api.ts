import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  WebdavConnection, RemoteSource, RemoteEntry, RemoteCacheEntry,
  AppInfo,
  Dashboard,
  ExternalTool,
  ExternalToolInput,
  ExploreOverview,
  ExploreSaveInput,
  ExploreSubject,
  WeeklyCalendar,
  DiscoveryCategory,
  DiscoverySort,
  MetadataProviderStatus,
  AnimeEpisodeMetadata,
  AnimeWorkStructure,
  LibraryRoot,
  MediaFile,
  UnassignedMediaGroup,
  MatchCandidate,
  RecognitionGroupInfo,
  RecognitionHistoryEntry,
  RecognitionGroupScope,
  RecognitionResult,
  RecognitionSummary,
  RootKind,
  ScanResult,
  WorkDetail,
  WorkInput,
  WorkListItem,
} from "./types";

export const remoteApi = {
  listSources: () => call<RemoteSource[]>("list_remote_sources"),
  browse: (input: WebdavConnection) => call<RemoteEntry[]>("browse_webdav", { input }),
  add: (input: WebdavConnection) => call<string>("add_webdav_source", { input }),
  credentials: (id: string, username: string, password: string) => call<void>("update_webdav_credentials", { id, username, password }),
  sourceType: (id: string, sourceType: "local" | "mounted") => call<void>("set_root_source_type", { id, sourceType }),
  cache: () => call<RemoteCacheEntry[]>("list_remote_cache"),
  download: (mediaFileId: string, pinned: boolean) => call<void>("cache_remote_media", { mediaFileId, pinned }),
  removeCache: (mediaFileId: string) => call<void>("remove_remote_cache", { mediaFileId }),
  setLimit: (gib: number) => call<void>("set_cache_limit", { gib }),
};

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "发生未知错误";
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new Error(errorMessage(error));
  }
}

function localAssetUrl(value: string | null | undefined): string | null | undefined {
  if (!value || /^(?:https?:|asset:|data:|blob:)/i.test(value)) return value;
  return convertFileSrc(value);
}

function withExploreAssets(subject: ExploreSubject): ExploreSubject {
  return {
    ...subject,
    coverUrl: localAssetUrl(subject.coverUrl) ?? null,
    bannerUrl: localAssetUrl(subject.bannerUrl),
  };
}

function withExploreOverviewAssets(overview: ExploreOverview): ExploreOverview {
  return {
    ...overview,
    seasonal: overview.seasonal.map(withExploreAssets),
    trending: overview.trending.map(withExploreAssets),
  };
}

function withAnimeStructureAssets(structure: AnimeWorkStructure): AnimeWorkStructure {
  return {
    ...structure,
    seasons: structure.seasons.map((season) => ({
      ...season,
      coverUrl: localAssetUrl(season.coverUrl) ?? null,
    })),
    episodes: structure.episodes.map((episode) => ({
      ...episode,
      localFiles: episode.localFiles.map((file) => ({
        ...file,
        thumbnailPath: localAssetUrl(file.thumbnailPath) ?? null,
      })),
    })),
    unmatchedFiles: structure.unmatchedFiles.map((file) => ({
      ...file,
      thumbnailPath: localAssetUrl(file.thumbnailPath) ?? null,
    })),
  };
}

export const api = {
  listWorks: () => call<WorkListItem[]>("list_works"),
  getWork: (id: string) => call<WorkDetail>("get_work", { id }),
  createWork: (input: WorkInput) => call<WorkDetail>("create_work", { input }),
  createWorkFromMedia: (mediaFileId: string, input: WorkInput) =>
    call<WorkDetail>("create_work_from_media", { mediaFileId, input }),
  updateWork: (id: string, input: WorkInput) => call<WorkDetail>("update_work", { id, input }),
  deleteWork: (id: string) => call<void>("delete_work", { id }),
  listUnassignedMedia: () => call<MediaFile[]>("list_unassigned_media"),
  listUnassignedGroups: () => call<UnassignedMediaGroup[]>("list_unassigned_media_groups"),
  listRecognitionGroupMembers: (mediaFileId: string, groupScope: RecognitionGroupScope = "season") =>
    call<RecognitionGroupInfo>("list_recognition_group_members", { mediaFileId, groupScope }),
  attachMedia: (workId: string, mediaFileId: string) =>
    call<void>("attach_media_file", { workId, mediaFileId }),
  attachMediaFiles: (workId: string, mediaFileIds: string[]) =>
    call<void>("attach_media_files", { workId, mediaFileIds }),
  detachMedia: (mediaFileId: string) => call<void>("detach_media_file", { mediaFileId }),
  importCover: (sourcePath: string) => call<string>("import_cover", { sourcePath }),
  listRoots: () => call<LibraryRoot[]>("list_library_roots"),
  addRoot: (path: string, kind: RootKind) =>
    call<LibraryRoot>("add_library_root", { input: { path, kind, enabled: true } }),
  updateRoot: (id: string, kind: RootKind, enabled: boolean) =>
    call<void>("update_library_root", { id, kind, enabled }),
  deleteRoot: (id: string) => call<void>("delete_library_root", { id }),
  scanRoot: (id: string) => call<ScanResult>("scan_library_root", { id }),
  listScanJobs: () => call<ScanResult[]>("list_scan_jobs"),
  listTools: () => call<ExternalTool[]>("list_external_tools"),
  createTool: (input: ExternalToolInput) => call<ExternalTool>("create_external_tool", { input }),
  updateTool: (id: string, input: ExternalToolInput) =>
    call<void>("update_external_tool", { id, input }),
  deleteTool: (id: string) => call<void>("delete_external_tool", { id }),
  detectTools: () => call<ExternalTool[]>("detect_external_tools"),
  testTool: (id: string) => call<void>("test_external_tool", { id }),
  launchMedia: (mediaFileId: string, toolId: string | null = null, useSystem = false) =>
    call<void>("launch_media", { mediaFileId, toolId, useSystem }),
  playbackProgress: (workId: string | null = null) => call<import("./playback").PlaybackOverview>("get_playback_progress", { workId }),
  resumePlayback: (mediaFileId: string, restart = false) => call<void>("resume_playback", { mediaFileId, restart }),
  openMediaDirectory: (mediaFileId: string) =>
    call<void>("open_media_directory", { mediaFileId }),
  dashboard: () => call<Dashboard>("get_dashboard"),
  appInfo: () => call<AppInfo>("get_app_info"),
  openDataDirectory: () => call<void>("open_data_directory"),
  getSetting: (key: string) => call<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => call<void>("set_setting", { key, value }),
  recognizeMedia: (mediaFileId: string, query: string | null = null, kind: import("./types").RecognitionKind = "anime", season?: number) =>
    call<RecognitionResult>("recognize_media_file", { mediaFileId, query, kind, season }),
  recognizeUnmatched: (kind: import("./types").RecognitionKind = "anime", mediaFileIds?: string[]) => call<RecognitionSummary>("recognize_unmatched_media", { kind, mediaFileIds }),
  listMatchCandidates: (mediaFileId: string) =>
    call<MatchCandidate[]>("list_match_candidates", { mediaFileId }),
  confirmMatch: (mediaFileId: string, candidateId: string, selectedMediaIds?: string[], groupScope?: RecognitionGroupScope) =>
    call<string>("confirm_match_candidate", { mediaFileId, candidateId, selectedMediaIds, groupScope }),
  listRecognitionHistory: () => call<RecognitionHistoryEntry[]>("list_recognition_history"),
  undoRecognition: (id: string) => call<void>("undo_recognition", { id }),
  cancelMatch: (mediaFileId: string) =>
    call<void>("cancel_match_candidates", { mediaFileId }),
  setFieldLock: (workId: string, field: string, locked: boolean) =>
    call<void>("set_work_field_lock", { workId, field, locked }),
  exploreOverview: async (year: number | null = null, month: number | null = null) =>
    withExploreOverviewAssets(await call<ExploreOverview>("get_explore_overview", { year, month })),
  searchExplore: async (query: string) =>
    (await call<ExploreSubject[]>("search_explore_subjects", { query })).map(withExploreAssets),
  getExploreSubject: async (externalId: string) =>
    withExploreAssets(await call<ExploreSubject>("get_explore_subject", { externalId })),
  saveExploreSubject: (input: ExploreSaveInput) =>
    call<string>("save_explore_subject", { input }),
  discoveryList: (
    category: DiscoveryCategory,
    sort: DiscoverySort,
    tags: string[],
    year: number | null,
    month: number | null,
    page: number,
    pageSize: number,
  ) =>
    call<ExploreSubject[]>("get_discovery_list", {
      category,
      sort,
      tags,
      year,
      month,
      page,
      pageSize,
    }).then((subjects) => subjects.map(withExploreAssets)),
  weeklyCalendar: () => call<WeeklyCalendar>("get_weekly_calendar").then((calendar) => ({
    ...calendar,
    days: calendar.days.map((day) => ({ ...day, items: day.items.map(withExploreAssets) })),
  })),
  checkInLocalLibrary: (bangumiId: string) =>
    call<boolean>("check_in_local_library", { bangumiId }),
  metadataProviderStatuses: () =>
    call<MetadataProviderStatus[]>("get_metadata_provider_statuses"),
  listAnimeEpisodes: (workId: string) =>
    call<AnimeEpisodeMetadata[]>("list_anime_episodes", { workId }),
  getAnimeWorkStructure: async (workId: string) =>
    withAnimeStructureAssets(await call<AnimeWorkStructure>("get_anime_work_structure", { workId })),
  refreshWorkMetadata: async (workId: string) =>
    withAnimeStructureAssets(await call<AnimeWorkStructure>("refresh_work_metadata", { workId })),
  setMediaEpisode: (mediaFileId: string, episodeExternalId: string | null) =>
    call<void>("set_media_episode", { mediaFileId, episodeExternalId }),
  getMediaThumbnail: async (mediaFileId: string, force = false) =>
    localAssetUrl(await call<string | null>("get_media_thumbnail", { mediaFileId, force })) ?? null,
  animeRanking: (page = 1, pageSize = 50) =>
    call<ExploreSubject[]>("get_anime_ranking", { page, pageSize }).then((subjects) =>
      subjects.map(withExploreAssets),
    ),
};
