import { describe, expect, it } from "vitest";
import { historyDay, historyInRange, historyTimestamp } from "./recognitionHistoryTime";
import type { RecognitionHistoryEntry } from "./types";
const now = Date.parse("2026-09-27T12:00:00Z");
const entry = (id: string, createdAt: string, undoneAt: string | null = null) => ({
  id, createdAt, undoneAt, targetWorkId: "work", targetTitle: "作品", fileCount: 1,
} satisfies RecognitionHistoryEntry);

describe("recognition history time", () => {
  it("uses exact rolling time boundaries rather than a count or calendar date", () => {
    const items = [entry("boundary", "2026-09-20T12:00:00Z"), entry("old", "2026-09-20T11:59:59Z"), entry("today", "2026-09-27T11:00:00Z"), entry("future", "2026-09-28T12:00:00Z"), entry("invalid", "invalid")];
    expect(historyInRange(items, "7", now).map(x => x.id)).toEqual(["today", "boundary"]);
    expect(historyInRange(items, "1", now).map(x => x.id)).toEqual(["today"]);
    expect(historyInRange(items, "all", now)).toHaveLength(5);
    expect(items[0]?.id).toBe("boundary");
  });
  it("orders actual instants across offsets and does not use undo time", () => {
    const items = [entry("older", "2026-09-27T18:00:00+08:00", "2026-09-27T12:00:00Z"), entry("newer", "2026-09-27T11:00:00Z")];
    expect(historyInRange(items, "7", now).map(x => x.id)).toEqual(["newer", "older"]);
    expect(historyInRange([entry("month", "2026-09-01T12:00:00Z")], "30", now)).toHaveLength(1);
    expect(historyInRange([entry("month", "2026-09-01T12:00:00Z")], "7", now)).toHaveLength(0);
  });
  it("formats local dates and shows seconds without inventing invalid times", () => {
    expect(historyTimestamp("2026-09-27T11:00:23Z")).toContain(":23");
    expect(historyDay("2026-09-27T11:00:23Z")).toBe(historyDay("2026-09-27T19:00:23+08:00"));
    expect(historyTimestamp("invalid")).toBe("时间未知");
  });
});
