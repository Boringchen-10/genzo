/** Wire contract. Host-specific credentials and local paths are intentionally absent. */
export type Clock = Record<string, number>;
export interface Change {
  id: string;
  deviceId: string;
  counter: number;
  context: Clock;
  entity: `work/${string}`;
  field: string;
  value: unknown;
  observedAt: string;
}
export interface SyncDocument {
  protocolVersion: 1;
  libraryId: string;
  revision: number;
  operations: Record<string, Change>;
}
export interface ViewingSession {
  episodeKey: string;
  versionKey: string | null;
  startedAt: string;
  observedAt: string;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  ended: boolean;
}
export interface Conflict {
  entity: string;
  field: string;
  candidates: Change[];
}
export interface SyncStatus {
  connected: boolean;
  enabled: boolean;
  running: boolean;
  endpoint: string | null;
  libraryId: string | null;
  deviceId: string;
  lastSuccess: string | null;
  pending: number;
  conflicts: number;
  errorCode: string | null;
  message: string | null;
}
