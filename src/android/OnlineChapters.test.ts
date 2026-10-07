import { describe, expect, it } from "vitest";
import { CHAPTER_PAGE_SIZE, chapterPageRange } from "./OnlineChapters";

describe("chapter pagination across the entire group", () => {
  it.each([0, 1, 14, 100, 101, 214, 217, 300])("covers %i entries exactly once in each direction", total => {
    const entries = Array.from({ length: total }, (_, index) => index);
    for (const descending of [false, true]) {
      const loaded = [];
      for (let page = 1; page <= Math.max(1, Math.ceil(total / CHAPTER_PAGE_SIZE)); page++) {
        const range = chapterPageRange(total, page, descending);
        const batch = entries.slice(range.offset, range.offset + CHAPTER_PAGE_SIZE).slice(0, range.length);
        loaded.push(...(descending ? batch.reverse() : batch));
      }
      expect(loaded).toEqual(descending ? [...entries].reverse() : entries);
    }
  });
});
