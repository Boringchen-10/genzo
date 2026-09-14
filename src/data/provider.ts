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
  AppInfo,
  Dashboard,
  ExternalTool,
  ExternalToolInput,
  LibraryRoot,
  MatchCandidate,
  MediaFile,
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

  listWorks(): Promise<WorkListItem[]>;
  getWork(id: string): Promise<WorkDetail>;
  createWork(input: WorkInput): Promise<WorkDetail>;
  createWorkFromMedia(mediaFileId: string, input: WorkInput): Promise<WorkDetail>;
  updateWork(id: string, input: WorkInput): Promise<WorkDetail>;
  deleteWork(id: string): Promise<void>;

  listUnassignedMedia(): Promise<MediaFile[]>;
  listUnassignedGroups(): Promise<UnassignedMediaGroup[]>;
  attachMedia(workId: string, mediaFileId: string): Promise<void>;
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
  openMediaDirectory(mediaFileId: string): Promise<void>;

  dashboard(): Promise<Dashboard>;
  appInfo(): Promise<AppInfo>;
  openDataDirectory(): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  recognizeMedia(mediaFileId: string, query?: string | null): Promise<RecognitionResult>;
  recognizeUnmatched(): Promise<RecognitionSummary>;
  listMatchCandidates(mediaFileId: string): Promise<MatchCandidate[]>;
  confirmMatch(mediaFileId: string, candidateId: string): Promise<string>;
  cancelMatch(mediaFileId: string): Promise<void>;
  setFieldLock(workId: string, field: string, locked: boolean): Promise<void>;
}

/** 后端尚未实现、且 Mock 也不应伪装成功的系统级操作。 */
export class ProviderNotImplementedError extends Error {
  constructor(public readonly operation: string, detail: string) {
    super(`NOT_IMPLEMENTED(${operation}): ${detail}`);
    this.name = "ProviderNotImplementedError";
  }
}
