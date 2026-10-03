import { describe, expect, it } from "vitest";
import {
  bookshelfGroupCounts,
  filterBookshelfWorks,
  isBookshelfWork,
  resolveBookshelfGroup,
  type BookshelfSource,
} from "./bookshelf";

const work = (overrides: Partial<BookshelfSource>): BookshelfSource => ({
  type: "comic",
  category: undefined,
  title: "示例",
  originalTitle: null,
  tags: [],
  ...overrides,
});

describe("书架阅读物分组", () => {
  it("只收漫画与小说，视频 / 游戏 / 其他不进书架", () => {
    expect(resolveBookshelfGroup(work({ type: "comic" }))).toBe("comic");
    expect(resolveBookshelfGroup(work({ type: "novel" }))).toBe("novel");
    for (const type of ["video", "game", "other"] as const) {
      expect(resolveBookshelfGroup(work({ type }))).toBeNull();
      expect(isBookshelfWork(work({ type }))).toBe(false);
    }
    expect(isBookshelfWork(work({ type: "comic" }))).toBe(true);
  });

  it("category 优先于 type，分类为漫画 / 小说时按分类归属", () => {
    expect(resolveBookshelfGroup(work({ type: "comic", category: "novel" }))).toBe("novel");
    expect(resolveBookshelfGroup(work({ type: "novel", category: "comic" }))).toBe("comic");
    expect(resolveBookshelfGroup(work({ type: "comic", category: "anime" }))).toBeNull();
  });

  it("按标签细分轻小说与画集 / 设定集，缺标签时回退", () => {
    expect(resolveBookshelfGroup(work({ type: "novel", tags: ["轻小说", "奇幻"] }))).toBe("lightnovel");
    expect(resolveBookshelfGroup(work({ type: "novel", title: "轻小说改编示例" }))).toBe("lightnovel");
    expect(resolveBookshelfGroup(work({ type: "comic", tags: ["画集", "设定集"] }))).toBe("artbook");
    expect(resolveBookshelfGroup(work({ type: "comic", title: "某某 Art Book" }))).toBe("artbook");
    expect(resolveBookshelfGroup(work({ type: "novel", tags: ["推理"] }))).toBe("novel");
    expect(resolveBookshelfGroup(work({ type: "comic", tags: ["冒险"] }))).toBe("comic");
  });

  it("筛选 all 仍剔除非阅读物，分组筛选只返回该组", () => {
    const items = [
      work({ type: "comic", title: "漫画甲" }),
      work({ type: "comic", title: "画集乙", tags: ["画集"] }),
      work({ type: "novel", title: "小说丙" }),
      work({ type: "novel", title: "轻小说丁", tags: ["轻小说"] }),
      work({ type: "video", title: "动画戊" }),
      work({ type: "game", title: "游戏己" }),
    ];
    expect(filterBookshelfWorks(items, "all").map((entry) => entry.title)).toEqual([
      "漫画甲",
      "画集乙",
      "小说丙",
      "轻小说丁",
    ]);
    expect(filterBookshelfWorks(items, "artbook").map((entry) => entry.title)).toEqual(["画集乙"]);
    expect(filterBookshelfWorks(items, "lightnovel").map((entry) => entry.title)).toEqual(["轻小说丁"]);
    expect(bookshelfGroupCounts(items)).toEqual({ comic: 1, lightnovel: 1, artbook: 1, novel: 1 });
  });
});