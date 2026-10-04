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
export const personalSync = {
  status: () => invoke<SyncStatus>("sync_status"),
  test: (input: SyncConnection) => invoke<void>("sync_test_connection", { input }),
  connect: (input: SyncConnection, mode: "create" | "join") => invoke<SyncStatus>("sync_connect", { input, mode }),
  now: () => invoke<SyncStatus>("sync_now"),
  enabled: (enabled: boolean) => invoke<SyncStatus>("sync_set_enabled", { enabled }),
  credentials: (username: string, password: string) => invoke<void>("sync_update_credentials", { username, password }),
  conflicts: () => invoke<Conflict[]>("sync_conflicts"),
  resolve: (entity: string, field: string, value: unknown) => invoke<void>("sync_resolve", { entity, field, value }),
  bindMedia: (mediaFileId: string) => invoke<string>("sync_bind_media", { mediaFileId }),
};
