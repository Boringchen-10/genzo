import { useEffect, useState } from "react";
import { activeScan, type ScanTask } from "../scanTasks";
import { scanTaskApi } from "../api";
import { getErrorMessage } from "../utils";
import "./ScanTaskPanel.css";

const labels: Record<ScanTask["stage"], string> = {
  queued: "等待扫描", scanning: "扫描文件", indexing: "写入索引", committing: "提交索引",
  completed: "扫描完成", failed: "扫描失败", cancelled: "已取消", interrupted: "扫描中断",
};
export function ScanTaskPanel({ onFinished }: { onFinished: () => void }) {
  const [tasks, setTasks] = useState<ScanTask[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous = new Set<string>();
    const poll = async () => {
      try {
        const next = await scanTaskApi.list();
        if (disposed) return;
        if (next.some(task => previous.has(task.id) && !activeScan(task))) onFinished();
        previous = new Set(next.filter(activeScan).map(task => task.id));
        setTasks(next); setError("");
      } catch (cause) { if (!disposed) setError(getErrorMessage(cause)); }
      if (!disposed) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [onFinished]);
  const act = async (task: ScanTask, retry: boolean) => {
    setBusy(current => [...current, task.id]); setError("");
    try {
      if (retry) await scanTaskApi.retry(task.id); else await scanTaskApi.cancel(task.id);
      onFinished();
    } catch (cause) { setError(getErrorMessage(cause)); }
    finally { setBusy(current => current.filter(id => id !== task.id)); }
  };
  if (!tasks.length && !error) return null;
  return <section className="scan-tasks content-section" aria-label="扫描任务">
    <div className="section-heading"><div><h2>扫描任务</h2><span>扫描文件 → 写入索引。作品识别在待整理中执行，图片按需加载。</span></div></div>
    {error && <p role="alert" className="warning-text">{error}</p>}
    {[...tasks.filter(activeScan), ...tasks.filter(task => !activeScan(task)).slice(0, showAll ? 50 : 3)].map(task => <article key={task.id} className="scan-task">
      <div className="scan-task-top"><strong title={task.rootPath}>{task.rootPath}</strong><span>{task.retry ? "失败目录重试 · " : ""}{labels[task.stage]}</span>
        {["queued", "scanning", "indexing"].includes(task.stage) && <button className="button secondary compact" disabled={busy.includes(task.id)} onClick={() => void act(task, false)}>取消扫描</button>}
        {!activeScan(task) && ["completed", "failed"].includes(task.stage) && !!task.failedDirectories.length && <button className="button secondary compact" disabled={busy.includes(task.id)} onClick={() => void act(task, true)}>重试失败目录（{task.failedDirectories.length}）</button>}
      </div>
      {task.currentDirectory && <p className="scan-task-path" title={task.currentDirectory}>{activeScan(task) ? "当前" : "最后"}目录：{task.currentDirectory}</p>}
      <div className="scan-task-stats"><span>已访问 {task.visitedDirectories} 个目录 · 待处理 {task.pendingDirectories}</span><span>发现 {task.discovered} · 已处理 {task.processed} · 复用 {task.reused}</span></div>
      {task.stage === "indexing" && <progress aria-label="索引进度" max={Math.max(task.discovered, 1)} value={task.processed} />}
      {task.stage === "cancelled" && <p>本轮索引未提交，原有文件与关联已保留。网络系统调用可能仍需等待系统返回。</p>}
      {!!task.errors.length && <details><summary>{task.errors.length} 个问题</summary>{task.errors.map((message, index) => <p key={index}>{message}</p>)}</details>}
    </article>)}
    {tasks.filter(task => !activeScan(task)).length > 3 && <button className="button secondary compact" onClick={() => setShowAll(current => !current)}>{showAll ? "收起较早任务" : "查看较早任务"}</button>}
  </section>;
}
