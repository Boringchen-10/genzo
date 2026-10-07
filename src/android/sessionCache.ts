// Android WebView session only: no credentials, media bytes or persistent storage.
export function createSessionCache() {
  const entries = new Map<string, { value?: unknown; pending?: Promise<unknown> }>();
  return {
    peek<T>(key: string): T | undefined { return entries.get(key)?.value as T | undefined; },
    set<T>(key: string, value: T) { entries.set(key, { value }); },
    invalidate(prefix: string) { for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key); },
    load<T>(key: string, read: () => Promise<T>, refresh = false): Promise<T> {
      if (refresh) entries.delete(key);
      const existing = entries.get(key);
      if (existing?.pending) return existing.pending as Promise<T>;
      if (existing && "value" in existing) return Promise.resolve(existing.value as T);
      const entry: { value?: unknown; pending?: Promise<unknown> } = {};
      const pending = Promise.resolve().then(read).then(value => {
        if (entries.get(key) === entry) entries.set(key, { value });
        return value;
      }, reason => {
        if (entries.get(key) === entry) entries.delete(key);
        throw reason;
      });
      entry.pending = pending;
      entries.set(key, entry);
      return pending;
    },
  };
}

export const androidSession = createSessionCache();
export const READING_NETWORK_CHANGED = "genzo-android-reading-network-changed";
