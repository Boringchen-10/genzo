import type { ExploreOverview } from "./types";

// Share concurrent reads; completed results are refreshed when revisiting the page.
export function createExploreRequests(load: (year: number | null, month: number | null) => Promise<ExploreOverview>) {
  const pending = new Map<string, Promise<ExploreOverview>>();
  const cache = new Map<string, ExploreOverview>();
  const key = (year: number | null, month: number | null) => `${year}:${month}`;
  return {
    cached: (year: number | null, month: number | null) => cache.get(key(year, month)),
    load(year: number | null, month: number | null) {
      const id = key(year, month);
      const existing = pending.get(id);
      if (existing) return existing;
      const request = Promise.resolve().then(() => load(year, month)).then(result => {
        cache.delete(id);
        cache.set(id, result);
        if (cache.size > 8) cache.delete(cache.keys().next().value!);
        return result;
      }).finally(() => pending.delete(id));
      pending.set(id, request);
      return request;
    },
  };
}
