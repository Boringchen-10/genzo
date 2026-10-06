import { invoke, isTauri } from "@tauri-apps/api/core";
export interface ReadingNetwork {
  apiHost: string; appVersion: string; route: number; node: string;
  proxyMode: "system" | "direct" | "manual"; proxyUrl: string;
  autoUpdate: boolean; updatedAt: string | null; attemptedAt: string | null;
  comicConcurrency: number; novelConcurrency: number;
}
export interface NodeProbe { host: string; route: number | null; milliseconds: number | null; error: string | null }
export const readingRoutes = [
  ["mapi.hotmangasg.com", "mapi.hotmangasd.com", "mapi.hotmangasf.com"],
  ["mapi.elfgjfghkk.club", "mapi.fgjfghkkcenter.club", "mapi.fgjfghkk.club"],
];
export const defaultReadingNetwork: ReadingNetwork = {
  apiHost: "api.copy202601.com", appVersion: "3.0.9", route: 0, node: "", proxyMode: "system", proxyUrl: "",
  autoUpdate: true, updatedAt: null, attemptedAt: null, comicConcurrency: 4, novelConcurrency: 2,
};
async function call<T>(command: string, config?: ReadingNetwork): Promise<T> {
  if (!isTauri()) throw new Error("阅读网络设置需要在 Genzo 桌面应用中使用。");
  return invoke<T>(command, config ? { config } : {});
}
export const readingNetworkApi = {
  get: () => call<ReadingNetwork>("get_reading_network"),
  save: (config: ReadingNetwork) => call<void>("save_reading_network", config),
  fill: (config: ReadingNetwork) => call<ReadingNetwork>("fill_reading_network", config),
  test: (config: ReadingNetwork) => call<NodeProbe[]>("test_reading_network", config),
};
