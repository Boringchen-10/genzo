import { bookApi } from "./api";
import type { EmbeddedBookMetadata } from "./bookData";
import type { MediaFile } from "./types";

type BookSource = Pick<MediaFile, "id" | "path" | "size" | "modifiedAt" | "contentFingerprint">;
// Session cache: scanned source changes invalidate data, failures remain retryable.
const metadata = new Map<string, EmbeddedBookMetadata>();
const pending = new Map<string, Promise<EmbeddedBookMetadata>>();

export function bookMetadataKey(file: BookSource): string {
  return JSON.stringify([file.id, file.path, file.size, file.modifiedAt, file.contentFingerprint]);
}

export function cachedBookMetadata(file: BookSource): EmbeddedBookMetadata | undefined {
  return metadata.get(bookMetadataKey(file));
}

export function loadBookMetadata(file: BookSource): Promise<EmbeddedBookMetadata> {
  const key = bookMetadataKey(file);
  const cached = metadata.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = bookApi.embedded(file.id).then(data => {
    metadata.set(key, data);
    if (metadata.size > 128) metadata.delete(metadata.keys().next().value!);
    return data;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
