import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bookApi } from "../api";
import type { BookImportGroup } from "../bookData";
import { getErrorMessage } from "../utils";
import "../book-import.css";

export function BookImportPanel() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<BookImportGroup[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"comic" | "novel">("comic");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!isTauri()) return;
    setLoading(true);
    try { setGroups(await bookApi.importGroups()); setError(""); }
    catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    const group = selected === null ? undefined : groups[selected];
    if (!group) return;
    setLoading(true);
    try {
      const id = await bookApi.createWork(title, kind, group.mediaFileIds);
      navigate(`/library/${id}`);
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  };

  if (!isTauri()) return null;
  return <details className="book-import">
    <summary>从待整理文件建立书架作品</summary>
    <div className="book-import-body">
      <p>按资源目录的首层文件夹列出书架待整理候选；确认标题和类型后才建立作品。不会移动或修改书籍文件。</p>
      <button type="button" className="button compact secondary" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : "刷新待整理读物"}</button>
      {error ? <p className="gnz-inline-error" role="alert">{error}</p> : null}
      {groups.length ? <div className="book-import-grid">
        <div className="book-import-list" role="list" aria-label="待整理读物组">{groups.map((group, index) => <button type="button" key={`${group.mediaType}:${group.folderPath ?? group.mediaFileIds[0]}`} className={selected === index ? "active" : ""} onClick={() => { setSelected(index); setTitle(group.title); setKind(group.mediaType); }}>
          <strong>{group.title}</strong><small>{group.mediaType === "comic" ? "漫画" : "小说"} · {group.mediaFileIds.length} 个文件</small>
        </button>)}</div>
        {selected !== null && groups[selected] ? <div className="book-import-confirm">
          <strong>建立作品</strong>
          <label>作品标题<input aria-label="新书架作品标题" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>类型<select aria-label="新书架作品类型" value={kind} onChange={(event) => setKind(event.target.value as "comic" | "novel")}><option value="comic">漫画／画集</option><option value="novel">小说／轻小说</option></select></label>
          <p>{groups[selected].mediaFileIds.length} 个索引文件将关联到这部作品；PDF 可在这里改选为漫画。</p>
          <button type="button" className="button primary" disabled={loading || !title.trim()} onClick={() => void create()}>确认建立</button>
        </div> : null}
      </div> : <p className="quiet-inline">没有待整理的漫画或小说文件。</p>}
    </div>
  </details>;
}
