import { describe, expect, it } from "vitest";
import { comicListParams, comicQueryFromParams } from "./comicExplore";

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
