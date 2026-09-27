export interface EpisodeArtworkSource { anchor: string; seriesId: number; seasonNumber: number; method: "manual" | "verified" | "primary"; episodeOffset?: number }
export interface EpisodeArtwork {
  anchor: string;
  source: EpisodeArtworkSource | null;
  images: Record<string, string>;
  cachedImages: Record<string, string>;
  warnings: string[];
  sourceTitle: string | null;
  correspondence?: { episodeKey: string; localNumber: number; tmdbNumber: number; hasStill: boolean }[];
}
export interface ArtworkCandidate { seriesId: number; title: string; originalTitle: string; airDate: string | null; confidence: number }
export interface ArtworkSeasons { title: string; seasons: { seasonNumber: number; name: string; episodeCount: number; airDate: string | null }[]; warnings: string[] }
export interface EpisodeArtworkProvider {
  get(workId: string): Promise<EpisodeArtwork>;
  refresh(workId: string, fresh?: boolean): Promise<EpisodeArtwork>;
  search(workId: string, query?: string): Promise<{ candidates: ArtworkCandidate[]; warnings: string[] }>;
  seasons(seriesId: number): Promise<ArtworkSeasons>;
  preview(workId: string, seriesId: number, seasonNumber: number, episodeOffset?: number): Promise<EpisodeArtwork>;
  set(workId: string, seriesId: number, seasonNumber: number, expectedAnchor: string, episodeOffset?: number): Promise<EpisodeArtwork>;
  cache(workId: string, episodeKey: string): Promise<string | null>;
}
