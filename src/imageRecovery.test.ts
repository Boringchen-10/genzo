import { describe, expect, it } from "vitest";
import { cachedArtworkThumbnail, imageCandidates } from "./imageRecovery";
describe("saved artwork fallback", () => {
  it("derives only local Genzo cache siblings", () => {
    expect(cachedArtworkThumbnail("C:\\Genzo\\covers\\art-cover.jpg")).toBe("C:\\Genzo\\covers\\art-cover-thumb.jpg");
    expect(cachedArtworkThumbnail("/tmp/covers/art.jpg")).toBe("/tmp/covers/art-thumb.jpg");
    for (const path of ["https://host/covers/art.jpg?token=secret", "https://host/covers/art.jpg", "C:\\Pictures\\poster.jpg", "asset://localhost/covers/art.jpg", "C:\\Genzo\\covers\\art-thumb.jpg", null]) expect(cachedArtworkThumbnail(path)).toBeNull();
  });
  it("drops empty and duplicate sources without reordering cached fallback", () => {
    expect(imageCandidates([null, "cache", undefined, "original", "cache", ""])).toEqual(["cache", "original"]);
  });
});
