import { describe, expect, it } from "vitest";
import { latestPlayback, playbackPercent, playbackTime, type PlaybackProgress } from "./playback";

const record = (mediaFileId: string, updatedAt: string, extra: Partial<PlaybackProgress> = {}): PlaybackProgress => ({
  mediaFileId, updatedAt, workId: "work", title: "作品", fileName: mediaFileId,
  toolId: "pot", positionMs: 1000, durationMs: 2000, completed: false, missing: false, ...extra,
});

describe("continue watching selection", () => {
  const items = [record("ep01", "2026-09-24T12:00:00Z"), record("ep07", "2026-09-26T12:00:00Z"), record("ep12", "2026-09-25T12:00:00Z")];
  it("continues the most recently watched episode, regardless of filename order", () => {
    expect(latestPlayback(items, "work")?.mediaFileId).toBe("ep07");
    expect(latestPlayback([...items].reverse(), "work")?.mediaFileId).toBe("ep07");
  });
  it("does not substitute episode one for an unavailable last episode", () => {
    expect(latestPlayback(items.map(item => ({ ...item, missing: item.mediaFileId === "ep07" })), "work")?.missing).toBe(true);
  });
  it("isolates works, reassociated files and episode versions", () => {
    expect(latestPlayback(items, "another-work")).toBeUndefined();
    expect(latestPlayback(items, "work", ["ep01", "ep12"])?.mediaFileId).toBe("ep12");
    expect(latestPlayback(items, "work", [])).toBeUndefined();
  });
  it("uses viewing time, not completion or furthest position", () => {
    expect(latestPlayback([...items, record("rewatch03", "2026-09-27T12:00:00Z", { positionMs: 0 })], "work")?.mediaFileId).toBe("rewatch03");
  });
  it("renders bounded per-file percentages", () => {
    expect(playbackPercent(items[0]!)).toBe(50);
    expect(playbackPercent({ ...items[0]!, durationMs: 0 })).toBe(0);
    expect(playbackPercent({ ...items[0]!, positionMs: 3000 })).toBe(100);
  });
});

describe("playback position display", () => {
  it("formats millisecond checkpoints and long movies without rounding forward", () => {
    expect(playbackTime(59_999)).toBe("0:59");
    expect(playbackTime(3_723_456)).toBe("1:02:03");
    expect(playbackTime(-1)).toBe("0:00");
  });
});
