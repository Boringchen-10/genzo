/**
 * Genzo 前端数据契约（Provider 接口）
 *
 * 归属：Open Design 负责的前端层（`src/data/`）。本文件只定义接口，不实现任何后端调用。
 *
 * 约束（与用户确认的前后端分工一致）：
 * - `src/api.ts`、`src/services/backend/`、`contracts/` 已确认契约、后端生成的 TypeScript 类型
 *   均由 Codex 负责，本层只允许**读取引用**，不得修改。
 * - 设计阶段由 `mockProvider.ts` 提供明确标记的示例数据；正式阶段由 Codex 用
 *   `tauriProvider.ts` 实现同一接口（内部委托 `src/api.ts`）。
 *
 * 方法表面与 `src/api.ts` 的命令一一对应，便于 Codex 直接映射，不新增或改义。
 */
import type {
  AnimeWorkStructure,
  AppInfo,
  Dashboard,
  ExploreOverview,
  ExploreSaveInput,
  ExploreSubject,
  ExternalTool,
  ExternalToolInput,
  LibraryRoot,
  MatchCandidate,
  MediaFile,
  RecognitionGroupInfo,
  RecognitionHistoryEntry,
  RecognitionGroupScope,
  RecognitionResult,
  RecognitionSummary,
  RootKind,
  ScanResult,
  UnassignedMediaGroup,
  WorkDetail,
  WorkInput,
  WorkListItem,
} from "../types";

export interface ProviderMeta {
  readonly kind: "mock" | "tauri";
  /** 界面可直接显示的来源标记；`mock === true` 时 UI 必须标注“示例数据”。 */
  readonly label: string;
  readonly mock: boolean;
}

export interface GenzoDataProvider {
  readonly meta: ProviderMeta;
  recognitionPreferences?(mediaFileId: string, kind: string): Promise<import("../recognitionPreferences").RecognitionPreference[]>;
  forgetRecognitionPreference?(id: string): Promise<void>;
  previewMediaCorrection?(input: import("../recognitionPreferences").CorrectionInput): Promise<import("../recognitionPreferences").CorrectionPreview>;
  applyMediaCorrection?(input: import("../recognitionPreferences").CorrectionInput, token: string): Promise<string>;
  inspectLibrary?(): Promise<import("../libraryMaintenance").IssueGroup[]>;
  relocationFiles?(rootId: string): Promise<import("../libraryMaintenance").Location[]>;
  previewRelocation?(pairs: import("../libraryMaintenance").RelocationPair[]): Promise<import("../libraryMaintenance").RelocationPreview>;
  applyRelocation?(pairs: import("../libraryMaintenance").RelocationPair[], token: string): Promise<number>;

  listWorks(): Promise<WorkListItem[]>;
  getWork(id: string): Promise<WorkDetail>;
  createWork(input: WorkInput): Promise<WorkDetail>;
  createWorkFromMedia(mediaFileId: string, input: WorkInput): Promise<WorkDetail>;
  updateWork(id: string, input: WorkInput): Promise<WorkDetail>;
  deleteWork(id: string): Promise<void>;

  listUnassignedMedia(): Promise<MediaFile[]>;
  listUnassignedGroups(): Promise<UnassignedMediaGroup[]>;
  listRecognitionGroupMembers(mediaFileId: string, groupScope?: RecognitionGroupScope): Promise<RecognitionGroupInfo>;
  attachMedia(workId: string, mediaFileId: string): Promise<void>;
  attachMediaFiles(workId: string, mediaFileIds: string[]): Promise<void>;
  detachMedia(mediaFileId: string): Promise<void>;
  importCover(sourcePath: string): Promise<string>;

  listRoots(): Promise<LibraryRoot[]>;
  addRoot(path: string, kind: RootKind): Promise<LibraryRoot>;
  updateRoot(id: string, kind: RootKind, enabled: boolean): Promise<void>;
  deleteRoot(id: string): Promise<void>;
  scanRoot(id: string): Promise<ScanResult>;
  listScanJobs(): Promise<ScanResult[]>;

  listTools(): Promise<ExternalTool[]>;
  createTool(input: ExternalToolInput): Promise<ExternalTool>;
  updateTool(id: string, input: ExternalToolInput): Promise<void>;
  deleteTool(id: string): Promise<void>;
  detectTools(): Promise<ExternalTool[]>;
  testTool(id: string): Promise<void>;
  launchMedia(mediaFileId: string, toolId?: string | null, useSystem?: boolean): Promise<void>;
  playbackProgress(workId?: string | null): Promise<import("../playback").PlaybackOverview>;
  resumePlayback(mediaFileId: string, restart?: boolean): Promise<void>;
  openMediaDirectory(mediaFileId: string): Promise<void>;

  dashboard(): Promise<Dashboard>;
  appInfo(): Promise<AppInfo>;
  openDataDirectory(): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  recognizeMedia(mediaFileId: string, query?: string | null, kind?: import("../types").RecognitionKind, season?: number): Promise<RecognitionResult>;
  recognizeUnmatched(kind?: import("../types").RecognitionKind, mediaFileIds?: string[]): Promise<RecognitionSummary>;
  listMatchCandidates(mediaFileId: string): Promise<MatchCandidate[]>;
  confirmMatch(mediaFileId: string, candidateId: string, selectedMediaIds?: string[], groupScope?: RecognitionGroupScope): Promise<string>;
  listRecognitionHistory?(workId?: string): Promise<RecognitionHistoryEntry[]>;
  undoRecognition?(id: string): Promise<void>;
  cancelMatch(mediaFileId: string): Promise<void>;
  setFieldLock(workId: string, field: string, locked: boolean): Promise<void>;

