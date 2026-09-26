import type { Work, WorkCategory } from "./types";

export const libraryCategories = ["all", "anime", "movie", "tv", "comic", "novel", "game", "videos", "video", "other"] as const;
export type LibraryCategory = typeof libraryCategories[number];

export function parseLibraryCategory(value: string | null): LibraryCategory {
  return libraryCategories.includes(value as LibraryCategory) ? value as LibraryCategory : "all";
}

export function matchesLibraryCategory(work: Pick<Work, "type" | "category">, category: LibraryCategory): boolean {
  if (category === "all") return true;
  if (category === "videos") return work.type === "video";
  const resolved: WorkCategory = work.category ?? work.type;
  return resolved === category;
}
