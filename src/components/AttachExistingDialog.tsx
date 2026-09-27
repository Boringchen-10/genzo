import { useState } from "react";
import type { MediaFile, WorkListItem } from "../types";
import { workCategoryLabel } from "../utils";
import { Modal } from "./common";
import { RecognitionFileSelection } from "./RecognitionFileSelection";

export function AttachExistingDialog({ files, works, busy, onClose, onConfirm }: {
  files: MediaFile[]; works: WorkListItem[]; busy: boolean; onClose: () => void;
  onConfirm: (workId: string, ids: string[]) => void;
}) {
  const [selected, setSelected] = useState(files.map(file => file.id));
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<WorkListItem | null>(null);
  return <Modal title="关联已有作品" width="large" onClose={() => { if (!busy) onClose(); }} footer={target ? <div className="form-actions"><span>《{target.title}》 · {selected.length} 个文件</span><button type="button" className="button secondary" disabled={busy} onClick={() => setTarget(null)}>重新选择作品</button><button type="button" className="button primary" disabled={busy || !selected.length} onClick={() => onConfirm(target.id, selected)}>{busy ? "正在关联…" : "确认关联"}</button></div> : undefined}>
    <p className="quiet-inline">先核对文件范围，再选择媒体库里的作品。不同季度或特别篇可分别关联，未勾选的文件仍留在待整理。</p>
    <RecognitionFileSelection files={files} selected={selected} disabled={busy} onChange={setSelected} />
    <div className="search-box modal-search"><input value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="搜索媒体库中的作品" /></div>
    <div className="attach-list">{works.filter(work => `${work.title} ${work.originalTitle ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())).map(work => <div className="attach-row" key={work.id}><div><strong>{work.title}</strong><small>{work.originalTitle}</small></div><span>{workCategoryLabel(work)}</span><button type="button" className="button secondary compact" disabled={busy || !selected.length} onClick={() => setTarget(work)}>{target?.id === work.id ? "已选择" : "选择此作品"}</button></div>)}</div>
    {!works.length ? <p className="quiet-inline">媒体库暂无作品，请先手动创建作品。</p> : null}
  </Modal>;
}
