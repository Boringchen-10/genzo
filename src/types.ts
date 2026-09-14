export type MediaType = "video" | "comic" | "novel" | "game" | "other";
export type WorkStatus = "planned" | "in_progress" | "completed" | "paused" | "dropped";
export type RootKind = "auto" | "video" | "comic" | "novel" | "game" | "mixed";
export type ThemeMode = "system" | "light" | "dark";
export type LibraryView = "grid" | "list";

export interface Work {
  id: string;
  title: string;
  originalTitle: string | null;
  type: MediaType;
  description: string;
  coverPath: string | null;
  status: WorkStatus;
  favorite: boolean;
  rating: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  metadataStatus: MetadataStatus;
  metadataYear: number | null;
  lastRecognizedAt: string | null;
}

export type MetadataStatus = "unmatched" | "candidate_pending" | "matched" | "manually_created" | "error";
export type RecognitionStatus = "unmatched" | "candidate_pending" | "matched" | "error";

export interface WorkListItem extends Work {
  tags: string[];
  mediaCount: number;
  missingCount: number;
}

export interface MediaFile {
  id: string;
  workId: string | null;
  libraryRootId: string | null;
  path: string;
  fileName: string;
  extension: string;
  mediaType: MediaType;
  size: number;
  modifiedAt: string | null;
  missing: boolean;
  createdAt: string;
  updatedAt: string;
  recognitionStatus: RecognitionStatus;
  parsedTitle: string | null;
  parsedOriginalTitle: string | null;
  parsedSeason: number | null;
  parsedEpisode: string | null;
  parsedYear: number | null;
  parsedReleaseGroup: string | null;
  parsedSpecialType: string | null;
  parsedMediaInfo: string;
  lastRecognizedAt: string | null;
  recognitionError: string | null;
}

export interface UnassignedMediaGroup {
  key: string;
  title: string;
  folderPath: string | null;
  mediaType: MediaType;
  fileCount: number;
  missingCount: number;
  totalSize: number;
  recognitionStatus: RecognitionStatus;
  representative: MediaFile;
}

export interface WorkDetail extends Work {
  tags: string[];
  mediaFiles: MediaFile[];
  metadata: MetadataSummary | null;
  fieldLocks: string[];
  candidates: MatchCandidate[];
  subtitleLinks: SubtitleLink[];
}

export interface SubtitleLink {
  subtitleMediaFileId: string;
  videoMediaFileId: string;
  episode: string | null;
  matchMethod: "episode" | "file_name" | "single_file";
}

export interface MetadataSummary {
  provider: string;
  externalId: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  coverUrl: string | null;
  fetchedAt: string;
}

export interface MatchCandidate {
  id: string;
  mediaFileId: string;
  provider: string;
  externalId: string;
  title: string;
  originalTitle: string | null;
  aliases: string[];
  subjectType: string;
  year: number | null;
  season: number | null;
  coverUrl: string | null;
  confidence: number;
  matchReasons: string[];
  createdAt: string;
}

export interface RecognitionResult {
  mediaFileId: string;
  status: RecognitionStatus;
  parsedTitle: string | null;
  candidates: MatchCandidate[];
  error: string | null;
}

export interface RecognitionSummary {
  scanned: number;
  matched: number;
  pending: number;
  unmatched: number;
  errors: number;
}

export interface WorkInput {
  title: string;
  originalTitle: string | null;
  type: MediaType;
  description: string;
  coverPath: string | null;
  status: WorkStatus;
  favorite: boolean;
  rating: number | null;
  tags: string[];
  notes: string;
}

export interface LibraryRoot {
  id: string;
  path: string;
  kind: RootKind;
  enabled: boolean;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanResult {
  id: string;
  libraryRootId: string;
  status: "running" | "completed" | "completed_with_errors" | "failed";
  discoveredCount: number;
  addedCount: number;
  updatedCount: number;
  missingCount: number;
  startedAt: string;
  finishedAt: string | null;
  errors: string[];
}

export interface ExternalTool {
  id: string;
  name: string;
  executablePath: string;
  supportedMediaTypes: MediaType[];
  argumentsTemplate: string;
  workingDirectory: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalToolInput {
  name: string;
  executablePath: string;
  supportedMediaTypes: MediaType[];
  argumentsTemplate: string;
  workingDirectory: string | null;
  isDefault: boolean;
}

export interface Dashboard {
  totalWorks: number;
  videoCount: number;
  comicCount: number;
  novelCount: number;
  gameCount: number;
  otherCount: number;
  favoriteCount: number;
  missingFileCount: number;
  recentWorks: WorkListItem[];
  favoriteWorks: WorkListItem[];
  lastScan: ScanResult | null;
}

export interface AppInfo {
  version: string;
  databasePath: string;
  coverCachePath: string;
  dataDirectory: string;
}
