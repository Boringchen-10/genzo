import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
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
  LibraryRoot,
  MediaFile,
  UnassignedMediaGroup,
  MatchCandidate,
  RecognitionResult,
  RecognitionSummary,
  RootKind,
  ScanResult,
  WorkDetail,
  WorkInput,
  WorkListItem,
} from "./types";

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
  attachMedia: (workId: string, mediaFileId: string) =>
    call<void>("attach_media_file", { workId, mediaFileId }),
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
  openMediaDirectory: (mediaFileId: string) =>
    call<void>("open_media_directory", { mediaFileId }),
  dashboard: () => call<Dashboard>("get_dashboard"),
  appInfo: () => call<AppInfo>("get_app_info"),
  openDataDirectory: () => call<void>("open_data_directory"),
  getSetting: (key: string) => call<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => call<void>("set_setting", { key, value }),
  recognizeMedia: (mediaFileId: string, query: string | null = null) =>
    call<RecognitionResult>("recognize_media_file", { mediaFileId, query }),
  recognizeUnmatched: () => call<RecognitionSummary>("recognize_unmatched_media"),
  listMatchCandidates: (mediaFileId: string) =>
    call<MatchCandidate[]>("list_match_candidates", { mediaFileId }),
  confirmMatch: (mediaFileId: string, candidateId: string) =>
    call<string>("confirm_match_candidate", { mediaFileId, candidateId }),
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
};
