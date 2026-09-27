export interface EpisodeArtworkSource { anchor: string; seriesId: number; seasonNumber: number; method: "manual" | "verified" | "primary" }
export interface EpisodeArtwork {
  anchor: string;
  source: EpisodeArtworkSource | null;
  images: Record<string, string>;
  cachedImages: Record<string, string>;
  warnings: string[];
  sourceTitle: string | null;
}
export interface EpisodeArtworkProvider {
  get(workId: string): Promise<EpisodeArtwork>;
  refresh(workId: string, fresh?: boolean): Promise<EpisodeArtwork>;
  preview(workId: string, seriesId: number, seasonNumber: number): Promise<EpisodeArtwork>;
  set(workId: string, seriesId: number, seasonNumber: number, expectedAnchor: string): Promise<EpisodeArtwork>;
  cache(workId: string, episodeKey: string): Promise<string | null>;
}
