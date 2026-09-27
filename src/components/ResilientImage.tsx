import { useEffect, useState, type ReactNode } from "react";
import { IMAGE_RETRY_EVENT, imageCandidates } from "../imageRecovery";

/** Falls back through saved assets; retries on demand/connection recovery without a request loop. */
export function ResilientImage({ sources, alt = "", className, fallback }: {
  sources: (string | null | undefined)[]; alt?: string; className?: string; fallback: ReactNode;
}) {
  const candidates = imageCandidates(sources);
  const identity = JSON.stringify(candidates);
  const [state, setState] = useState({ identity, failed: [] as string[], generation: 0 });
  // Source changes are visible immediately, avoiding a stale failure for a new work.
  const failed = state.identity === identity ? state.failed : [];
  const src = candidates.find(s => !failed.includes(s));
  useEffect(() => {
    setState(previous => previous.identity === identity ? previous : { ...previous, identity, failed: [] });
    const retry = () => setState(previous => previous.failed.length || previous.identity !== identity
      ? { identity, failed: [], generation: previous.generation + 1 } : previous);
    window.addEventListener(IMAGE_RETRY_EVENT, retry);
    window.addEventListener("online", retry);
    return () => { window.removeEventListener(IMAGE_RETRY_EVENT, retry); window.removeEventListener("online", retry); };
  }, [identity]);
  if (!src) return <>{fallback}</>;
  return <img key={`${identity}:${src}:${state.generation}`} src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setState(previous => ({ identity, generation: previous.generation, failed: [...new Set([...(previous.identity === identity ? previous.failed : []), src])] }))} />;
}

/** Kept outside clickable cards, so retry never starts playback or creates nested buttons. */
export function RetryImagesButton() {
  return <button type="button" className="button secondary compact" title="重新加载失败的图片；有效图片保持不变" onClick={() => window.dispatchEvent(new Event(IMAGE_RETRY_EVENT))}>重试图片</button>;
}
