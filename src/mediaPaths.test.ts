import { describe, expect, it } from "vitest";
import { normalizePath, pathChildSegment, pathDirName } from "./mediaPaths";

describe("media browser paths", () => {
  it("compares extended UNC and Windows paths without case or separator mismatches", () => {
    expect(normalizePath(String.raw`\\?\UNC\Server\Share\Anime`)).toBe(normalizePath("//server/share/anime/"));
    expect(pathChildSegment(String.raw`\\server\share\Anime`, String.raw`\\?\UNC\SERVER\SHARE\Anime\Season 2\01.mkv`)).toBe("season 2");
    expect(pathDirName(String.raw`\\?\R:\Anime\01.mkv`)).toBe(normalizePath("r:/Anime"));
    expect(pathChildSegment("R:/Anime", "R:/Anime2/01.mkv")).toBeNull();
  });
  it("retains WebDAV case and URI boundaries", () => {
    expect(pathChildSegment("webdav://root/Anime", "webdav://root/Anime/S2/01.mkv")).toBe("S2");
    expect(pathChildSegment("webdav://root/Anime", "webdav://root/anime/01.mkv")).toBeNull();
  });
});
