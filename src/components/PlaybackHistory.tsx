import { useState } from "react";
import { Link } from "react-router-dom";
import { dataProvider as api } from "../data";
import { playbackTime, type PlaybackOverview } from "../playback";
import { getErrorMessage } from "../utils";
import { useToasts } from "../store";
import "./PlaybackHistory.css";

/** Minimal functional UI; progress comes only from verified player samples. */
export function PlaybackHistory({ workId, mediaIds, snapshot }: { workId?: string; mediaIds?: string[]; snapshot: { data: PlaybackOverview; error: string } }) {
  const { data, error } = snapshot;
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToasts(state => state.push);
  const resume = async (id: string, restart: boolean) => {
    setBusy(id);
    try { await api.resumePlayback(id, restart); toast(restart ? "已请求从头播放" : "已请求继续观看", "success"); }
    catch (err) { toast(getErrorMessage(err), "error"); }
    finally { setBusy(null); }
  };
  const sessions = data.sessions.filter(s => !workId || mediaIds?.includes(s.mediaFileId));
  const items = data.items.filter(item => !workId || item.workId === workId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 1);
  if (!items.length && !sessions.length && !error) return workId ? <p className="quiet-inline">观看记录：从 Genzo 选择 PotPlayer 打开后自动记录；其他播放器目前只支持打开。记录期间请保持 Genzo 运行。</p> : null;
  return <section className="playback-history" aria-label="观看记录">
    <div className="playback-history-heading"><h2>上次观看</h2><details className="playback-history-help"><summary>记录说明</summary><p>PotPlayer 约每 5 秒保存一次，请保持 Genzo 运行。支持在播放器内切换已入库视频；未匹配的文件会等待确认，保留已有进度。</p></details></div>
    {error && <p role="alert">观看记录读取失败：{error}</p>}
    {sessions.filter(s => s.status !== "stopped" && (!items.length || s.mediaFileId === items[0]?.mediaFileId)).map(s => <p key={s.mediaFileId} className="quiet-inline" role="status">{s.message}</p>)}
    {items.map(item => {
      const active = sessions.some(s => s.mediaFileId === item.mediaFileId && ["connecting", "tracking"].includes(s.status));
      return <div className="playback-history-row" key={item.mediaFileId}>
        <div className="playback-history-info">
          {!workId && item.workId ? <Link to={`/library/${item.workId}`}>{item.title}</Link> : null}
          <strong title={item.fileName}>{item.fileName}</strong>
          <span>{item.completed ? "已接近片尾" : "上次看到"} {playbackTime(item.positionMs)} / {playbackTime(item.durationMs)}{item.missing ? " · 文件暂不可用" : ""}</span>
          <progress value={item.positionMs} max={item.durationMs} aria-label={`${item.fileName} 播放进度`} />
        </div>
        <div className="playback-history-actions">
          {!item.completed && <button className="button compact primary" disabled={busy !== null || active || !item.toolId} onClick={() => void resume(item.mediaFileId, false)}>{active ? "记录中" : "继续观看"}</button>}
          <button className="button compact secondary" disabled={busy !== null || active || !item.toolId} onClick={() => void resume(item.mediaFileId, true)}>从头播放</button>
          {!item.toolId && <span>请重新选择 PotPlayer</span>}
        </div>
      </div>;
    })}
  </section>;
}
