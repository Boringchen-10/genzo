import { playbackPercent, playbackTime, type PlaybackProgress } from "../playback";
import "./EpisodePlaybackProgress.css";

export function EpisodePlaybackProgress({ progress }: { progress?: PlaybackProgress }) {
  if (!progress || progress.durationMs <= 0) return null;
  const percent = playbackPercent(progress);
  const description = `${progress.fileName}：${playbackTime(progress.positionMs)} / ${playbackTime(progress.durationMs)}`;
  return <div className="episode-playback-progress" role="progressbar" aria-label={`${progress.fileName} 播放进度`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={description} title={description}>
    <span style={{ width: `${percent}%` }} />
  </div>;
}
