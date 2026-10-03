import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Folder, RefreshCw } from "lucide-react";
import { dataProvider as api } from "../data";
import { normalizePath, pathBaseName, pathDirName } from "../mediaPaths";
import type { LibraryRoot, MediaFile } from "../types";
import { getErrorMessage } from "../utils";
import { bookApi } from "../api";
import type { BookImportGroup } from "../bookData";
import { BookImportPanel } from "./BookImportPanel";
import "../book-inbox.css";

const order = new Intl.Collator("zh-CN", { numeric: true });
const separatorFor = (path: string) => path.startsWith("webdav://") ? "/" : "\\";
const bookFile = (file: MediaFile) => file.mediaType === "comic" || file.mediaType === "novel";
const structuralFolder = /^(?:正文|日文|中文|英文|epub|cbz|zip|第[零〇一二两兩三四五六七八九十百\d]+[卷巻册冊]|\d+(?:\.\d+)?)$/i;

function suggestedTitle(path: string | null, selectedFiles: MediaFile[]): string | undefined {
  if (!selectedFiles.length) return undefined;
  const stems = selectedFiles.map(file => file.fileName.replace(/\.[^.]+$/, "").replace(/\s*[-_]\s*\d{1,3}(?:\.\d+)?$/, "").trim());
  if (stems[0] && stems[0].length > 2 && stems.every(stem => stem === stems[0])) return stems[0];
  const segments = path?.split(/[\\/]+/).reverse() ?? [];
  return segments.find(segment => segment && !structuralFolder.test(segment)) || stems[0];
}

