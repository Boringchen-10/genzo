import { describe, expect, it } from "vitest";
import { formatSize } from "./utils";

describe("formatSize", () => {
  it("formats common file sizes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1_073_741_824)).toBe("1.0 GB");
  });
});
