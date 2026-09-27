import { ResilientImage } from "./ResilientImage";
import { cachedArtworkThumbnail } from "../imageRecovery";
import { BookOpen, FileQuestion, Gamepad2, Images, Play } from "lucide-react";
import type { MediaType } from "../types";
import { coverUrl, mediaLabels } from "../utils";

const icons = {
  video: Play,
  comic: Images,
  novel: BookOpen,
  game: Gamepad2,
  other: FileQuestion,
};

export function MediaVisual({ type, coverPath, thumbnailPath, alt }: { type: MediaType; coverPath: string | null; thumbnailPath?: string | null; alt: string }) {
  const Icon = icons[type];
  const sources = [thumbnailPath, cachedArtworkThumbnail(coverPath), coverPath].map(path => coverUrl(path ?? null));
  return <ResilientImage sources={sources} alt={alt} className="media-cover" fallback={
    <div className={`media-placeholder media-${type}`} aria-label={`${mediaLabels[type]}占位封面`}>
      <Icon size={34} strokeWidth={1.5} /><span>{mediaLabels[type]}</span>
    </div>
  } />;
}
