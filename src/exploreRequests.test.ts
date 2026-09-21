import { describe, expect, it, vi } from "vitest";
import { createExploreRequests } from "./exploreRequests";
import type { ExploreOverview } from "./types";

describe("explore request coordination", () => {
  it("shares concurrent requests but refreshes completed cached views", async () => {
    const value = { year: 2026 } as ExploreOverview;
    const load = vi.fn().mockResolvedValue(value);
    const requests = createExploreRequests(load);
    const first = requests.load(2026, 7);
    expect(requests.load(2026, 7)).toBe(first);
    await first;
    expect(load).toHaveBeenCalledTimes(1);
    expect(requests.cached(2026, 7)).toBe(value);
    await requests.load(2026, 7);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("preserves cache on failure and permits retry without mixing seasons", async () => {
    const value = { year: 2026 } as ExploreOverview;
    const load = vi.fn().mockResolvedValueOnce(value).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(value);
    const requests = createExploreRequests(load);
    await requests.load(2026, 7);
    await expect(requests.load(2026, 7)).rejects.toThrow("offline");
    expect(requests.cached(2026, 7)).toBe(value);
    expect(requests.cached(2026, 1)).toBeUndefined();
    await requests.load(2026, 7);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
