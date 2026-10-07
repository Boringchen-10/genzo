import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { ReadingKind } from "../bookContent";
import LoadingIndicator from "./LoadingIndicator";

export default function BookReader({ kind, pathWord, entryId, group, onClose }: {
  kind: ReadingKind; pathWord: string; entryId: string; group: string; onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<{ key: string; promise: Promise<unknown> } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    let active = true;
    // StrictMode effect replay shares the same native launch.
    const key = JSON.stringify([kind, pathWord, entryId, group, attempt]);
    if (pending.current?.key !== key) pending.current = { key, promise: invoke("open_internal_reader", { kind, pathWord, entryId, group }) };
    void pending.current.promise.then(() => { if (active) close.current(); })
      .catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [attempt, entryId, group, kind, pathWord]);
  return <div className="gz-reader" role="dialog" aria-modal="true" aria-label="打开原生阅读器">
    <header className="gz-reader-head"><button className="gz-iconbtn" type="button" aria-label="返回章节列表" onClick={onClose}><ArrowLeft size={20} /></button><strong>打开阅读器</strong></header>
    {error ? <div className="gz-reader-empty"><p>{error}</p><button className="gz-btn" type="button" onClick={() => { pending.current = null; setError(""); setAttempt(value => value + 1); }}><RefreshCw size={16} />重试</button></div>
      : <LoadingIndicator label="正在打开原生阅读器…" />}
  </div>;
}
