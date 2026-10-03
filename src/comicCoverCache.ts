import { comicExploreApi } from "./comicExplore";

export interface CachedComicCover { coverPath: string; thumbnailPath: string | null }

export function createComicCoverCache(load: (id: string, url: string, refresh: boolean) => Promise<CachedComicCover>) {
  const cache = new Map<string, CachedComicCover>();
  const pending = new Map<string, Promise<CachedComicCover>>();
  const key = (id: string, url: string) => JSON.stringify([id, url]);
  return {
    peek: (id: string, url: string) => cache.get(key(id, url)),
    invalidate: (id: string, url: string) => cache.delete(key(id, url)),
    load(id: string, url: string, refresh = false) {
      const identity = key(id, url);
      const existing = pending.get(identity);
      if (existing) return existing;
      const cached = cache.get(identity);
      if (cached && !refresh) return Promise.resolve(cached);
      const request = Promise.resolve().then(() => load(id, url, refresh)).then(value => {
        cache.delete(identity); cache.set(identity, value);
        if (cache.size > 128) cache.delete(cache.keys().next().value!);
        return value;
      }).finally(() => pending.delete(identity));
      pending.set(identity, request);
      return request;
    },
  };
}

export const comicCoverCache = createComicCoverCache(comicExploreApi.cacheCover);
