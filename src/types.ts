export type MediaType = "video" | "comic" | "novel" | "game" | "other";
export type WorkCategory = MediaType | "anime" | "movie" | "tv";
export type RecognitionKind = "anime" | "movie" | "tv";
export type WorkStatus = "planned" | "in_progress" | "completed" | "paused" | "dropped";
export type RootKind = "auto" | "video" | "comic" | "novel" | "game" | "mixed";
export type ThemeMode = "system" | "light" | "dark";
export type LibraryView = "grid" | "list";

export interface Work {
  /** Content category, separate from the file type used by external tools. */
  category?: WorkCategory;
  id: string;
  title: string;
  originalTitle: string | null;
  type: MediaType;
  description: string;
  coverPath: string | null;
  /** Local cached landscape artwork supplied by the metadata backend. */
  bannerPath?: string | null;
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
  coverThumbnailPath?: string | null;
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
  parsedEpisodeStart?: number | null;
  parsedEpisodeEnd?: number | null;
  parsedYear: number | null;
  parsedReleaseGroup: string | null;
  parsedSpecialType: string | null;
  parsedMediaInfo: string;
  lastRecognizedAt: string | null;
  recognitionError: string | null;
  contentFingerprint?: string | null;
  thumbnailPath?: string | null;
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

/** 识别范围：按季度/特别篇，或整个作品文件夹（含所有季度）。 */
export type RecognitionGroupScope = "season" | "folder";

/** 识别界面读取的分组上下文；members 里含有已经关联过的文件。 */
export interface RecognitionGroupInfo {
  scope: RecognitionGroupScope;
  title: string;
  folderPath: string | null;
  members: MediaFile[];
  linkedWorkId: string | null;
  linkedWorkTitle: string | null;
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
  sourceType?: "local" | "mounted" | "webdav";
  availability?: "unknown" | "online" | "unavailable";
  displayName?: string | null;
}

export interface WebdavConnection {
  name: string;
  endpoint: string;
  directory: string;
  username: string;
  password: string;
  kind: RootKind;
}
export interface RemoteSource { id: string; name: string; endpoint: string; directory: string }
export interface RemoteEntry { href: string; name: string; directory: boolean; size: number; modifiedAt: string | null; etag: string | null }
export interface RemoteCacheEntry { mediaFileId: string; fileName: string; size: number; completed: boolean; pinned: boolean; accessedAt: string }

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

export type ExploreSubjectType = "tv" | "web" | "movie" | "ova";

export interface ExploreSubject {
  provider: "bangumi";
  externalId: string;
  title: string;
  originalTitle: string | null;
  aliases: string[];
  description: string;
  coverUrl: string | null;
  bannerUrl?: string | null;
  year: number | null;
  /** Anime cour start month: 1, 4, 7, or 10. */
  month: number | null;
  airDate: string | null;
  broadcast: string | null;
  subjectType: ExploreSubjectType;
  genres: string[];
  score: number | null;
  rank: number | null;
  ratingCount: number;
  collectionCount: number;
  inLibrary: boolean;
  favorite: boolean;
  localWorkId: string | null;
  localStatus: WorkStatus | null;
  fetchedAt: string;
  stale: boolean;
  sourceKeys?: string[];
  coverProvider?: string | null;
  bannerProvider?: string | null;
  scoreProvider?: string | null;
}

export interface ExploreSourceStatus {
  key: "bangumi-data" | "bangumi";
  label: string;
  available: boolean;
  stale: boolean;
  fetchedAt: string | null;
  warning: string | null;
}

export interface ExploreOverview {
  year: number;
  /** Selected anime cour start month: 1, 4, 7, or 10. */
  month: number;
  seasonal: ExploreSubject[];
  trending: ExploreSubject[];
  availableTags: string[];
  sources: ExploreSourceStatus[];
  fetchedAt: string;
  stale: boolean;
}

export interface ExploreSaveInput {
  externalId: string;
  status: WorkStatus;
  favorite: boolean;
}

export interface WeeklyCalendarDay {
  weekday: number;
  label: string;
  items: ExploreSubject[];
}

export interface WeeklyCalendar {
  sourceVersion: string;
  generatedAt: string;
  days: WeeklyCalendarDay[];
}

export type DiscoveryCategory = "recommended" | "seasonal" | "anime" | "manga";
export type DiscoverySort = "popularity" | "score" | "title" | "date";

export interface MetadataProviderStatus {
  key: "bangumi" | "tmdb" | "anilist" | "douban";
  label: string;
  available: boolean;
  configured: boolean;
  requiresCredential: boolean;
  message: string | null;
}

export interface AnimeEpisodeMetadata {
  provider: string;
  externalId: string;
  episodeNumber: number | null;
  sortNumber: number;
  /** Bangumi 分集类型：0 正片、1 特别篇、2 OP、3 ED、4 预告、5 MAD、6 其他；null 按正片处理。 */
  episodeType: number | null;
  title: string;
  originalTitle: string | null;
  description: string;
  airDate: string | null;
  duration: string | null;
  fetchedAt: string;
}

export interface AnimeSeasonOption {
  externalId: string;
  title: string;
  originalTitle: string | null;
  relation: string;
  seasonNumber: number | null;
  coverUrl: string | null;
  localWorkId: string | null;
  current: boolean;
}

export interface AnimeCredit {
  externalId: string;
  name: string;
  role: string;
  imageUrl: string | null;
}

export interface AnimeCharacter {
  externalId: string;
  name: string;
  role: string;
  imageUrl: string | null;
  actors: string[];
}

export interface AnimeEpisodeEntry extends AnimeEpisodeMetadata {
  imageUrl?: string | null;
  localFiles: MediaFile[];
}

export interface AnimeWorkStructure {
  workId: string;
  bangumiId: string;
  seasons: AnimeSeasonOption[];
  episodes: AnimeEpisodeEntry[];
  unmatchedFiles: MediaFile[];
  staff: AnimeCredit[];
  characters: AnimeCharacter[];
  warnings: string[];
}
