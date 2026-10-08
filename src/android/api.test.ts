import { beforeEach, describe, expect, it, vi } from "vitest";

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
import { listenAndroidChanges } from "./api";

describe("Android event subscriptions", () => {
  beforeEach(() => listen.mockReset());

  it("ignores repeated and out-of-order revisions independently for each source and session", async () => {
    const handlers = new Map<string, (event: { payload: object }) => void>();
    const stops = Array.from({ length: 5 }, () => vi.fn());
    listen.mockImplementation(async (name, handler) => { handlers.set(name, handler); return stops[handlers.size - 1]; });
    const changed = vi.fn();
    const stop = await listenAndroidChanges(changed);
    const source = handlers.get("android-source-state")!;
    source({ payload: { sourceId: "a", revision: 10 } });
    source({ payload: { sourceId: "a", revision: 9 } });
    source({ payload: { sourceId: "a", revision: 10 } });
    source({ payload: { sourceId: "b", revision: 1 } });
    source({ payload: { sourceId: "a", revision: 11 } });
    source({ payload: { sourceId: "a", revision: NaN } });
    const player = handlers.get("player-state")!;
    player({ payload: { sessionId: "old", revision: 50 } });
    player({ payload: { sessionId: "new", revision: 1 } });
    player({ payload: { sessionId: "new", revision: 0 } });
    expect(changed).toHaveBeenCalledTimes(5);
    handlers.get("sync-library-updated")!({payload:{}});
    expect(changed).toHaveBeenLastCalledWith("sync-library-updated");
    stop(); stops.forEach(unlisten => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("removes already-installed listeners if subscription setup fails", async () => {
    const stop = vi.fn();
    listen.mockResolvedValueOnce(stop).mockRejectedValueOnce(new Error("bridge unavailable"));
    await expect(listenAndroidChanges(vi.fn())).rejects.toThrow("bridge unavailable");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
