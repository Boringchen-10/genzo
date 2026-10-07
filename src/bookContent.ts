import { invoke, isTauri } from "@tauri-apps/api/core";
export type ReadingKind = "comic" | "novel";
export interface SourceEntry { id: string; title: string; order: number; count: number }
export interface SourcePage { entries: SourceEntry[]; total: number; offset: number; group: string; groups: { id: string; title: string }[]; stale: boolean }
export interface CachedContent { entryId: string; title: string; format: string; bytes: number; cachedAt: string }
export interface ReadingResume { entryId: string; group: string; updatedAt: string }
export interface OnlineContent { title: string; pages: string[]; sections: { title: string; text: string | null; imageUrl: string | null }[] }
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("正文获取和外部阅读器需要在 Genzo 桌面应用中使用。");
  return invoke<T>(command, args);
}
export function appendSourcePage(previous: SourcePage, next: SourcePage): SourcePage {
  if (previous.group !== next.group || next.offset !== previous.offset + previous.entries.length) throw new Error("章节目录已经变化，请刷新后重试。");
  const ids = new Set(previous.entries.map(entry => entry.id));
  if (next.entries.some(entry => ids.has(entry.id))) throw new Error("来源返回重复章节，请刷新目录。");
  return { ...next, offset: previous.offset, entries: [...previous.entries, ...next.entries], stale: previous.stale || next.stale };
}
export const bookContentApi = {
  resume: (kind: ReadingKind, pathWord: string) => call<ReadingResume | null>("get_reading_resume", { kind, pathWord }),
  source: (workId: string) => call<{ kind: ReadingKind; pathWord: string } | null>("get_book_reading_source", { workId }),
  entries: (kind: ReadingKind, pathWord: string, group = "", offset = 0, refresh = false) => call<SourcePage>("get_book_source_entries", { kind, pathWord, group, offset, refresh }),
  cached: (kind: ReadingKind, pathWord: string, entryIds: string[]) => call<CachedContent[]>("list_cached_book_content", { kind, pathWord, entryIds }),
  cache: (kind: ReadingKind, pathWord: string, entryId: string, group: string, refresh = false) => call<CachedContent>("cache_book_source_content", { kind, pathWord, entryId, group, refresh }),
  open: (kind: ReadingKind, pathWord: string, entryId: string, folder = false) => call<void>("open_cached_book_content", { kind, pathWord, entryId, folder }),
  clear: (kind: ReadingKind, pathWord: string, entryId: string) => call<void>("clear_cached_book_content", { kind, pathWord, entryId }),
  online: (kind: ReadingKind, pathWord: string, entryId: string, group = "") => call<OnlineContent>("get_book_online_content", { kind, pathWord, entryId, group }),
  image: (url: string) => call<ArrayBuffer>("get_book_online_image", { url }),
};
