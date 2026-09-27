import { describe, expect, it } from "vitest";
import { remainingQueue, selectedVideo, selectionGroups, toggleFiles, uniqueTargets } from "./recognitionSelection";
import type { MediaFile } from "./types";
const file = (id: string, parsedSeason: number | null, parsedSpecialType: string | null = null) => ({ id, parsedSeason, parsedSpecialType, fileName: `Show [${id}].mkv` } as MediaFile);
describe("recognition organization", () => {
  it("separates seasons, NCED and OAD without guessing continuous episode boundaries", () => {
    const groups = selectionGroups([file("1", 1), file("13", null), file("14", null), file("2", 2), file("ed", null, "NCED"), file("oad", null, "OAD")]);
    expect(groups.map(group => group.files.map(value => value.id))).toEqual([["1"], ["13", "14"], ["2"], ["ed"], ["oad"]]);
  });
  it("group toggles retain other selections and never duplicate IDs", () => {
    expect(toggleFiles(["1", "ed"], ["1", "2"], true)).toEqual(["1", "ed", "2"]);
    expect(toggleFiles(["1", "2", "ed"], ["1", "2"], false)).toEqual(["ed"]);
  });
  it("a refresh after confirming cannot return to an earlier skipped target", () => {
    const targets = ["skipped", "done", "next"].map(id => ({ media: { id } }));
    expect(remainingQueue({ targets, index: 2 }, new Set(["skipped", "next"]))).toEqual({ targets: [targets[2]], index: 0 });
    expect(remainingQueue({ targets, index: 2 }, new Set(["skipped"]))).toBeNull();
  });
  it("searches using a selected video after switching season checkboxes", () => {
    const files = [file("1", 1), file("13", 2)].map(value => ({ ...value, mediaType: "video" as const, missing: false }));
    expect(selectedVideo(files, ["13"], "1")?.id).toBe("13");
    expect(selectedVideo(files, [], "1")).toBeNull();
    expect(selectedVideo([{ ...files[0]!, missing: true }], ["1"], "1")).toBeNull();
  });
  it("deduplicates representative file targets", () => {
    const target = { media: file("1", 1), scope: "season" as const, label: "Show" };
    expect(uniqueTargets([target, target])).toEqual([target]);
  });
});
