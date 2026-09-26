import { describe, expect, it } from "vitest";
import { matchesLibraryCategory, parseLibraryCategory } from "./libraryCategory";

describe("媒体库作品分类", () => {
  it("区分视频内容品类，同时保留全部视频", () => {
    const works = ["anime", "movie", "tv", "video"].map(category => ({ type: "video" as const, category: category as "anime" | "movie" | "tv" | "video" }));
    expect(works.filter(work => matchesLibraryCategory(work, "movie"))).toEqual([works[1]]);
    expect(works.filter(work => matchesLibraryCategory(work, "video"))).toEqual([works[3]]);
    expect(works.filter(work => matchesLibraryCategory(work, "videos"))).toHaveLength(4);
  });
  it("旧数据按原类型回退，不猜测未知视频", () => {
    expect(matchesLibraryCategory({ type: "video" }, "video")).toBe(true);
    expect(matchesLibraryCategory({ type: "video" }, "anime")).toBe(false);
    for (const type of ["comic", "novel", "game", "other"] as const) {
      expect(matchesLibraryCategory({ type }, type)).toBe(true);
      expect(matchesLibraryCategory({ type }, "videos")).toBe(false);
      expect(matchesLibraryCategory({ type }, "all")).toBe(true);
    }
  });
  it("无效地址参数回退全部分类", () => {
    expect(parseLibraryCategory(null)).toBe("all");
    expect(parseLibraryCategory("invalid")).toBe("all");
    expect(parseLibraryCategory("tv")).toBe("tv");
  });
});
