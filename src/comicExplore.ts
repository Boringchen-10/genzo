import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ComicItem {
  pathWord: string;
  title: string;
  coverUrl: string | null;
  cachedCoverPath?: string | null;
  cachedCoverThumbnailPath?: string | null;
  authors: string[];
  tags: string[];
  summary: string;
  status: string;
  updatedAt: string;
  latestChapter: string;
  localWorkId: string | null;
  favorite: boolean;
}

export interface ComicPage { items: ComicItem[]; total: number; page: number; stale: boolean }
export type ComicSection = "recommended" | "ranking" | "hotUpdates" | "newArrivals" | "completed";
export type RankPeriod = "day" | "week" | "month";
export type RankAudience = "male" | "female";
export interface ComicFeedEntry { item: ComicItem; popularity: number | null; rankPopularity: number | null; rank: number | null }
export interface ComicHomeSection {
  section: ComicSection; period: RankPeriod | null; audience: RankAudience | null;
  items: ComicFeedEntry[]; total: number | null; supportsPaging: boolean;
}
export interface ComicHome { sections: ComicHomeSection[]; stale: boolean }
export type ComicSectionQuery = { offset: number; limit: number } & (
  | { section: "ranking"; period: RankPeriod; audience?: RankAudience }
  | { section: "recommended" | "newArrivals" | "completed"; period?: never; audience?: never }
);
export interface ComicSectionPage {
  items: ComicFeedEntry[]; total: number; offset: number; limit: number; hasMore: boolean; stale: boolean;
}
export interface ComicDetail { item: ComicItem; aliases: string[]; chapterCount: number | null; stale: boolean }
export interface ComicTheme { name: string; pathWord: string }
export interface ComicQuery { query: string; theme: string; top: string; sort: "popular" | "updated"; page: number }
export interface CopyComment {
  id: string;
  createAt: string;
  userId: string;
  userName: string;
  userAvatar: string;
  comment: string;
  replyCount: number;
  parentId: string | null;
  parentUserId: string | null;
  parentUserName: string | null;
}
export interface CopyCommentPage { items: CopyComment[]; total: number; offset: number; limit: number }

export function comicQueryFromParams(params: URLSearchParams): ComicQuery {
  const page = Number(params.get("page") ?? 1);
  const query = params.get("q") ?? "";
  return {
    query, theme: query ? "" : params.get("theme") ?? "", top: query ? "" : params.get("top") ?? "",
    sort: params.get("sort") === "updated" ? "updated" : "popular",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function comicListParams(input: ComicQuery, kind: "comic" | "novel" = "comic"): URLSearchParams {
  const params = new URLSearchParams({ type: kind });
  if (input.query) params.set("q", input.query);
  if (!input.query && input.theme) params.set("theme", input.theme);
  if (!input.query && input.top) params.set("top", input.top);
  if (input.sort === "updated") params.set("sort", input.sort);
  if (input.page > 1) params.set("page", String(input.page));
  return params;
}

export function appendComicPage(previous: ComicPage, next: ComicPage): ComicPage {
  const items = new Map(previous.items.map(item => [item.pathWord, item]));
  for (const item of next.items) items.set(item.pathWord, item);
  return { ...next, items: [...items.values()], stale: previous.stale || next.stale };
}

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error("作品探索需要在 Genzo 桌面应用中使用。");
  return invoke<T>(command, args);
}

export const comicExploreApi = {
  home: (refresh = false) => call<ComicHome>("get_comic_explore_home", { refresh }),
  section: (input: ComicSectionQuery, refresh = false) => call<ComicSectionPage>("list_comic_explore_section", { input, refresh }),
  list: (input: ComicQuery, refresh = false) => call<ComicPage>("list_comic_explore", { input, refresh }),
  themes: () => call<ComicTheme[]>("get_comic_explore_themes"),
  detail: (pathWord: string, refresh = false) => call<ComicDetail>("get_comic_explore_detail", { pathWord, refresh }),
  cacheCover: (pathWord: string, coverUrl: string, refresh = false) => call<{ coverPath: string; thumbnailPath: string | null }>("cache_comic_explore_cover", { pathWord, coverUrl, refresh }),
  save: (pathWord: string, favorite: boolean) => call<string>("save_comic_explore_work", { pathWord, favorite }),
  comments: (pathWord: string, offset = 0, limit = 10) => call<CopyCommentPage>("get_comic_explore_comments", { pathWord, offset, limit }),
};

export const novelExploreApi = {
  list: (input: ComicQuery, refresh = false) => call<ComicPage>("list_novel_explore", { input, refresh }),
  themes: () => call<ComicTheme[]>("get_novel_explore_themes"),
  detail: (pathWord: string, refresh = false) => call<ComicDetail>("get_novel_explore_detail", { pathWord, refresh }),
  save: (pathWord: string, favorite: boolean) => call<string>("save_novel_explore_work", { pathWord, favorite }),
  comments: (pathWord: string, offset = 0, limit = 10) => call<CopyCommentPage>("get_novel_explore_comments", { pathWord, offset, limit }),
};
