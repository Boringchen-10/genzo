import type { Work } from "./types";

/**
 * 书架（阅读物）分组。
 *
 * 后端只把阅读物分成 `comic` / `novel` 两类：轻小说是带轻小说类标签的小说，
 * 画集 / 设定集是带画集类标签的漫画。这里只做**读取映射**——不新增后端字段、
 * 不改写作品类型、不改 API 契约；标签缺失时回退到漫画 / 小说本身。
 */
export const bookshelfGroups = ["comic", "lightnovel", "artbook", "novel"] as const;
export type BookshelfGroup = (typeof bookshelfGroups)[number];

export const bookshelfGroupLabels: Record<BookshelfGroup, string> = {
  comic: "漫画",
  lightnovel: "轻小说",
  artbook: "画集",
  novel: "小说",
};

/** 进入书架的最小输入：后端类型 + 分类 + 标题 + 标签。 */
export type BookshelfSource = Pick<Work, "type" | "category" | "title" | "originalTitle"> & {
  tags?: string[];
};

/** 画集 / 设定集常见写法（后端标签已本地化为中文，兼容常见英文写法）。 */
const artbookTagPattern = /(画集|设定集|原画|画册|资料集|插画集|illustration|art\s*book)/i;
/** 轻小说常见写法：标签或标题里出现即可判定。 */
const lightNovelTagPattern = /(轻小说|ライトノベル|ラノベ|light\s*novel)/i;

function searchableText(work: BookshelfSource): string {
  return [work.title, work.originalTitle ?? "", ...(work.tags ?? [])]
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

/**
 * 解析作品所属的书架分组；不是阅读物（视频 / 游戏 / 其他）时返回 `null`，
 * 这类作品只留在媒体库，不进入书架。
 */
export function resolveBookshelfGroup(work: BookshelfSource): BookshelfGroup | null {
  const kind = work.category ?? work.type;
  if (kind !== "comic" && kind !== "novel") return null;
  const text = searchableText(work);
  if (kind === "comic") return artbookTagPattern.test(text) ? "artbook" : "comic";
  return lightNovelTagPattern.test(text) ? "lightnovel" : "novel";
}

export function isBookshelfWork(work: BookshelfSource): boolean {
  return resolveBookshelfGroup(work) !== null;
}

/** 按分组筛选阅读物；`all` 返回全部阅读物（仍会剔除视频 / 游戏 / 其他）。 */
export function filterBookshelfWorks<T extends BookshelfSource>(
  works: T[],
  group: BookshelfGroup | "all",
): T[] {
  return works.filter((work) => {
    const resolved = resolveBookshelfGroup(work);
    if (resolved === null) return false;
    return group === "all" || resolved === group;
  });
}

/** 每个分组各有多少部（用于筛选项上的数量提示）。 */
export function bookshelfGroupCounts(works: BookshelfSource[]): Record<BookshelfGroup, number> {
  const counts: Record<BookshelfGroup, number> = { comic: 0, lightnovel: 0, artbook: 0, novel: 0 };
  for (const work of works) {
    const resolved = resolveBookshelfGroup(work);
    if (resolved) counts[resolved] += 1;
  }
  return counts;
}