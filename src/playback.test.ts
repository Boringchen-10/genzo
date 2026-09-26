import { describe, expect, it } from "vitest";
import { playbackTime } from "./playback";

describe("playback position display", () => {
  it("formats millisecond checkpoints and long movies without rounding forward", () => {
    expect(playbackTime(59_999)).toBe("0:59");
    expect(playbackTime(3_723_456)).toBe("1:02:03");
    expect(playbackTime(-1)).toBe("0:00");
  });
});
