export interface ScanTask {
  id: string; rootId: string; rootPath: string;
  stage: "queued" | "scanning" | "indexing" | "committing" | "completed" | "failed" | "cancelled" | "interrupted";
  currentDirectory: string; visitedDirectories: number; pendingDirectories: number;
  discovered: number; processed: number; reused: number;
  errors: string[]; failedDirectories: string[]; retry: boolean;
}
export const activeScan = (task: ScanTask) => ["queued", "scanning", "indexing", "committing"].includes(task.stage);
