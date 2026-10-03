import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookApi } from "./api";

vi.mock("./api", () => ({ bookApi: { embedded: vi.fn() } }));
const source = { id: "volume", path: "C:/Books/1.epub", size: 1000, modifiedAt: "2026-10-03", contentFingerprint: null };
const data = { title: "卷一", creator: null, series: null, number: "1", description: null, isbn: null, coverPath: "asset://cover" };

beforeEach(() => { vi.resetModules(); vi.mocked(bookApi.embedded).mockReset(); });
describe("book metadata session cache", () => {
  it("shares pending reads and reuses completed data until the scanned source changes", async () => {
    const cache = await import("./bookMetadataCache");
    let finish!: (value: typeof data) => void;
    vi.mocked(bookApi.embedded).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(data);
    const first = cache.loadBookMetadata(source);
    const second = cache.loadBookMetadata(source);
    expect(bookApi.embedded).toHaveBeenCalledTimes(1);
    finish(data);
    expect(await first).toEqual(data);
    expect(await second).toEqual(data);
    expect(cache.cachedBookMetadata(source)).toEqual(data);
    expect(await cache.loadBookMetadata(source)).toEqual(data);
    expect(bookApi.embedded).toHaveBeenCalledTimes(1);
    for (const changed of [{ ...source, size: 2000 }, { ...source, path: "D:/Books/1.epub" }, { ...source, modifiedAt: "2026-10-04" }, { ...source, contentFingerprint: "new" }]) {
      expect(cache.cachedBookMetadata(changed)).toBeUndefined();
      await cache.loadBookMetadata(changed);
    }
    expect(bookApi.embedded).toHaveBeenCalledTimes(5);
  });

  it("does not cache failures or let an older source replace the new source", async () => {
    const cache = await import("./bookMetadataCache");
    vi.mocked(bookApi.embedded).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(data);
    await expect(cache.loadBookMetadata(source)).rejects.toThrow("offline");
    expect(cache.cachedBookMetadata(source)).toBeUndefined();
    expect(await cache.loadBookMetadata(source)).toEqual(data);
    let finish!: (value: typeof data) => void;
    const old = { ...source, size: 3000 };
    const current = { ...source, size: 4000 };
    vi.mocked(bookApi.embedded).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ...data, coverPath: "asset://new" });
    const pending = cache.loadBookMetadata(old);
    await cache.loadBookMetadata(current);
    finish(data);
    await pending;
    expect(cache.cachedBookMetadata(current)?.coverPath).toBe("asset://new");
  });
});
