import { describe, expect, it } from "vitest";
import { cachedArtworkThumbnail, imageCandidates, posterSources } from "./imageRecovery";
describe("saved artwork fallback", () => {
  it("derives only local Genzo cache siblings", () => {
    expect(cachedArtworkThumbnail("C:\\Genzo\\covers\\art-cover.jpg")).toBe("C:\\Genzo\\covers\\art-cover-thumb.jpg");
    expect(cachedArtworkThumbnail("/tmp/covers/art.jpg")).toBe("/tmp/covers/art-thumb.jpg");
    for (const path of ["https://host/covers/art.jpg?token=secret", "https://host/covers/art.jpg", "C:\\Pictures\\poster.jpg", "asset://localhost/covers/art.jpg", "C:\\Genzo\\covers\\art-thumb.jpg", null]) expect(cachedArtworkThumbnail(path)).toBeNull();
  });
  it("drops empty and duplicate sources without reordering cached fallback", () => {
    expect(imageCandidates([null, "cache", undefined, "original", "cache", ""])).toEqual(["cache", "original"]);
  });
  it("uses saved originals when the physical frame exceeds the thumbnail budget", () => {
    const cover = "C:\\Genzo\\covers\\art-cover.jpg";
    const thumb = "C:\\Genzo\\covers\\art-cover-thumb.jpg";
    expect(posterSources(cover, thumb, 200 * 3, 300 * 3)).toEqual([thumb, cover]);
    expect(posterSources(cover, thumb, 220 * 3, 330 * 3)).toEqual([cover, thumb]);
    expect(posterSources(cover, undefined, 220 * 3, 330 * 3)).toEqual([cover, thumb]);
    expect(posterSources(null, thumb, 660, 990)).toEqual([thumb]);
    expect(posterSources("https://host/poster.jpg?token=keep", null, 660, 990)).toEqual(["https://host/poster.jpg?token=keep"]);
  });
});
