import { expect, it, vi } from "vitest";
import { createAnimeCoverCache } from "./animeCoverCache";

it("reuses in-flight images and lets new visible posters bypass obsolete queued work", async () => {
  const completions = new Map<string, (url: string) => void>();
  const download = vi.fn((id: string) => new Promise<string>(resolve => completions.set(id, resolve)));
  const cache = createAnimeCoverCache(download);
  const first = Array.from({ length: 4 }, (_, i) => cache.load(String(i), "source", () => true));
  const duplicate = cache.load("0", "source", () => true);
  expect(duplicate).toBe(first[0]);
  let wanted = true;
  const obsolete = cache.load("old", "source", () => wanted).catch(error => error.message);
  const current = cache.load("visible", "source", () => true);
  await Promise.resolve();
  expect(download).toHaveBeenCalledTimes(4);
  wanted = false;
  cache.pump();
  completions.get("0")!("disk-0");
  await first[0]; await Promise.resolve();
  expect(await obsolete).toBe("poster left viewport");
  expect(download.mock.calls.map(([id]) => id)).toEqual(["0", "1", "2", "3", "visible"]);
  completions.get("visible")!("disk-visible");
  await current;
  expect(await cache.load("0", "source", () => true)).toBe("disk-0");
});

it("does not keep network failures and can retry when a poster returns", async () => {
  const download = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue("disk");
  const cache = createAnimeCoverCache(download);
  await expect(cache.load("id", "source", () => true)).rejects.toThrow("offline");
  await Promise.resolve();
  expect(await cache.load("id", "source", () => true)).toBe("disk");
});
