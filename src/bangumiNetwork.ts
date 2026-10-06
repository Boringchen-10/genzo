import { invoke, isTauri } from "@tauri-apps/api/core";

export interface BangumiNetwork {
  mode: "system" | "direct" | "mirror";
  mirrorUrl: string;
}

export interface BangumiProbe {
  name: string;
  milliseconds: number | null;
  error: string | null;
}

export const defaultBangumiNetwork: BangumiNetwork = { mode: "system", mirrorUrl: "" };
export const BANGUMI_NETWORK_CHANGED = "genzo-bangumi-network-changed";

async function call<T>(command: string, config?: BangumiNetwork): Promise<T> {
  if (!isTauri()) throw new Error("Bangumi 网络设置需要在 Genzo 应用中使用。");
  return invoke<T>(command, config ? { config } : {});
}

export const bangumiNetworkApi = {
  get: () => call<BangumiNetwork>("get_bangumi_network"),
  save: (config: BangumiNetwork) => call<void>("save_bangumi_network", config),
  test: (config: BangumiNetwork) => call<BangumiProbe[]>("test_bangumi_network", config),
};
