/**
 * Genzo 正式运行期 Tauri Provider —— **未实现，由 Codex 负责**
 *
 * 实现方式（约束）：
 * - 在 `src/data/` 内实现 `GenzoDataProvider`，内部委托 `src/api.ts` 的现有命令封装，
 *   不新增或更改 Tauri Command、Rust、SQLite、迁移或 `contracts/`。
 * - `src/api.ts`、`src/types.ts` 归 Codex 所有，本文件只允许 import，不得修改。
 * - 本文件当前对每个操作抛出 `ProviderNotImplementedError`，**不伪造成功**。
 * - 完成后把 `src/data/index.ts` 的选择逻辑切到本 Provider。
 */
import type { GenzoDataProvider, ProviderMeta } from "./provider";
import { ProviderNotImplementedError } from "./provider";

const META: ProviderMeta = { kind: "tauri", label: "Tauri 后端", mock: false };

const pending = (operation: string): never => {
  throw new ProviderNotImplementedError(
    operation,
    "Tauri Provider 尚未实现：请 Codex 委托 src/api.ts 接入真实后端后启用",
  );
};

/**
 * 占位实现：每个方法都显式失败，避免被误用为“已完成”。
 * 用 `satisfies` 保证方法表面与契约一致，便于逐项替换。
 */
export function createTauriProvider(): GenzoDataProvider {
  return {
    meta: META,
    listWorks: () => pending("listWorks"),
    getWork: () => pending("getWork"),
    createWork: () => pending("createWork"),
    createWorkFromMedia: () => pending("createWorkFromMedia"),
    updateWork: () => pending("updateWork"),
    deleteWork: () => pending("deleteWork"),
    listUnassignedMedia: () => pending("listUnassignedMedia"),
    listUnassignedGroups: () => pending("listUnassignedGroups"),
    attachMedia: () => pending("attachMedia"),
    detachMedia: () => pending("detachMedia"),
    importCover: () => pending("importCover"),
    listRoots: () => pending("listRoots"),
    addRoot: () => pending("addRoot"),
    updateRoot: () => pending("updateRoot"),
    deleteRoot: () => pending("deleteRoot"),
    scanRoot: () => pending("scanRoot"),
    listScanJobs: () => pending("listScanJobs"),
    listTools: () => pending("listTools"),
    createTool: () => pending("createTool"),
    updateTool: () => pending("updateTool"),
    deleteTool: () => pending("deleteTool"),
    detectTools: () => pending("detectTools"),
    testTool: () => pending("testTool"),
    launchMedia: () => pending("launchMedia"),
    openMediaDirectory: () => pending("openMediaDirectory"),
    dashboard: () => pending("dashboard"),
    appInfo: () => pending("appInfo"),
    openDataDirectory: () => pending("openDataDirectory"),
    getSetting: () => pending("getSetting"),
    setSetting: () => pending("setSetting"),
    recognizeMedia: () => pending("recognizeMedia"),
    recognizeUnmatched: () => pending("recognizeUnmatched"),
    listMatchCandidates: () => pending("listMatchCandidates"),
    confirmMatch: () => pending("confirmMatch"),
    cancelMatch: () => pending("cancelMatch"),
    setFieldLock: () => pending("setFieldLock"),
  } satisfies GenzoDataProvider;
}
