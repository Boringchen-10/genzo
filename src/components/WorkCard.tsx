import { AlertTriangle, Heart, Star } from "lucide-react";
import { Link } from "react-router-dom";
import type { WorkListItem } from "../types";
import { workCategoryLabel } from "../utils";
import { MediaVisual } from "./MediaVisual";

export function WorkCard({ work }: { work: WorkListItem }) {
  return (
    <Link className="work-card" to={`/library/${work.id}`}>
      <div className="poster-frame">
        <MediaVisual type={work.type} coverPath={work.coverPath} thumbnailPath={work.coverThumbnailPath} alt={`${work.title} 封面`} />
        <span className="type-badge">{workCategoryLabel(work)}</span>
        {work.favorite ? (
          <span className="favorite-mark" aria-label="已收藏">
            <Heart size={14} fill="currentColor" />
          </span>
        ) : null}
      </div>
      <div className="work-card-info">
        <strong title={work.title}>{work.title}</strong>
        <div className="work-meta">
          <span>{work.mediaCount} 个文件</span>
          {work.rating !== null ? (
            <span>
              <Star size={12} fill="currentColor" /> {work.rating.toFixed(1)}
            </span>
          ) : null}
          {work.missingCount > 0 ? (
            <span className="warning-text">
              <AlertTriangle size={12} /> {work.missingCount} 缺失
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
