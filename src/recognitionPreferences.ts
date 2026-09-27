export interface RecognitionPreference { id: string; workId: string; title: string; kind: string; updatedAt: string }
export interface CorrectionInput {
  sourceWorkId: string | null; targetWorkId: string; mediaFileIds: string[];
  mode: "keep" | "sequence" | "parsed" | "unlink"; startEpisode: number; season: number | null; episodeType: number;
}
export interface CorrectionPreview {
  token: string; title: string; warnings: string[];
  rows: { id: string; fileName: string; fromTitle: string | null; episode: number | null; season?: number | null; episodeType?: number; oldEpisode: string | null; officialTitle: string | null }[];
}
