import type { MatchCandidate, MediaFile, RecognitionKind } from "./types";

export function candidateKind(candidate?: MatchCandidate): RecognitionKind {
  return candidate?.provider === "tmdb" ? (candidate.subjectType === "movie" ? "movie" : "tv") : "anime";
}

export function fileSeason(file: MediaFile): number | null {
  const explicit = file.fileName.match(/(?:^|[ ._\-[\]])S(\d{1,3})[ ._-]*E\d+/i) ?? file.fileName.match(/(?:^|[ ._\-[\]])(\d{1,2})x\d+\b/i);
  if (explicit) return Number(explicit[1]);
  return file.parsedSeason ?? null;
}

export function initialFilmSelection(files: MediaFile[], representative: MediaFile, kind: RecognitionKind, season: number): string[] {
  const available = files.filter(file => !file.workId || file.workId === representative.workId);
  // In a flat movies folder, other films must not silently join this movie.
  if (kind === "movie") return available.filter(file => file.id === representative.id).map(file => file.id);
  if (kind === "tv") return available.filter(file => fileSeason(file) === season || fileSeason(file) === null).map(file => file.id);
  return available.map(file => file.id);
}
