import { describe, expect, it } from "vitest";
import { correctionAdvice, reliableCorrectionIds, type CorrectionRow } from "./recognitionPreferences";
import { latestPlayback, type PlaybackProgress } from "./playback";

const row = (id: string, extra: Partial<CorrectionRow> = {}): CorrectionRow => ({
  id, fileName: `Show ${id}.mkv`, fromTitle: "第一季", episode: 1, oldEpisode: null,
  officialTitle: "第一集", eligible: true, reliable: true, ...extra,
});
describe("batch episode diagnostics", () => {
  it("selects only reliable main episodes, keeping missing stills independent of association", () => {
    expect(reliableCorrectionIds([
      row("main", { artworkAvailable: false, issues: [{ code: "still_missing", message: "缺图", action: "artwork" }] }),
      row("special", { reliable: false, episodeType: 3 }), row("offline", { reliable: false }),
      row("manual", { reliable: false }), row("other-season", { eligible: false }),
      row("unknown", { reliable: undefined }),
    ])).toEqual(["main"]);
  });
  it("offers different recovery for season conflict, absent primary, ambiguous numbers and network failure", () => {
    expect(correctionAdvice("HTTP 502 请求失败").action).toBe("retry");
    expect(correctionAdvice("季度不一致").action).toBe("target");
    expect(correctionAdvice("影视条目 ID 无效").action).toBe("target");
    expect(correctionAdvice("没有明确的单集编号").action).toBe("sequence");
    expect(correctionAdvice("预览已过期").action).toBe("preview");
  });
  it("resume selection uses preserved media identity after selected files split to the next season", () => {
    const records: PlaybackProgress[] = [
      { mediaFileId: "a", workId: "s1", fileName: "S01E01", title: "第一季", toolId: "pot", positionMs: 12345, durationMs: 1440000, completed: false, updatedAt: "2026-09-26T01:00:00Z", missing: false },
      { mediaFileId: "d", workId: "s2", fileName: "S02E01", title: "第二季", toolId: "pot", positionMs: 654321, durationMs: 1440000, completed: false, updatedAt: "2026-09-27T01:00:00Z", missing: true },
    ];
    expect(latestPlayback(records, "s2", ["d"])?.mediaFileId).toBe("d");
    expect(latestPlayback(records, "s2", ["d"])?.positionMs).toBe(654321);
    expect(latestPlayback(records, "s1")?.mediaFileId).toBe("a");
  });
});
