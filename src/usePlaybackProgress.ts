import { useEffect, useState } from "react";
import { dataProvider as api } from "./data";
import type { PlaybackOverview } from "./playback";
import { getErrorMessage } from "./utils";

const empty: PlaybackOverview = { items: [], sessions: [] };
export function usePlaybackProgress(workId?: string, enabled = true) {
  const [state, setState] = useState({ workId, data: empty, error: "", loaded: false });
  useEffect(() => {
    let disposed = false;
    let pending = false;
    setState({ workId, data: empty, error: "", loaded: false });
    if (!enabled) return;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const data = await api.playbackProgress(workId);
        if (!disposed) setState({ workId, data, error: "", loaded: true });
      } catch (err) {
        if (!disposed) setState(previous => ({ ...previous, error: getErrorMessage(err) }));
      } finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [workId, enabled]);
  // 路由切换的首帧也不能显示上一个作品的记录。
  return enabled && state.workId === workId ? state : { data: empty, error: "", loaded: false };
}