  /**
   * 探索（Bangumi 网络数据）。
   *
   * - `year` / `month` 省略或传 `null` 时表示不限制对应筛选；探索页展示层可用返回的当前季度字段作为标题回退。
   *   后端只接受 1900–2200 年、1–12 月。
   * - 返回的 `score` / `rank` 是 **Bangumi 网络评分与排名**，不是用户个人评分；`null` 表示暂无数据。
   * - `stale` 为真表示网络更新失败、当前使用的是本地过期缓存；`sources[].available` 为假表示该数据源不可用。
   * - 探索失败**不得**影响本地媒体库；页面按错误态呈现。
   *
   * **可选成员**：`src/data/tauriProvider.ts` 由 Codex 维护，本轮不修改。在 Codex 补齐这四个
   * 委托（`exploreOverview: api.exploreOverview` … `saveExploreSubject: api.saveExploreSubject`，
   * 见 `CONTRACT_CHANGELOG.md` 005）之前，桌面壳内这些方法不存在；页面会显示明确的
   * 「尚未接入」错误态，而不是伪造数据。Mock Provider 已完整实现，浏览器预览可用。
   */
  exploreOverview?(year?: number | null, month?: number | null): Promise<ExploreOverview>;
  searchExplore?(query: string): Promise<ExploreSubject[]>;
  getExploreSubject?(externalId: string): Promise<ExploreSubject>;
  /** 幂等加入/更新本地媒体库，返回本地作品 ID；不写入个人评分字段。 */
  saveExploreSubject?(input: ExploreSaveInput): Promise<string>;

  /**
   * 动画详情与分集结构。
   *
   * - `getAnimeWorkStructure` 返回 Bangumi 官方分集、本地多版本文件、关联作品、制作人员与角色。
   * - `refreshWorkMetadata` 返回**刷新后的动画结构**，不返回更新后的 `WorkDetail`；调用方必须
   *   再次 `getWork()` 才能取得更新后的简介与标签。
   * - `setMediaEpisode` 传 `null` 表示解除分集映射。
   * - `getMediaThumbnail` 返回 `null` 是合法结果（部分 MKV/HEVC 无法提取封面帧），UI 必须按
   *   无缩略图状态渲染，**不得用作品海报冒充视频帧**。挂载网盘上的视频自动加载只查
   *   Windows 已缓存的缩略图，`force` 为真时才做一次完整提取（由「重试缩略图」触发）。
   *
   * **可选成员**：`tauriProvider.ts` 由 Codex 维护，其真实委托由 Codex 补齐；页面通过
   * `getAnimeDetailProvider()` 访问，未补齐时显示明确的「尚未接入」状态，不伪造数据。
   */
  getAnimeWorkStructure?(workId: string): Promise<AnimeWorkStructure>;
  refreshWorkMetadata?(workId: string): Promise<AnimeWorkStructure>;
  setMediaEpisode?(mediaFileId: string, episodeExternalId: string | null): Promise<void>;
  getMediaThumbnail?(mediaFileId: string, force?: boolean): Promise<string | null>;

  /**
   * 动画排行榜（按 Bangumi 评分排名，支持分页）。
   *
   * 与「最近 30 日注目动画」不同：后者没有可靠数据源，仍为 Future。见 `getAnimeRankingProvider()`。
   */
  animeRanking?(page?: number, pageSize?: number): Promise<ExploreSubject[]>;
}

/** 探索能力子集：Provider 补齐探索方法后可用（见 `getExploreProvider()`）。 */
export interface GenzoExploreProvider {
  exploreOverview(year?: number | null, month?: number | null): Promise<ExploreOverview>;
  searchExplore(query: string): Promise<ExploreSubject[]>;
  getExploreSubject(externalId: string): Promise<ExploreSubject>;
  saveExploreSubject(input: ExploreSaveInput): Promise<string>;
}

/** 动画详情能力子集：Provider 补齐后可用（见 `getAnimeDetailProvider()`）。 */
export interface GenzoAnimeDetailProvider {
  getAnimeWorkStructure(workId: string): Promise<AnimeWorkStructure>;
  refreshWorkMetadata(workId: string): Promise<AnimeWorkStructure>;
  setMediaEpisode(mediaFileId: string, episodeExternalId: string | null): Promise<void>;
  getMediaThumbnail(mediaFileId: string, force?: boolean): Promise<string | null>;
}

/** 动画排行能力子集：Provider 补齐后可用（见 `getAnimeRankingProvider()`）。 */
export interface GenzoAnimeRankingProvider {
  animeRanking(page?: number, pageSize?: number): Promise<ExploreSubject[]>;
}

/** 后端尚未实现、且 Mock 也不应伪装成功的系统级操作。 */
export class ProviderNotImplementedError extends Error {
  constructor(public readonly operation: string, detail: string) {
    super(`NOT_IMPLEMENTED(${operation}): ${detail}`);
    this.name = "ProviderNotImplementedError";
  }
}
