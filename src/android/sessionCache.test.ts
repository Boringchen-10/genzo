import { describe, expect, it, vi } from "vitest";
import { createSessionCache } from "./sessionCache";

describe("Android session reads", () => {
  it("reuses a completed page, including an empty source", async () => {
    const cache = createSessionCache();
    const read = vi.fn(async () => null);
    expect(await cache.load("source:1", read)).toBeNull();
    expect(await cache.load("source:1", read)).toBeNull();
    expect(cache.peek("source:1")).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("shares concurrent requests rather than fetching twice", async () => {
    const cache = createSessionCache();
    const read = vi.fn(async () => [1]);
    const first = cache.load("page:1", read);
    expect(cache.load("page:1", read)).toBe(first);
    expect(await first).toEqual([1]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("allows a failed page to be retried", async () => {
    const cache = createSessionCache();
    await expect(cache.load("page:1", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await cache.load("page:1", async () => [2])).toEqual([2]);
  });
  it("an old response cannot replace a refreshed page", async () => {
    const cache = createSessionCache();
    let complete!: (value: number) => void;
    const first = cache.load("page:1", () => new Promise<number>(resolve => { complete = resolve; }));
    await Promise.resolve();
    expect(await cache.load("page:1", async () => 2, true)).toBe(2);
    complete(1); await first;
    expect(cache.peek("page:1")).toBe(2);
  });
  it("invalidates the changed source without discarding other pages", async () => {
    const cache = createSessionCache();
    cache.set("reading:comic:1", [1]); cache.set("work:1", { favorite: true });
    cache.invalidate("reading:");
    expect(cache.peek("reading:comic:1")).toBeUndefined();
    expect(cache.peek("work:1")).toEqual({ favorite: true });
  });
  it("does not restore an invalidated source when its old request finishes", async () => {
    const cache = createSessionCache();
    let complete!: (value: number) => void;
    const pending = cache.load("reading:1", () => new Promise<number>(resolve => { complete = resolve; }));
    await Promise.resolve(); cache.invalidate("reading:");
    complete(1); await pending;
    expect(cache.peek("reading:1")).toBeUndefined();
  });
});