export function BookInbox() {
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [groups, setGroups] = useState<BookImportGroup[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRoots, nextFiles, nextGroups] = await Promise.all([api.listRoots(), api.listUnassignedMedia("bookshelf"), bookApi.importGroups()]);
      setRoots(nextRoots.filter(root => root.destination === "bookshelf"));
      setFiles(nextFiles.filter(bookFile));
      setGroups(nextGroups);
      const valid = new Set(nextFiles.map(file => file.id));
      setSelected(previous => new Set([...previous].filter(id => valid.has(id))));
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rootIds = useMemo(() => new Set(roots.map(root => root.id)), [roots]);
  const readingFiles = useMemo(() => files.filter(file => file.libraryRootId && rootIds.has(file.libraryRootId)), [files, rootIds]);
  const root = path === null ? null : roots.find(item => normalizePath(path) === normalizePath(item.path) || normalizePath(path).startsWith(normalizePath(item.path) + separatorFor(item.path)));
  const breadcrumb = useMemo(() => {
    if (!path || !root) return [];
    const crumbs = [{ name: root.displayName || pathBaseName(root.path), path: root.path }];
    const rest = path.slice(root.path.length).replace(/^[\\/]+/, "");
    let current = root.path;
    for (const segment of rest.split(/[\\/]+/).filter(Boolean)) {
      current = `${current.replace(/[\\/]+$/, "")}${separatorFor(current)}${segment}`;
      crumbs.push({ name: segment, path: current });
    }
    return crumbs;
  }, [path, root]);

  const folders = useMemo(() => {
    if (path === null) return roots.map(item => {
      const members = readingFiles.filter(file => file.libraryRootId === item.id);
      return { path: item.path, name: item.displayName || pathBaseName(item.path), count: members.length, missing: members.filter(file => file.missing).length };
    }).filter(item => item.count > 0).sort((left, right) => order.compare(left.name, right.name));
    const base = normalizePath(path);
    const separator = separatorFor(path);
    const children = new Map<string, { path: string; name: string; count: number; missing: number }>();
    for (const file of readingFiles) {
      const parent = file.path.slice(0, Math.max(file.path.lastIndexOf("\\"), file.path.lastIndexOf("/")));
      const normalizedParent = normalizePath(parent);
      if (!normalizedParent.startsWith(base + separator)) continue;
      const segment = parent.slice(path.length).replace(/^[\\/]+/, "").split(/[\\/]/)[0];
      if (!segment) continue;
      const childPath = `${path.replace(/[\\/]+$/, "")}${separator}${segment}`;
      const key = normalizePath(childPath);
      const item = children.get(key) ?? { path: childPath, name: segment, count: 0, missing: 0 };
      item.count += 1;
      if (file.missing) item.missing += 1;
      children.set(key, item);
    }
    return [...children.values()].sort((left, right) => order.compare(left.name, right.name));
  }, [path, roots, readingFiles]);

  const filesHere = useMemo(() => path === null ? [] : readingFiles
    .filter(file => pathDirName(file.path) === normalizePath(path))
    .sort((left, right) => order.compare(left.fileName, right.fileName)), [path, readingFiles]);
  const needle = search.trim().toLocaleLowerCase("zh-CN");
  const visibleFolders = folders.filter(item => !needle || item.name.toLocaleLowerCase("zh-CN").includes(needle));
  const visibleFiles = filesHere.filter(file => !needle || file.fileName.toLocaleLowerCase("zh-CN").includes(needle));
  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedGroup = selected.size ? groups.find(group => selectedIds.every(id => group.mediaFileIds.includes(id))) : undefined;
  const selectionTitle = selectedGroup?.title ?? suggestedTitle(path, readingFiles.filter(file => selected.has(file.id)));
  const seriesHere = useMemo(() => {
    if (!path) return [];
    const base = normalizePath(path) + separatorFor(path);
    return groups.flatMap(group => {
      if (!group.files.some(file => normalizePath(file.path).startsWith(base))) return [];
      const counts = new Map<string, number>();
      for (const file of group.files) if (file.volumeNumber != null) counts.set(String(file.volumeNumber), (counts.get(String(file.volumeNumber)) ?? 0) + 1);
      const eligible = group.files.filter(file => !file.missing && file.volumeNumber != null && counts.get(String(file.volumeNumber)) === 1);
      if (eligible.length < 2) return [];
      return [{ group, eligible, skipped: group.files.length - eligible.length }];
    }).filter(item => !needle || item.group.title.toLocaleLowerCase("zh-CN").includes(needle));
  }, [path, groups, needle]);

  const toggleFile = (id: string, checked: boolean) => setSelected(previous => {
    const next = new Set(previous);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });
  const selectDirectory = () => {
    if (!path) return;
    const base = normalizePath(path);
    const separator = separatorFor(path);
    setSelected(previous => new Set([...previous, ...readingFiles.filter(file => normalizePath(file.path).startsWith(base + separator)).map(file => file.id)]));
  };

  return <div className="book-inbox">
    <p className="book-inbox-note">同系列且卷号明确的文件可一键选为整套，再在右侧核对归档；重号、缺失和无编号文件保留手动选择。目录末尾也可选中当前目录的所有文件。</p>
    <div className="book-inbox-split">
      <aside className="book-inbox-browser" aria-label="待整理阅读目录">
        <div className="book-inbox-search"><input aria-label="筛选待整理文件" value={search} onChange={event => setSearch(event.target.value)} placeholder="筛选当前目录" /><button type="button" className="button compact secondary" disabled={loading} onClick={() => void load()} aria-label="刷新待整理文件"><RefreshCw size={15} /></button></div>
        <nav className="book-inbox-crumbs" aria-label="待整理文件夹路径">
          <button type="button" onClick={() => setPath(null)} disabled={path === null}>资源库</button>
          {breadcrumb.map((item, index) => <Fragment key={item.path}><ChevronRight size={13} /><button type="button" onClick={() => setPath(item.path)} disabled={index === breadcrumb.length - 1}>{item.name}</button></Fragment>)}
          {path && root ? <button type="button" className="book-inbox-recognize" onClick={selectDirectory}>识别当前目录</button> : null}
        </nav>
        {error ? <p className="gnz-inline-error" role="alert">{error}</p> : null}
        {loading ? <p className="quiet-inline">正在读取待整理文件…</p> : null}
        {!loading ? <div className="book-inbox-list">
          {seriesHere.map(({ group, eligible, skipped }) => <button type="button" className="book-inbox-series" key={group.mediaFileIds[0]} onClick={() => setSelected(new Set(eligible.map(file => file.id)))}><strong>{group.title}</strong><small>{eligible.length} 卷可归档{skipped ? ` · ${skipped} 个文件待核对` : ""}</small><span>归档整套</span></button>)}
          {visibleFolders.map(item => <button type="button" className="book-inbox-folder" key={item.path} onClick={() => setPath(item.path)}><Folder size={17} /><span><strong>{item.name}</strong><small>{item.count} 个文件{item.missing ? ` · ${item.missing} 个缺失` : ""}</small></span><ChevronRight size={15} /></button>)}
          {visibleFiles.map(file => <label className="book-inbox-file" key={file.id} title={file.path}><input type="checkbox" aria-label={`归档 ${file.fileName}`} checked={selected.has(file.id)} onChange={event => toggleFile(file.id, event.target.checked)} /><span><strong>{file.fileName}</strong><small>{file.mediaType === "comic" ? "漫画" : "小说"}{file.missing ? " · 文件缺失" : ""}</small></span></label>)}
          {!visibleFolders.length && !visibleFiles.length ? <p className="quiet-inline">{needle ? "当前目录没有匹配的文件。" : "当前目录没有待整理阅读文件。"}</p> : null}
        </div> : null}
      </aside>
      <div className="book-inbox-panel"><BookImportPanel variant="pane" showGroupList={false} selectedMediaFileIds={selectedIds} onSelectedMediaFileIdsChange={ids => setSelected(new Set(ids))} selectionTitle={selectionTitle} /></div>
    </div>
  </div>;
}
