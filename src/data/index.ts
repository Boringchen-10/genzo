/**
 * Genzo 数据 Provider 选择入口（前端层）
 *
 * UI 只依赖 `GenzoDataProvider` 契约，不关心数据来自哪里：
 * - 桌面壳（Tauri）运行时 → `tauriProvider.ts`（由 Codex 接入真实后端）
 * - 浏览器 / 设计预览 → `mockProvider.ts`（示例数据，界面会显示“示例数据”标记）
 *
 * 归属：`mockProvider.ts` 由 Open Design 维护；`tauriProvider.ts` 由 Codex 维护，
 * 前端不得写入后端调用实现。两者必须实现同一份 `provider.ts` 接口。
 */
import { createMockProvider } from "./mockProvider";
import { createTauriProvider } from "./tauriProvider";
import type {
  GenzoAnimeDetailProvider,
  GenzoAnimeRankingProvider,
  GenzoDataProvider,
  GenzoExploreProvider,
} from "./provider";

export type {
  GenzoAnimeDetailProvider,
  GenzoAnimeRankingProvider,
  GenzoDataProvider,
  GenzoExploreProvider,
  ProviderMeta,
} from "./provider";
export { MOCK_NOTICE } from "./mockProvider";
export { ProviderNotImplementedError } from "./provider";

/** 是否运行在 Tauri 桌面壳中（只做判定，不触发任何后端调用）。 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let provider: GenzoDataProvider | null = null;

/**
 * 运行期按环境选择 Provider。
 *
 * 注意：在 `tauriProvider.ts` 由 Codex 实现完成前，桌面壳内的数据操作会抛出
 * `ProviderNotImplementedError`（明确报错，不伪造成功）。浏览器预览始终走 Mock。
 */
export function getDataProvider(): GenzoDataProvider {
  if (!provider) {
    provider = (__GENZO_ANDROID__ || isTauriRuntime()) ? createTauriProvider() : createMockProvider();
  }
  return provider;
}

/**
 * 页面使用的 Provider 单例。
 * 用 `dataProvider as api` 引入可保持既有调用点不变（`api.listWorks()` 等）。
 */
export const dataProvider: GenzoDataProvider = getDataProvider();

/**
 * 探索能力访问器。
 *
 * 探索方法在 Provider 契约上标记为**可选**（`src/data/tauriProvider.ts` 由 Codex 维护，
 * 尚未补齐这四个委托）。当运行期 Provider 已实现全部四个方法时返回可直接调用的子集，
 * 否则返回 `null`，由页面显示明确的「尚未接入」错误态，**绝不伪造数据**。
 */
export function getExploreProvider(): GenzoExploreProvider | null {
  const current = getDataProvider();
  const { exploreOverview, searchExplore, getExploreSubject, saveExploreSubject } = current;
  if (!exploreOverview || !searchExplore || !getExploreSubject || !saveExploreSubject) return null;
  return {
    exploreOverview: exploreOverview.bind(current),
    searchExplore: searchExplore.bind(current),
    getExploreSubject: getExploreSubject.bind(current),
    saveExploreSubject: saveExploreSubject.bind(current),
  };
}

/**
 * 动画详情能力访问器。
 *
 * `getAnimeWorkStructure` / `refreshWorkMetadata` / `setMediaEpisode` / `getMediaThumbnail`
 * 在 Provider 契约上标记为**可选**（`src/data/tauriProvider.ts` 由 Codex 维护）。四个方法都
 * 可用时返回可直接调用的子集，否则返回 `null`，由页面显示「尚未接入」，**绝不伪造数据**。
 */
export function getAnimeDetailProvider(): GenzoAnimeDetailProvider | null {
  const current = getDataProvider();
  const { getAnimeWorkStructure, refreshWorkMetadata, setMediaEpisode, getMediaThumbnail } = current;
  if (!getAnimeWorkStructure || !refreshWorkMetadata || !setMediaEpisode || !getMediaThumbnail) return null;
  return {
    getAnimeWorkStructure: getAnimeWorkStructure.bind(current),
    refreshWorkMetadata: refreshWorkMetadata.bind(current),
    setMediaEpisode: setMediaEpisode.bind(current),
    getMediaThumbnail: getMediaThumbnail.bind(current),
  };
}

/** 动画排行能力访问器；未补齐 `animeRanking` 时返回 `null`，页面显示「尚未接入」。 */
export function getAnimeRankingProvider(): GenzoAnimeRankingProvider | null {
  const current = getDataProvider();
  const { animeRanking } = current;
  if (!animeRanking) return null;
  return { animeRanking: animeRanking.bind(current) };
}

/** 供 Codex 接线与测试使用。 */
export { createMockProvider, createTauriProvider };
