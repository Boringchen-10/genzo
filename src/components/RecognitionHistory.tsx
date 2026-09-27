import { useState } from "react";
import { History, Undo2 } from "lucide-react";
import { dataProvider as api } from "../data";
import type { RecognitionHistoryEntry } from "../types";
import { formatDate, getErrorMessage } from "../utils";
import "../recognition-organizer.css";
import { Modal } from "./common";

export function RecognitionHistory({ workId, onChanged }: { workId?: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecognitionHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const available = !!api.listRecognitionHistory && !!api.undoRecognition;
  const show = async () => {
    setOpen(true); setBusy(true); setError(""); setConfirming(null);
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
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="button secondary compact icon-text" disabled={!available} title={available ? workId ? "查看本作品的识别及撤销记录" : "查看最近 50 次识别及撤销记录" : "桌面版提供识别记录"} onClick={() => void show()}><History size={15} />识别记录</button>
    {open ? <Modal title={workId ? "本作品识别记录" : "识别记录与撤销"} width="large" onClose={() => { if (!busy) setOpen(false); }}>
      <p className="quiet-inline">{workId ? "仅显示关联到本作品的识别记录。" : "显示全库最近 50 次识别。"}撤销会恢复当时的作品与分集关联；后续已有编辑时会提示冲突。真实媒体文件不受影响。</p>
      {error ? <p className="warning-text" role="alert">{error}</p> : null}
      {busy ? <p role="status">正在处理…</p> : null}
      {!busy && !items.length ? <p>{workId ? "本作品暂无识别记录。" : "暂无识别记录。"}升级后确认的识别会保存在这里。</p> : null}
      <div className="recognition-history-list">{items.map(item => <article key={item.id} className="recognition-history-row">
        <div><strong>{item.targetTitle}</strong><small>{formatDate(item.createdAt)} · {item.fileCount} 个文件 · {item.undoneAt ? "已撤销" : "已识别"}</small></div>
        {item.undoneAt ? null : confirming === item.id ? <div className="recognition-history-actions"><button type="button" className="button secondary compact" disabled={busy} onClick={() => setConfirming(null)}>取消</button><button type="button" className="button primary compact" disabled={busy} onClick={() => void undo(item.id)}>确认撤销</button></div> : <button type="button" className="button secondary compact icon-text" disabled={busy} onClick={() => setConfirming(item.id)}><Undo2 size={14} />撤销</button>}
      </article>)}</div>
    </Modal> : null}
  </>;
}
