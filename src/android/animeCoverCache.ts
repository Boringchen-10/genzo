/** Keep in-flight work reusable; drop queued posters that have left the viewport. */
export function createAnimeCoverCache(download: (id: string, url: string) => Promise<string>) {
  const saved = new Map<string, string>();
  const pending = new Map<string, { id: string; url: string; wanted: Set<() => boolean>; started: boolean; promise: Promise<string>; resolve: (value: string) => void; reject: (error: unknown) => void }>();
  let active = 0;
  function pump() {
    for (const [key, entry] of pending) {
      if (entry.started) continue;
      if (![...entry.wanted].some(wanted => wanted())) {
        pending.delete(key); entry.reject(Error("poster left viewport")); continue;
      }
      if (active >= 4) continue;
      active++; entry.started = true;
      void download(entry.id, entry.url).then(value => {
        saved.delete(key); saved.set(key, value);
        if (saved.size > 120) saved.delete(saved.keys().next().value!);
        entry.resolve(value);
      }, entry.reject).finally(() => { active--; pending.delete(key); pump(); });
    }
  }
  return {
    pump,
    load(id: string, url: string, wanted: () => boolean) {
      const key = JSON.stringify([id, url]), cached = saved.get(key);
      if (cached) return Promise.resolve(cached);
      let entry = pending.get(key);
      if (!entry) {
        let resolve!: (value: string) => void, reject!: (error: unknown) => void;
        const promise = new Promise<string>((ok, fail) => { resolve = ok; reject = fail; });
        entry = { id, url, wanted: new Set(), started: false, promise, resolve, reject };
        pending.set(key, entry);
      }
      entry.wanted.add(wanted);
      const promise = entry.promise;
      queueMicrotask(pump);
      return promise;
    },
  };
}
