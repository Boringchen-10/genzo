import { describe, expect, it, vi } from "vitest";
import { createComicCoverCache } from "./comicCoverCache";

const cover = { coverPath: "cache.jpg", thumbnailPath: "cache-thumb.jpg" };
describe("comic cover session cache", () => {
  it("merges concurrent list/detail reads and reuses completed covers", async () => {
    const load = vi.fn(async () => cover);
    const cache = createComicCoverCache(load);
    const a = cache.load("comic", "source");
    const b = cache.load("comic", "source");
    expect(a).toBe(b);
    await a;
    expect(await cache.load("comic", "source")).toEqual(cover);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("uses new source URLs and explicit retry without overwriting unrelated cache entries", async () => {
    const load = vi.fn(async () => cover);
    const cache = createComicCoverCache(load);
    await cache.load("comic", "old");
    await cache.load("comic", "new");
    await cache.load("comic", "new", true);
    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenLastCalledWith("comic", "new", true);
    expect(cache.peek("comic", "old")).toEqual(cover);
  });
  it("does not retain failed requests; a missing local file can be invalidated", async () => {
    const load = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue(cover);
    const cache = createComicCoverCache(load);
    await expect(cache.load("comic", "source")).rejects.toThrow("offline");
    expect(cache.peek("comic", "source")).toBeUndefined();
    await cache.load("comic", "source");
    cache.invalidate("comic", "source");
    await cache.load("comic", "source");
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("bounds completed session entries", async () => {
    const cache = createComicCoverCache(async () => cover);
    for (let index = 0; index < 129; index++) await cache.load(String(index), "source");
    expect(cache.peek("0", "source")).toBeUndefined();
    expect(cache.peek("128", "source")).toEqual(cover);
  });
});
