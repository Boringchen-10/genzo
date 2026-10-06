import { describe, expect, it } from "vitest";
import { appendSourcePage, type SourcePage } from "./bookContent";
import { comicListParams, comicQueryFromParams } from "./comicExplore";
import { getErrorMessage } from "./utils";
const page = (ids: string[], offset = 0, group = "default"): SourcePage => ({ entries: ids.map((id, index) => ({ id, title: id, order: offset + index, count: 1 })), offset, total: 300, group, groups: [], stale: false });
describe("source catalogue and light novel navigation", () => {
  it("shows the actual string returned by a failed Rust IPC call", () => {
    expect(getErrorMessage("网络服务错误：第 2 页连接失败")).toBe("网络服务错误：第 2 页连接失败");
    expect(getErrorMessage(new Error("传输中断"))).toBe("传输中断");
  });
  it("appends source chapters without changing original order", () => {
    const first = page(["c1", "c2"]);
    const result = appendSourcePage(first, page(["c3"], 2));
    expect(result.entries.map(e => e.id)).toEqual(["c1", "c2", "c3"]);
    expect(result.offset).toBe(0); expect(first.entries).toHaveLength(2);
    expect(appendSourcePage(result, page(["c4"], 3)).entries).toHaveLength(4);
  });
  it("rejects a changed group, missing page or overlapping chapters", () => {
    const first = page(["c1", "c2"]);
    expect(() => appendSourcePage(first, page(["c3"], 2, "other"))).toThrow();
    expect(() => appendSourcePage(first, page(["c3"], 3))).toThrow();
    expect(() => appendSourcePage(first, page(["c2"], 2))).toThrow();
  });
  it("keeps light novel filters and route separate from the manga catalogue", () => {
    const input = { query: "猫 & 小说", theme: "", top: "", sort: "updated" as const, page: 2 };
    const params = comicListParams(input, "novel"); params.set("novel", "book");
    expect(params.get("type")).toBe("novel"); expect(params.has("comic")).toBe(false);
    expect(comicQueryFromParams(params)).toEqual(input);
    expect(comicListParams(input, "novel").has("novel")).toBe(false);
  });
});
