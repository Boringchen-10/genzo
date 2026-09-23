import { describe, expect, it } from "vitest";
import { formatSize, recognitionActionLabel, recognitionEntryGroup, recognisableGroups, unassignedStatusRank } from "./utils";
import type { UnassignedMediaGroup } from "./types";

const group = (overrides: Partial<UnassignedMediaGroup>): UnassignedMediaGroup => ({
  key: "group",
  title: "作品",
  folderPath: "C:\\Anime\\作品",
  mediaType: "video",
  fileCount: 2,
  missingCount: 0,
  totalSize: 0,
  recognitionStatus: "unmatched",
  representative: {
    id: "media",
    workId: null,
    libraryRootId: "root",
    path: "C:\\Anime\\作品\\01.mkv",
    fileName: "01.mkv",
    extension: "mkv",
    mediaType: "video",
    size: 0,
    modifiedAt: null,
    missing: false,
    createdAt: "now",
    updatedAt: "now",
    recognitionStatus: "unmatched",
    parsedTitle: null,
    parsedOriginalTitle: null,
    parsedSeason: null,
    parsedEpisode: null,
    parsedYear: null,
    parsedReleaseGroup: null,
    parsedSpecialType: null,
    parsedMediaInfo: "",
    lastRecognizedAt: null,
    recognitionError: null,
  },
  ...overrides,
});

describe("formatSize", () => {
  it("formats common file sizes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1_073_741_824)).toBe("1.0 GB");
  });
});

describe("unassignedStatusRank", () => {
  it("orders actionable recognition states before unmatched and missing groups", () => {
    expect(unassignedStatusRank("candidate_pending", 0, 1)).toBeLessThan(unassignedStatusRank("error", 0, 1));
    expect(unassignedStatusRank("error", 0, 1)).toBeLessThan(unassignedStatusRank("unmatched", 0, 1));
    expect(unassignedStatusRank("unmatched", 0, 1)).toBeLessThan(unassignedStatusRank("unmatched", 1, 1));
  });
});

describe("recognitionEntryGroup", () => {
  it("prefers a pending group and skips non-video or fully missing ones", () => {
    const unmatched = group({ key: "unmatched" });
    const pending = group({ key: "pending", recognitionStatus: "candidate_pending" });
    const comic = group({ key: "comic", mediaType: "comic", recognitionStatus: "candidate_pending" });
    const missing = group({ key: "missing", missingCount: 2, recognitionStatus: "candidate_pending" });

    expect(recognitionEntryGroup([unmatched, pending, comic, missing])?.key).toBe("pending");
    expect(recognitionEntryGroup([comic, missing])).toBeNull();
    expect(recognisableGroups([unmatched, comic, missing]).map((item) => item.key)).toEqual(["unmatched"]);
  });

  it("labels the action by the group state", () => {
    expect(recognitionActionLabel(group({ recognitionStatus: "candidate_pending" }))).toBe("查看候选");
    expect(recognitionActionLabel(group({ recognitionStatus: "unmatched" }))).toBe("识别");
  });
});
