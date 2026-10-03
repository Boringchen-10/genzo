import { describe, expect, it } from "vitest";
import { appendComicPage, comicListParams, comicQueryFromParams, type ComicItem, type ComicPage } from "./comicExplore";

describe("comic exploration navigation", () => {
  it("retains directory filters and page across detail and return", () => {
    const query = { query: "", theme: "maoxian", top: "finish", sort: "updated" as const, page: 3 };
    const params = comicListParams(query);
    params.set("comic", "a-short-comic");
    expect(comicQueryFromParams(params)).toEqual(query);
    const returned = comicListParams(comicQueryFromParams(params));
    expect(returned.has("comic")).toBe(false);
    expect(returned.get("type")).toBe("comic");
    expect(comicQueryFromParams(returned)).toEqual(query);
  });
  it("searches special characters without applying directory filters", () => {
    const input = comicQueryFromParams(new URLSearchParams("q=短篇+%26+猫&theme=aiqing&top=finish&page=2"));
    expect(input.theme).toBe(""); expect(input.top).toBe("");
    expect(comicListParams(input).get("q")).toBe("短篇 & 猫");
  });
  it("normalizes invalid paging", () => {
    expect(comicQueryFromParams(new URLSearchParams({ page: "1925" })).page).toBe(1925);
    for (const page of ["0", "-1", "NaN", "2.5", "10001"]) {
      expect(comicQueryFromParams(new URLSearchParams({ page })).page).toBe(1);
    }
  });
});

describe("expanded comic lists", () => {
  const item = (pathWord: string, title = pathWord) => ({ pathWord, title } as ComicItem);
  const page = (items: ComicItem[], number: number, stale = false): ComicPage => ({ items, page: number, total: 60, stale });
  it("appends in source order and replaces overlapping metadata without duplicate cards", () => {
    const initial = page([item("a"), item("b")], 1);
    const expanded = appendComicPage(initial, page([item("b", "Updated"), item("c")], 2));
    expect(expanded.items.map(item => item.pathWord)).toEqual(["a", "b", "c"]);
    expect(expanded.items[1]!.title).toBe("Updated");
    expect(expanded.page).toBe(2);
    expect(initial.items[1]!.title).toBe("b");
  });
  it("keeps the cache notice if any displayed batch is stale", () => {
    expect(appendComicPage(page([item("a")], 1, true), page([item("b")], 2)).stale).toBe(true);
    expect(appendComicPage(page([item("a")], 1), page([item("b")], 2, true)).stale).toBe(true);
  });
});
