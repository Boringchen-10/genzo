import { invoke } from "@tauri-apps/api/core";
import type { Conflict, SyncStatus } from "../docs/sync-v1/interfaces";
export type { Conflict, SyncStatus };
export interface SyncConnection {
  endpoint: string;
  username: string;
  password: string;
  deviceName: string;
  allowLoopbackHttp: boolean;
}
const call = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
  try { return await invoke<T>(command, args); }
  catch (error) { throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "同步请求失败，请重试"); }
};
export const personalSync = {
  status: () => call<SyncStatus>("sync_status"),
  test: (input: SyncConnection) => call<void>("sync_test_connection", { input }),
  connect: (input: SyncConnection, mode: "create" | "join") => call<SyncStatus>("sync_connect", { input, mode }),
  now: () => call<SyncStatus>("sync_now"),
  enabled: (enabled: boolean) => call<SyncStatus>("sync_set_enabled", { enabled }),
  credentials: (username: string, password: string) => call<void>("sync_update_credentials", { username, password }),
  conflicts: () => call<Conflict[]>("sync_conflicts"),
  resolve: (entity: string, field: string, value: unknown) => call<void>("sync_resolve", { entity, field, value }),
  bindMedia: (mediaFileId: string) => call<string>("sync_bind_media", { mediaFileId }),
};
