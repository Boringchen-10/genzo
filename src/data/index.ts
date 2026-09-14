/**
 * Genzo 数据 Provider 选择入口（前端层）
 *
 * 当前阶段固定返回 **Mock Provider**（明确标记为示例数据）。
 * `tauriProvider.ts` 由 Codex 完成后，把下面的开关切换为：
 *
 * ```ts
 * const provider = isTauriRuntime() ? createTauriProvider() : createMockProvider();
 * ```
 *
 * 这样 UI 只依赖 `GenzoDataProvider` 契约，不需要知道数据来自哪里。
 */
import { createMockProvider } from "./mockProvider";
import { createTauriProvider } from "./tauriProvider";
import type { GenzoDataProvider } from "./provider";

export type { GenzoDataProvider, ProviderMeta } from "./provider";
export { MOCK_NOTICE } from "./mockProvider";
export { ProviderNotImplementedError } from "./provider";

/** 是否运行在 Tauri 桌面壳中（只做判定，不触发任何后端调用）。 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 设计期固定使用 Mock；Codex 完成 Tauri Provider 后按 `isTauriRuntime()` 切换。 */
export function getDataProvider(): GenzoDataProvider {
  return createMockProvider();
}

/** 供 Codex 接线使用，保留导出避免未使用告警。 */
export { createTauriProvider };
