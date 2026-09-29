export interface BookEntry {
  id: string;
  title: string;
  volumeNumber: number | null;
  chapterNumber: number | null;
  mediaFileIds: string[];
  format: string;
  missing: boolean;
  readState: "unread" | "reading" | "read";
  bangumiId: string | null;
  bangumiTitle: string | null;
  bangumiCoverPath: string | null;
}

export interface BookEntryInput {
  title: string | null;
  volumeNumber: number | null;
  chapterNumber: number | null;
  readState: BookEntry["readState"];
}

export interface BookImportGroup {
  title: string;
  mediaType: "comic" | "novel";
  folderPath: string | null;
  mediaFileIds: string[];
  files: BookImportFile[];
}

export interface BookImportFile {
  id: string;
  path: string;
  fileName: string;
  extension: string;
  missing: boolean;
  volumeNumber: number | null;
}

export interface EmbeddedBookMetadata {
  title: string | null;
  creator: string | null;
  series: string | null;
  number: string | null;
  description: string | null;
  isbn: string | null;
  coverPath: string | null;
}

export interface BookCandidate {
  externalId: string;
  title: string;
  originalTitle: string | null;
  summary: string;
  coverUrl: string | null;
  category: "comic" | "novel" | null;
  series: boolean | null;
  confidence: number;
  stale: boolean;
}

export interface BookVolumeCandidate {
  externalId: string;
  title: string;
  coverUrl: string | null;
  volumeNumber: number | null;
  linkedToSeries: boolean;
  stale: boolean;
}
