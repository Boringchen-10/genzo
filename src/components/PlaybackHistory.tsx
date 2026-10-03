import { Link } from "react-router-dom";
import { isBookshelfWork } from "../bookshelf";
import { playbackTime, type PlaybackOverview } from "../playback";
import { workCategoryLabel } from "../utils";
import { MediaVisual } from "./MediaVisual";
import type { WorkListItem } from "../types";
import "./PlaybackHistory.css";

/**
 * Minimal functional UI; progress comes only from verified player samples.
 * 首页（无 workId）：渲染与「最近添加」一致的海报卡（海报 + 名称，点击进入作品详情）。
 * 详情页（有 workId）：只保留只读的紧凑观看记录行（文件名 + 进度），不再提供续播按钮。
 */
export function PlaybackHistory({ workId, mediaIds, snapshot, works = [] }: { workId?: string; mediaIds?: string[]; snapshot: { data: PlaybackOverview; error: string }; works?: WorkListItem[] }) {
  const { data, error } = snapshot;
  const sessions = data.sessions.filter(s => !workId || mediaIds?.includes(s.mediaFileId));
  const ordered = data.items.filter(item => !workId || item.workId === workId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  // 详情页只关心当前作品最近一次观看；首页要的是完整记录，故保留排序后的全部条目。
  const items = workId ? ordered.slice(0, 1) : ordered.filter(item =>
    !item.workId || works.some(work => work.id === item.workId && !isBookshelfWork(work)));
  if (!items.length && !sessions.length && !error) return workId ? <p className="quiet-inline">观看记录：从 Genzo 选择 PotPlayer 打开后自动记录；其他播放器目前只支持打开。记录期间请保持 Genzo 运行。</p> : null;
  const notices = <>
    {error && <p role="alert">观看记录读取失败：{error}</p>}
    {sessions.filter(s => s.status !== "stopped" && (!items.length || s.mediaFileId === items[0]?.mediaFileId)).map(s => <p key={s.mediaFileId} className="quiet-inline" role="status">{s.message}</p>)}
  </>;

  /* 首页：与「最近添加」共用手模块式（.gnz-shelf-grid / .gnz-shelf-card）。
     这里展示的是**按观看时间倒序的完整记录**：同一部作品只出现一次（取它最近观看的那一集），
     整体按最近一次观看的时间从新到旧排列，而不是只显示「上次观看」的那一个作品。 */
  if (!workId) {
    const watched = items.filter((item, index) =>
      items.findIndex(other => (other.workId ?? other.mediaFileId) === (item.workId ?? item.mediaFileId)) === index);
    return <section className="playback-history is-home" aria-label="观看记录">
      <div className="section-heading playback-history-heading">
        <div><h2>观看记录</h2><span>{watched.length} 部作品</span></div>
        <details className="playback-history-help"><summary>记录说明</summary><p>PotPlayer 约每 5 秒保存一次，请保持 Genzo 运行。支持在播放器内切换已入库视频；未匹配的文件会等待确认，保留已有进度。</p></details>
      </div>
      {notices}
      {watched.length ? <div className="gnz-shelf-grid">{watched.map(item => {
        const work = works.find(w => w.id === item.workId);
        const title = work?.title ?? item.title ?? item.fileName;
        const meta = `${item.completed ? "已接近片尾" : "上次看到"} ${playbackTime(item.positionMs)} / ${playbackTime(item.durationMs)}${item.missing ? " · 文件暂不可用" : ""}`;
        const content = <>
          <div className="gnz-shelf-poster">
            <MediaVisual type={work?.type ?? "other"} coverPath={work?.coverPath ?? null} thumbnailPath={work?.coverThumbnailPath} alt="" />
            <span className="gnz-shelf-type">{work ? workCategoryLabel(work) : "上次观看"}</span>
            <progress className="playback-history-progress" value={item.positionMs} max={item.durationMs} aria-label={`${item.fileName} 播放进度`} />
          </div>
          <strong title={item.fileName}>{title}</strong>
          <small>{meta}</small>
        </>;
        return item.workId
          ? <Link className="gnz-shelf-card" to={`/library/${item.workId}`} key={item.mediaFileId}>{content}</Link>
          : <div className="gnz-shelf-card" key={item.mediaFileId}>{content}</div>;
      })}</div> : null}
    </section>;
  }

  return <section className="playback-history" aria-label="观看记录">
    <div className="playback-history-heading"><h2>上次观看</h2><details className="playback-history-help"><summary>记录说明</summary><p>PotPlayer 约每 5 秒保存一次，请保持 Genzo 运行。支持在播放器内切换已入库视频；未匹配的文件会等待确认，保留已有进度。</p></details></div>
    {notices}
    {items.map(item => {
      return <div className="playback-history-row" key={item.mediaFileId}>
        <div className="playback-history-info">
          {!workId && item.workId ? <Link to={`/library/${item.workId}`}>{item.title}</Link> : null}
          <strong title={item.fileName}>{item.fileName}</strong>
          <span>{item.completed ? "已接近片尾" : "上次看到"} {playbackTime(item.positionMs)} / {playbackTime(item.durationMs)}{item.missing ? " · 文件暂不可用" : ""}</span>
          <progress value={item.positionMs} max={item.durationMs} aria-label={`${item.fileName} 播放进度`} />
        </div>
      </div>;
    })}
  </section>;
}
