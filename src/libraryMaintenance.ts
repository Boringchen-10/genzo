import { normalizePath } from "./mediaPaths";
export interface Location {
  id: string; workId: string | null; title: string | null; libraryRootId: string | null;
  path: string; fileName: string; mediaType: string; size: number; missing: boolean;
  contentFingerprint: string | null; sourceType: string | null; availability: string | null;
  rootPath: string | null;
}
export interface Issue { kind: string; id: string; title: string; path: string; workId: string | null; rootId: string | null }
export interface IssueGroup { kind: string; total: number; items: Issue[] }
export interface RelocationPair { oldId: string; newId: string }
export interface RelocationPreview { token: string; rows: { pair: RelocationPair; oldPath: string; newPath: string; title: string; size: number; token: string }[] }

// WebDAV keys retain case. Windows/UNC keys compare using the existing path rules.
export function relativeLocation(file: Location) {
  if (!file.rootPath) return null;
  const base = normalizePath(file.rootPath).replaceAll("\\", "/");
  const path = normalizePath(file.path).replaceAll("\\", "/");
  return path.startsWith(base + "/") ? path.slice(base.length + 1) : null;
}
export function locationFolders(files: Location[]) {
  const folders = new Set([""]);
  for (const file of files) {
    const parts = relativeLocation(file)?.split("/") ?? [];
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}
export function folderRelocations(oldFiles: Location[], newFiles: Location[], oldFolder: string, newFolder: string) {
  const suffix = (file: Location, folder: string) => {
    const relative = relativeLocation(file);
    return folder ? relative?.startsWith(folder + "/") ? relative.slice(folder.length + 1) : null : relative;
  };
  const candidates = new Map<string, Location[]>();
  for (const file of newFiles) {
    if (file.workId || file.missing) continue;
    const key = suffix(file, newFolder);
    if (key !== null && key !== undefined) candidates.set(key, [...(candidates.get(key) ?? []), file]);
  }
  const pairs: RelocationPair[] = [];
  let unmatched = 0;
  const used = new Set<string>();
  for (const old of oldFiles) {
    // Directory operations concern already organized/missing records. New targets
    // in the same root must not become sources of their own relocation.
    if (!old.workId && !old.missing) continue;
    const key = suffix(old, oldFolder);
    if (key === null || key === undefined) continue;
    const matches = (candidates.get(key) ?? []).filter(file => file.id !== old.id && file.size > 0 && file.size === old.size && file.mediaType === old.mediaType && (!file.contentFingerprint || !old.contentFingerprint || file.contentFingerprint === old.contentFingerprint));
    if (matches.length === 1 && !used.has(matches[0]!.id)) {
      pairs.push({ oldId: old.id, newId: matches[0]!.id }); used.add(matches[0]!.id);
    } else unmatched++;
  }
  return { pairs, unmatched };
}
