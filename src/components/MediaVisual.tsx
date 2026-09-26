import { useState } from "react";
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
  const [failed, setFailed] = useState<string[]>([]);
  const source = [thumbnailPath, coverPath].find(path => path && !failed.includes(path));
  const url = coverUrl(source ?? null);
  const Icon = icons[type];
  if (url) {
    return <img key={url} className="media-cover" src={url} alt={alt} decoding="async" onError={() => source && setFailed(previous => [...previous, source])} />;
  }
  return (
    <div className={`media-placeholder media-${type}`} aria-label={`${mediaLabels[type]}占位封面`}>
      <Icon size={34} strokeWidth={1.5} />
      <span>{mediaLabels[type]}</span>
    </div>
  );
}
