import { useMemo, useState } from "react";
import { ChevronRight, FolderTree } from "lucide-react";
import type { LibraryRoot, MediaFile } from "../types";
import { normalizePath, pathBaseName, pathChildSegment, pathDirName } from "../mediaPaths";
import { formatSize, mediaLabels } from "../utils";

export function MediaFileBrowser({ files, roots, busy, onAttach }: {
  files: MediaFile[]; roots: LibraryRoot[]; busy: boolean; onAttach: (ids: string[]) => Promise<void>;
}) {
  const [trail, setTrail] = useState<{ path: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const path = trail.at(-1)?.path ?? null;
  const rows = useMemo(() => {
    const matching = files.filter(file => !search.trim() || `${file.fileName} ${file.path}`.toLowerCase().includes(search.trim().toLowerCase()));
    const folders = new Map<string, { path: string; name: string; files: MediaFile[] }>();
    const visible: MediaFile[] = [];
    for (const file of matching) {
      if (path !== null && pathDirName(file.path) === path) { visible.push(file); continue; }
      const root = roots.find(root => root.id === file.libraryRootId && pathChildSegment(root.path, file.path) !== null);
      const segment = path === null ? null : pathChildSegment(path, file.path);
      if (path !== null && !segment) continue;
      const folder = path === null ? normalizePath(root?.path ?? pathDirName(file.path)) : `${path}${path.startsWith("webdav://") ? "/" : "\\"}${segment}`;
      const name = path === null ? root?.displayName || pathBaseName(root?.path ?? pathDirName(file.path)) : segment!;
      const entry = folders.get(folder) ?? { path: folder, name, files: [] };
      entry.files.push(file); folders.set(folder, entry);
    }
    return { folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })), files: visible.sort((a, b) => a.fileName.localeCompare(b.fileName, "zh-CN", { numeric: true })) };
  }, [files, roots, path, search]);
  const ids = files.filter(file => selected.has(file.id)).map(file => file.id);
  const toggle = (items: MediaFile[], checked: boolean) => setSelected(previous => {
    const next = new Set(previous); items.forEach(file => checked ? next.add(file.id) : next.delete(file.id)); return next;
  });
  return <div className="media-file-browser">
    <div className="search-box modal-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索文件或目录" /></div>
    <nav className="inbox-crumbs" aria-label="关联文件夹路径"><button type="button" onClick={() => setTrail([])}>媒体源</button>{trail.map((item, index) => <span key={item.path}><ChevronRight size={13} /><button type="button" onClick={() => setTrail(trail.slice(0, index + 1))}>{item.name}</button></span>)}</nav>
    <div className="attach-list">
      {rows.folders.map(folder => <div className="media-picker-row" key={folder.path}>
        <input type="checkbox" aria-label={`选择目录 ${folder.name}`} checked={folder.files.every(file => selected.has(file.id))} disabled={busy} onChange={event => toggle(folder.files, event.target.checked)} />
        <button type="button" className="media-picker-folder" onClick={() => setTrail([...trail, { path: folder.path, name: folder.name }])}><FolderTree size={18} /><strong>{folder.name}</strong><small>{folder.files.length} 个文件</small><ChevronRight size={16} /></button>
      </div>)}
      {rows.files.map(file => <label className="media-picker-row" key={file.id}>
        <input type="checkbox" aria-label={`选择文件 ${file.fileName}`} checked={selected.has(file.id)} disabled={busy} onChange={event => toggle([file], event.target.checked)} />
        <span className="media-picker-copy"><strong>{file.fileName}</strong><small>{mediaLabels[file.mediaType]} · {formatSize(file.size)}{file.missing ? " · 路径已失效" : ""}</small></span>
      </label>)}
      {!rows.folders.length && !rows.files.length ? <p className="quiet-inline">没有可关联的文件，请调整搜索或返回上级目录。</p> : null}
    </div>
    <div className="media-picker-footer"><span>已选 {ids.length} 个文件（目录勾选包含子目录）</span><button type="button" className="button primary" disabled={busy || !ids.length} onClick={() => void onAttach(ids).then(() => setSelected(new Set())).catch(() => { /* Parent reports the error; preserve selection for retry. */ })}>{busy ? "关联中…" : "关联所选文件"}</button></div>
  </div>;
}
