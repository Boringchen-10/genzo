// Comparison keys only: never use these to open a file or persist its path.
export const normalizePath = (value: string): string => {
  if (/^webdav:\/\//i.test(value)) return value.replace(/\/+$/, "");
  return value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "").replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
};
export const pathBaseName = (value: string) => value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
export const pathDirName = (value: string) => {
  const normalized = normalizePath(value);
  return normalized.slice(0, Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/")));
};
export const pathChildSegment = (parent: string, path: string): string | null => {
  const base = normalizePath(parent);
  const target = normalizePath(path);
  const separator = base.startsWith("webdav://") ? "/" : "\\";
  return target.startsWith(base + separator) ? target.slice(base.length + 1).split(separator)[0] || null : null;
};
