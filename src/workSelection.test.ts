import { describe, expect, it } from "vitest";
import { firstWorkFile, recentlyAdded } from "./workSelection";
import type { MediaFile } from "./types";
import { coverUrl } from "./utils";

const file = (id: string, extra: Partial<MediaFile> = {}) => ({ id, fileName: id, path: `D:/${id}`, mediaType: "video", missing: false, parsedSeason: 1, parsedEpisodeStart: null, parsedSpecialType: null, ...extra } as MediaFile);
describe("work entry selection", () => {
  it("skips subtitles, extras and missing videos, using numeric episode order", () => {
    const files = [file("00.ass", { mediaType: "other" }), file("00-NCOP.mkv", { parsedSpecialType: "NCOP" }), file("ep10", { parsedEpisodeStart: 10 }), file("ep02", { parsedEpisodeStart: 2 }), file("ep01", { parsedEpisodeStart: 1, missing: true })];
    expect(firstWorkFile(files, "video")?.id).toBe("ep02");
    expect(firstWorkFile([files[0]!], "video")).toBeUndefined();
  });
  it("allows a WebDAV video through its existing remote launch path", () => {
    expect(firstWorkFile([file("remote", { missing: true, path: "webdav://root/01.mkv" })], "video")?.id).toBe("remote");
  });
  it("sorts additions by creation time even if an old work was just updated", () => {
    const works = [{ id: "old", createdAt: "2025-01-01", updatedAt: "2026-10-01" }, { id: "new", createdAt: "2026-09-01", updatedAt: "2026-09-01" }];
    expect(recentlyAdded(works).map(work => work.id)).toEqual(["new", "old"]);
    expect(works[0]?.id).toBe("old");
  });
  it("does not encode existing image URLs a second time", () => {
    for (const url of ["http://asset.localhost/C%3A%5Ccover.jpg", "asset://localhost/cover.jpg", "https://example.test/cover.jpg", "/demo/video-1.jpg"]) expect(coverUrl(url)).toBe(url);
  });
});
