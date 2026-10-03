import { useEffect, useState } from "react";
import { Heart, Library } from "lucide-react";
import { MediaVisual } from "./MediaVisual";
import type { ExploreSubject } from "../types";
import { formatBroadcast, formatRank, formatScore } from "../explore";

/**
 * 探索条目的海报卡片：探索页的作品网格与首页「推荐」共用同一套结构与样式类
 * （`gnz-explore-card*`），避免两处各写一份、日后样式与占位逻辑漂移。
 */

/** 有封面地址就展示；失败或缺失时退回占位图，并在可能仍在后台缓存时请求复查。 */
export function ExploreCover({ subject, onNeedsCover }: { subject: ExploreSubject; onNeedsCover?: () => void }) {
  const [failed, setFailed] = useState(false);
  /* 地址变化（例如后台缓存完成后从远程 URL 变成本地文件）时重置失败标记。 */
  useEffect(() => { setFailed(false); }, [subject.coverUrl]);

  /* 后台缓存完成后有限次复查本地地址。 */
  useEffect(() => {
    if (!subject.coverUrl || /^https?:/i.test(subject.coverUrl)) onNeedsCover?.();
  }, [subject.externalId, subject.coverUrl, onNeedsCover]);

  if (subject.coverUrl && !failed) {
    return (
      <img
        className="gnz-explore-cover"
        src={subject.coverUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => { setFailed(true); onNeedsCover?.(); }}
      />
    );
  }
  return (
    <span className="gnz-explore-cover is-placeholder">
      <MediaVisual type="video" coverPath={null} alt={`${subject.title} 的占位封面`} />
    </span>
  );
}

export function ExploreCard({ subject, onOpen, onNeedsCover }: { subject: ExploreSubject; onOpen: (subject: ExploreSubject) => void; onNeedsCover?: () => void }) {
  return (
    <button type="button" className="gnz-explore-card" onClick={() => onOpen(subject)} aria-label={`查看 ${subject.title} 的条目详情`}>
      <span className="gnz-explore-poster">
        <ExploreCover subject={subject} onNeedsCover={onNeedsCover} />
        {subject.inLibrary ? <span className="gnz-explore-flag"><Library size={12} />入库</span> : null}
        {subject.favorite ? <span className="gnz-explore-flag is-favorite"><Heart size={12} fill="currentColor" />收藏</span> : null}
      </span>
      <span className="gnz-explore-card-body">
        <strong title={subject.title}>{subject.title}</strong>
        <span className="gnz-explore-card-meta">{formatScore(subject.score)} · {formatRank(subject.rank)}</span>
        <span className="gnz-explore-card-sub">{formatBroadcast(subject.airDate, subject.broadcast)}</span>
        <span className="gnz-explore-card-tags">
          {subject.genres.length ? subject.genres.slice(0, 3).map((genre) => <em key={genre}>{genre}</em>) : <em className="is-empty">暂无标签</em>}
        </span>
      </span>
    </button>
  );
}
