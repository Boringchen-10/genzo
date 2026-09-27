import { useState } from "react";
import { History, Undo2 } from "lucide-react";
import { dataProvider as api } from "../data";
import type { RecognitionHistoryEntry } from "../types";
import { getErrorMessage } from "../utils";
import { historyDay, historyInRange, historyTimestamp, type HistoryRange } from "../recognitionHistoryTime";
import "../recognition-organizer.css";
import { Modal } from "./common";

export function RecognitionHistory({ workId, onChanged }: { workId?: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecognitionHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [range, setRange] = useState<HistoryRange>("7");
  const [now, setNow] = useState(Date.now);
  const visibleItems = historyInRange(items, range, now);
  const available = !!api.listRecognitionHistory && !!api.undoRecognition;
  const show = async () => {
    setOpen(true); setBusy(true); setError(""); setConfirming(null); setNow(Date.now());
    try { setItems(await api.listRecognitionHistory!(workId)); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const undo = async (id: string) => {
    setBusy(true); setError("");
    try {
      await api.undoRecognition!(id);
      setConfirming(null);
      onChanged();
      setItems(previous => previous.map(item => item.id === id ? { ...item, undoneAt: new Date().toISOString() } : item));
      setItems(await api.listRecognitionHistory!(workId));
      setNow(Date.now());
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="button secondary compact icon-text" disabled={!available} title={available ? workId ? "查看本作品的识别及撤销记录" : "查看最近 50 次识别及撤销记录" : "桌面版提供识别记录"} onClick={() => void show()}><History size={15} />识别记录</button>
    {open ? <Modal title={workId ? "本作品识别记录" : "识别记录与撤销"} width="large" onClose={() => { if (!busy) setOpen(false); }}>
      <p className="quiet-inline">{workId ? "仅显示关联到本作品的识别记录。" : "显示全库识别记录。"}按确认识别的时间筛选，时间使用本机时区；最近 7 / 30 天指过去连续 7 / 30 天。全库最多保留最近 50 条，「全部」也仅包含保留的记录。</p>
      <div className="recognition-selection-tools"><label htmlFor="recognition-history-range">时间范围</label><select id="recognition-history-range" value={range} disabled={busy} onChange={e => { setRange(e.target.value as HistoryRange); setConfirming(null); setNow(Date.now()); }}><option value="1">最近 24 小时</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="all">全部保留记录</option></select><span>{visibleItems.length} 条记录</span></div>
      <p className="quiet-inline">撤销会恢复当时的作品与分集关联；后续已有编辑时会提示冲突。真实媒体文件不受影响。</p>
      {error ? <p className="warning-text" role="alert">{error}</p> : null}
      {busy ? <p role="status">正在处理…</p> : null}
      {!busy && !error && !visibleItems.length ? <p>{items.length ? "所选时间范围内没有识别记录，可切换到更长时间或全部保留记录。" : workId ? "本作品暂无识别记录。升级后确认的识别会保存在这里。" : "暂无识别记录。升级后确认的识别会保存在这里。"}</p> : null}
      <div className="recognition-history-list">{visibleItems.map((item, index) => <section key={item.id}>
        {index === 0 || historyDay(visibleItems[index - 1]!.createdAt) !== historyDay(item.createdAt) ? <h3 className="recognition-history-day">{historyDay(item.createdAt)}</h3> : null}
        <article className="recognition-history-row">
        <div><strong>{item.targetTitle}</strong><small>识别于 {historyTimestamp(item.createdAt)} · {item.fileCount} 个文件 · {item.undoneAt ? "已撤销" : "已识别"}</small>{item.undoneAt ? <small>撤销于 {historyTimestamp(item.undoneAt)}</small> : null}</div>
        {item.undoneAt ? null : confirming === item.id ? <div className="recognition-history-actions"><button type="button" className="button secondary compact" disabled={busy} onClick={() => setConfirming(null)}>取消</button><button type="button" className="button primary compact" disabled={busy} onClick={() => void undo(item.id)}>确认撤销</button></div> : <button type="button" className="button secondary compact icon-text" disabled={busy} onClick={() => setConfirming(item.id)}><Undo2 size={14} />撤销</button>}
      </article></section>)}</div>
    </Modal> : null}
  </>;
}
