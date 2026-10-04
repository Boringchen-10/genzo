import type { WorkDetail } from "../types";
import "./rating-perspective.css";

type RatingProps = Pick<WorkDetail, "networkScore" | "networkScoreProvider" | "networkRatingCount" | "networkRatingDistribution">;

export function RatingPerspective({ networkScore, networkScoreProvider, networkRatingCount, networkRatingDistribution }: RatingProps) {
  const counts = networkRatingDistribution?.length === 10
    && networkRatingDistribution.every(count => Number.isSafeInteger(count) && count >= 0)
    ? networkRatingDistribution : null;
  const total = counts?.reduce((sum, count) => sum + count, 0) ?? 0;
  const maximum = counts ? Math.max(...counts) : 0;
  const provider = networkScoreProvider === "bangumi" ? "Bangumi"
    : networkScoreProvider === "anilist" ? "AniList"
    : networkScoreProvider === "tmdb" ? "TMDB" : "未提供";

  return (
    <section className="rating-perspective" aria-label="评分透视">
      <div className="rating-perspective-heading">
        <h2>评分透视</h2>
        <div className="rating-perspective-summary">
          <strong>{networkScore == null ? "暂无评分" : networkScore.toFixed(1)}</strong>
          <span>{provider}</span>
        </div>
      </div>
      {counts ? (
        <ol className="rating-perspective-chart" aria-label="1 到 10 分评分人数分布">
          {counts.map((count, index) => {
            const score = index + 1;
            const percentage = total ? (count / total * 100).toFixed(1) : "0.0";
            const label = `${score} 分：${count} 人，占 ${percentage}%`;
            return (
              <li key={score}>
                <div className="rating-perspective-bucket" tabIndex={0} role="img" aria-label={label}>
                  <span className="rating-perspective-track" aria-hidden="true">
                    <span className="rating-perspective-bar" style={{ height: `${maximum ? count / maximum * 100 : 0}%` }} />
                  </span>
                  <span className="rating-perspective-tick" aria-hidden="true">{score}</span>
                  <span className="rating-perspective-tooltip" aria-hidden="true">{score} 分 · {count} 人 · {percentage}%</span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="rating-perspective-empty">
          <p>暂无评分分布</p>
          <small>{networkScoreProvider === "bangumi" ? "刷新作品资料后查看各分数人数" : !networkScoreProvider ? "匹配或刷新作品资料后查看" : "当前来源未提供各分数人数"}</small>
        </div>
      )}
      <p className="rating-perspective-count">
        {counts && !total ? "尚无人评分" : networkRatingCount != null && networkRatingCount > 0 ? `${networkRatingCount.toLocaleString()} 人评价`
          : total > 0 ? `${total.toLocaleString()} 人评价` : "暂无评价人数"}
      </p>
    </section>
  );
}
