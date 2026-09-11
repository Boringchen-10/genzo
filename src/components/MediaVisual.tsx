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

export function MediaVisual({ type, coverPath, alt }: { type: MediaType; coverPath: string | null; alt: string }) {
  const url = coverUrl(coverPath);
  const Icon = icons[type];
  if (url) {
    return <img className="media-cover" src={url} alt={alt} />;
  }
  return (
    <div className={`media-placeholder media-${type}`} aria-label={`${mediaLabels[type]}占位封面`}>
      <Icon size={34} strokeWidth={1.5} />
      <span>{mediaLabels[type]}</span>
    </div>
  );
}
