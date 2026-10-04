import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { personalSync } from "./personalSync";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
test("Tauri string errors keep the actionable synchronization error instead of unknown error", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("AUTH_REQUIRED：认证失败，请更新账号和密码后重试");
  await expect(personalSync.now()).rejects.toThrow("AUTH_REQUIRED：认证失败");
});
