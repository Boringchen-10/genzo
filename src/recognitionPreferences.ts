export interface RecognitionPreference { id: string; workId: string; title: string; kind: string; updatedAt: string }
export interface CorrectionInput {
  sourceWorkId: string | null; targetWorkId: string; mediaFileIds: string[];
  mode: "keep" | "sequence" | "unlink"; startEpisode: number; season: number | null; episodeType: number;
}
export interface CorrectionPreview {
  token: string; title: string; warnings: string[];
  rows: { id: string; fileName: string; fromTitle: string | null; episode: number | null; oldEpisode: string | null; officialTitle: string | null }[];
}
