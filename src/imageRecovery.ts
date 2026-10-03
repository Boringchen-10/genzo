export const IMAGE_RETRY_EVENT = "genzo:retry-images";
/** Only derive cache siblings in Genzo's artwork cache, never rewrite remote URLs. */
export function cachedArtworkThumbnail(path: string | null): string | null {
  if (!path || /^(https?:|asset:|data:|blob:)/i.test(path) || !/(?:^|[/\\])covers[/\\]/i.test(path) || /-thumb\.jpe?g$/i.test(path)) return null;
  return /\.jpe?g$/i.test(path) ? path.replace(/\.jpe?g$/i, "-thumb.jpg") : null;
}
export function imageCandidates(sources: (string | null | undefined)[]) {
  return [...new Set(sources.filter((s): s is string => !!s))];
}

/** The cached thumbnail fits 600×900; larger physical frames need the saved source. */
export function posterSources(cover: string | null, thumbnail: string | null | undefined, width: number, height: number) {
  const small = thumbnail ?? cachedArtworkThumbnail(cover);
  return imageCandidates(width > 600 || height > 900 ? [cover, small] : [small, cover]);
}
