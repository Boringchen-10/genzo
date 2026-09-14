import { describe, expect, it } from "vitest";
import { exploreSourceProblems, filterByTag, formatBroadcast, formatLibraryState, formatRank, formatScore, seasonLabel } from "./explore";
import type { ExploreSourceStatus, ExploreSubject } from "./types";

const source = (overrides: Partial<ExploreSourceStatus>): ExploreSourceStatus => ({
  key: "bangumi",
  label: "Bangumi 官方 API",
  available: true,
  stale: false,
  fetchedAt: "2026-09-14T13:42:00.000Z",
  warning: null,
  ...overrides,
});

const subject = (overrides: Partial<ExploreSubject>): ExploreSubject => ({
  provider: "bangumi",
  externalId: "1",
  title: "示例",
  originalTitle: null,
  aliases: [],
  description: "",
  coverUrl: null,
  year: 2026,
  month: 9,
  airDate: null,
  broadcast: null,
  subjectType: "tv",
  genres: [],
  score: null,
  rank: null,
  ratingCount: 0,
  collectionCount: 0,
  inLibrary: false,
  favorite: false,
  localWorkId: null,
  localStatus: null,
  fetchedAt: "2026-09-14T13:42:00.000Z",
  stale: false,
  ...overrides,
});

describe("seasonLabel", () => {
  it("renders the selected year and month", () => {
    expect(seasonLabel(2026, 9)).toBe("2026 年 9 月");
  });
});

describe("formatScore", () => {
  it("labels a network score instead of showing a bare number", () => {
    expect(formatScore(8.15)).toBe("8.2");
  });

  it("falls back to an explicit empty state", () => {
    expect(formatScore(null)).toBe("暂无网络评分");
  });
});

describe("formatRank", () => {
  it("prefixes an available rank", () => {
    expect(formatRank(402)).toBe("#402");
  });

  it("falls back to an explicit empty state", () => {
    expect(formatRank(null)).toBe("暂无排名");
  });
});

describe("formatBroadcast", () => {
  it("joins the air date and the broadcast cycle", () => {
    expect(formatBroadcast("2026-09-06", "每周日 22:00")).toBe("2026-09-06 · 每周日 22:00");
  });

  it("keeps whichever value is present", () => {
    expect(formatBroadcast("2026-09-06", null)).toBe("2026-09-06");
    expect(formatBroadcast(null, "每周日 22:00")).toBe("每周日 22:00");
  });

  it("shows 未公布 when both are missing", () => {
    expect(formatBroadcast(null, null)).toBe("未公布");
  });
});

describe("formatLibraryState", () => {
  it("states the local status when the subject is in the library", () => {
    expect(formatLibraryState({ inLibrary: true, localStatus: "in_progress" })).toBe("已在媒体库 · 进行中");
  });

  it("does not pretend an unsaved subject is in the library", () => {
    expect(formatLibraryState({ inLibrary: false, localStatus: null })).toBe("未加入媒体库");
  });
});

describe("exploreSourceProblems", () => {
  it("separates unavailable sources from stale caches", () => {
    const problems = exploreSourceProblems([
      source({ key: "bangumi-data", stale: true, warning: "网络更新失败" }),
      source({ key: "bangumi", available: false, fetchedAt: null, warning: "历史月份不使用实时番组日历" }),
    ]);
    expect(problems.staleNotices.map((item) => item.key)).toEqual(["bangumi-data"]);
    expect(problems.blockers.map((item) => item.key)).toEqual(["bangumi"]);
  });

  it("reports nothing for healthy sources", () => {
    const problems = exploreSourceProblems([source({ key: "bangumi-data" }), source({})]);
    expect(problems.blockers).toHaveLength(0);
    expect(problems.staleNotices).toHaveLength(0);
  });
});

describe("filterByTag", () => {
  const subjects = [subject({ externalId: "1", genres: ["科幻"] }), subject({ externalId: "2", genres: ["日常"] })];

  it("returns everything when no tag is selected", () => {
    expect(filterByTag(subjects, null)).toHaveLength(2);
  });

  it("keeps only subjects carrying the tag", () => {
    expect(filterByTag(subjects, "科幻").map((item) => item.externalId)).toEqual(["1"]);
  });
});
