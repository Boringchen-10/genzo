import { describe, expect, it } from "vitest";
import { formatSize, unassignedStatusRank } from "./utils";

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
