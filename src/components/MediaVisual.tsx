import { useLayoutEffect, useRef, useState } from "react";
import { ResilientImage } from "./ResilientImage";
import { posterSources } from "../imageRecovery";
import { BookOpen, FileQuestion, Gamepad2, Images, Play } from "lucide-react";
import type { MediaType } from "../types";
import { coverUrl, mediaLabels } from "../utils";
import "./MediaVisual.css";

const icons = {
  video: Play,
  comic: Images,
  novel: BookOpen,
  game: Gamepad2,
  other: FileQuestion,
};

export function MediaVisual({ type, coverPath, thumbnailPath, alt }: { type: MediaType; coverPath: string | null; thumbnailPath?: string | null; alt: string }) {
  const Icon = icons[type];
  const holder = useRef<HTMLSpanElement>(null);
  const [pixels, setPixels] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = holder.current;
    if (!node) return;
    let density: MediaQueryList | undefined;
    const measure = () => {
      const box = node.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      setPixels({ width: box.width * dpr, height: box.height * dpr });
    };
    const watchDensity = () => {
      density?.removeEventListener("change", watchDensity);
      measure();
      density = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      density.addEventListener("change", watchDensity);
    };
    watchDensity();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); density?.removeEventListener("change", watchDensity); };
  }, []);
  const sources = posterSources(coverPath, thumbnailPath, pixels.width, pixels.height).map(path => coverUrl(path ?? null));
  return <span ref={holder} className={`media-visual${type === "video" ? " media-visual-poster" : ""}`}><ResilientImage sources={sources} alt={alt} className="media-cover" fallback={
    <div className={`media-placeholder media-${type}`} aria-label={`${mediaLabels[type]}占位封面`}>
      <Icon size={34} strokeWidth={1.5} /><span>{mediaLabels[type]}</span>
    </div>
  } /></span>;
}
