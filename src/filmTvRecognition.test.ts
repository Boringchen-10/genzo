import { describe, expect, it } from "vitest";
import { candidateKind, fileSeason, initialFilmSelection } from "./filmTvRecognition";
import type { MatchCandidate, MediaFile } from "./types";

const file = (id: string, name: string, workId: string | null = null) => ({ id, fileName: name, parsedSeason: null, workId } as MediaFile);
describe("movie and television recognition selection", () => {
  it("distinguishes provider and media kind", () => {
    expect(candidateKind({ provider: "bangumi", subjectType: "tv" } as MatchCandidate)).toBe("anime");
    expect(candidateKind({ provider: "tmdb", subjectType: "movie" } as MatchCandidate)).toBe("movie");
    expect(candidateKind({ provider: "tmdb", subjectType: "tv" } as MatchCandidate)).toBe("tv");
  });
  it("recognizes season zero and explicit season episode markers", () => {
    expect(fileSeason(file("a", "Show.S00E01.mkv"))).toBe(0);
    expect(fileSeason(file("a", "Show.S02E01.mkv"))).toBe(2);
    expect(fileSeason(file("a", "Show.3x02.mkv"))).toBe(3);
  });
  it("defaults a flat movie folder to just the requested movie", () => {
    const first = file("a", "Movie.2010.mkv");
    expect(initialFilmSelection([first, file("b", "Other.2020.mkv")], first, "movie", 1)).toEqual(["a"]);
  });
  it("keeps the first season and other linked works outside season two selection", () => {
    const second = file("b", "Show.S02E01.mkv", "original");
    const files = [file("a", "Show.S01E01.mkv", "original"), second, file("c", "Show.S02E02.mkv", "another")];
    expect(initialFilmSelection(files, second, "tv", 2)).toEqual(["b"]);
  });
});
