import { useCallback, useEffect, useState } from "react";
import { Cloud, FolderOpen, RefreshCw } from "lucide-react";
import { remoteApi } from "../api";
import { dataProvider as api, isTauriRuntime } from "../data";
import { useToasts } from "../store";
import { formatSize as formatBytes, getErrorMessage, rootKindLabels } from "../utils";
import type { LibraryRoot, RemoteSource, RemoteEntry, RemoteCacheEntry, WebdavConnection, RootKind } from "../types";
import { Modal } from "./common";
import "../remote-storage.css";

const initial: WebdavConnection = { name: "", endpoint: "", directory: "", username: "", password: "", kind: "video" };

export function RemoteStoragePanel() {
  const toast = useToasts(s => s.push);
  const [sources, setSources] = useState<RemoteSource[]>([]);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [cache, setCache] = useState<RemoteCacheEntry[]>([]);
  const [limit, setLimit] = useState("20");
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [input, setInput] = useState(initial);
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [browsed, setBrowsed] = useState(false);
  const [busy, setBusy] = useState("");
  const [scanStatus, setScanStatus] = useState<Record<string,string>>({});
  const [editing, setEditing] = useState<RemoteSource | null>(null);
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const enabled = isTauriRuntime();
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const [s, r, c] = await Promise.all([remoteApi.listSources(), api.listRoots(), remoteApi.cache()]);
      setSources(s); setRoots(r); setCache(c); setError("");
    } catch (e) { setError(getErrorMessage(e)); }
  }, [enabled]);
  useEffect(() => { void load(); if (enabled) void api.getSetting("storage.cache_limit_gib").then(v => setLimit(v ?? "20")).catch(e => setError(getErrorMessage(e))); }, [load, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => { void remoteApi.cache().then(setCache).catch(() => {}); }, 1500);
    return () => window.clearInterval(timer);
  }, [enabled]);
  const perform = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError("");
    try { await action(); await load(); } catch (e) { setError(getErrorMessage(e)); } finally { setBusy(""); }
  };
  const browse = async (directory = input.directory) => {
    setBusy("browse"); setError(""); setBrowsed(false);
    try { const rows = await remoteApi.browse({ ...input, directory }); setInput(v => ({ ...v, directory })); setEntries(rows); setBrowsed(true); }
    catch (e) { setError(getErrorMessage(e)); } finally { setBusy(""); }
  };
  const field = (key: keyof WebdavConnection, value: string) => { setInput(v => ({ ...v, [key]: value })); setBrowsed(false); setEntries([]); };
  return <section className="content-section remote-storage">
    <div className="section-heading"><div><h2><Cloud size={19} /> WebDAV 与离线缓存</h2><span>直接连接 Alist、NAS 或其他 WebDAV 服务。</span></div><button className="button secondary" disabled={!enabled || !!busy} onClick={() => { setInput(initial); setEntries([]); setBrowsed(false); setShow(true); }}>添加 WebDAV</button></div>
    {!enabled && <p className="field-hint">请在 Genzo 桌面应用中配置连接。浏览器预览不会连接服务器。</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="remote-source-list">{sources.map(source => {
      const root = roots.find(r => r.id === source.id);
      return <article className="remote-source" key={source.id}>
        <div className="remote-source-info"><strong>{source.name}</strong><span title={source.endpoint}>{source.endpoint} · /{source.directory}</span><span>{root?.availability === "online" ? "上次连接成功" : root?.availability === "unavailable" ? "连接不可用，已保留媒体库" : "尚未连接"} · {root?.enabled ? "已启用" : "已停用"}</span>{scanStatus[source.id] && <span role="status">{scanStatus[source.id]}</span>}</div>
        <div className="remote-actions"><button className="button secondary compact" disabled={!!busy || !root?.enabled} onClick={() => void perform(source.id, async () => { const result = await api.scanRoot(source.id); setScanStatus(v => ({ ...v, [source.id]: result.errors.length ? result.errors.join("；") : `扫描完成：发现 ${result.discoveredCount}，新增 ${result.addedCount}，缺失 ${result.missingCount}` })); })}><RefreshCw size={14} className={busy === source.id ? "spin" : ""} />{busy === source.id ? "扫描中…" : "扫描 / 重连"}</button><button className="button secondary compact" disabled={!!busy} onClick={() => { setCredentials({ username: "", password: "" }); setEditing(source); }}>更新凭据</button><button className="button ghost compact" disabled={!!busy || !root} onClick={() => void perform(source.id, () => api.updateRoot(source.id, root!.kind, !root!.enabled))}>{root?.enabled ? "停用" : "启用"}</button></div>
      </article>;
    })}</div>
    {enabled && !sources.length && <p className="field-hint">添加连接后选择目录并扫描，文件会进入媒体库的“待整理”。</p>}
    <div className="remote-cache-heading"><h3>离线缓存</h3><label>容量上限（GiB） <input aria-label="缓存容量上限 GiB" type="number" min="1" max="1024" value={limit} onChange={e => setLimit(e.target.value)} /></label><button className="button secondary compact" disabled={!enabled || !!busy} onClick={() => void perform("limit", async () => { await remoteApi.setLimit(Number(limit)); toast("缓存上限已保存", "success"); })}>保存上限</button><span>已用 {formatBytes(cache.reduce((sum, c) => sum + c.size, 0))}</span></div>
    <p className="field-hint">空间不足时自动清理最久未使用的临时缓存；“保留离线”的下载不会自动清理。播放器使用中的缓存暂不清理。网络中断后可重试，服务支持时继续下载。</p>
    <div className="remote-cache-list">{cache.map(c => <div className="remote-cache-row" key={c.mediaFileId}><div><strong title={c.fileName}>{c.fileName}</strong><span>{formatBytes(c.size)} · {c.completed ? c.pinned ? "已下载 · 保留离线" : "已缓存" : "传输中或未完成"}</span></div><div className="remote-actions">{!c.completed && <button className="button secondary compact" disabled={!!busy} onClick={() => void perform(c.mediaFileId, () => remoteApi.download(c.mediaFileId, c.pinned))}>继续 / 重试</button>}{c.completed && <button className="button secondary compact" onClick={() => void perform(c.mediaFileId, () => api.openMediaDirectory(c.mediaFileId))}>打开目录</button>}<button className="button ghost compact" disabled={!!busy} onClick={() => void perform(c.mediaFileId, () => remoteApi.removeCache(c.mediaFileId))}>清理缓存</button></div></div>)}</div>
    {show && <Modal title="添加 WebDAV 来源" width="small" onClose={() => { if (!busy) { setShow(false); setInput(initial); } }}><div className="form-grid remote-form">
      <label className="field span-2"><span>名称</span><input value={input.name} onChange={e => field("name", e.target.value)} placeholder="我的媒体盘" /></label>
      <label className="field span-2"><span>WebDAV 服务地址</span><input value={input.endpoint} onChange={e => field("endpoint", e.target.value)} placeholder="https://example.com/dav/" /></label>
      <label className="field"><span>用户名</span><input autoComplete="off" value={input.username} onChange={e => field("username", e.target.value)} /></label>
      <label className="field"><span>密码 / 应用密码</span><input type="password" autoComplete="new-password" value={input.password} onChange={e => field("password", e.target.value)} /></label>
      <label className="field span-2"><span>扫描目录（相对于服务地址）</span><input value={input.directory} onChange={e => field("directory", e.target.value)} placeholder="动漫/" /></label>
      <div className="remote-actions span-2"><button className="button secondary" disabled={!!busy || !input.endpoint} onClick={() => void browse()}>{busy === "browse" ? "连接中…" : "测试连接并浏览"}</button><button className="button ghost" disabled={!!busy || !input.directory} onClick={() => void browse(input.directory.split("/").filter(Boolean).slice(0, -1).join("/"))}>上一级</button></div>
      {browsed && <div className="remote-browser span-2"><p role="status">连接成功 · 当前目录 {entries.length} 项</p>{entries.filter(e => e.directory).map(e => <button key={e.href} disabled={!!busy} onClick={() => void browse([input.directory, e.name].filter(Boolean).join("/"))}><FolderOpen size={16} />{e.name}</button>)}{!entries.some(e => e.directory) && <span>没有子目录，可直接选择当前目录。</span>}</div>}
      <label className="field span-2"><span>媒体类型</span><select value={input.kind} onChange={e => setInput(v => ({ ...v, kind: e.target.value as RootKind }))}>{Object.entries(rootKindLabels).filter(([key]) => key !== "game").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <p className="field-hint span-2">凭据保存在 Windows 凭据管理器。建议使用 HTTPS；HTTP 适用于可信的本机或局域网服务。</p>
      {error && <p role="alert" className="error-message span-2">{error}</p>}
      <div className="form-actions span-2"><button className="button secondary" disabled={!!busy} onClick={() => { setShow(false); setInput(initial); }}>取消</button><button className="button primary" disabled={!!busy || !input.name || !input.endpoint} onClick={() => void perform("save", async () => { const id = await remoteApi.add(input); setShow(false); setInput(initial); await load(); const result = await api.scanRoot(id); setScanStatus(v => ({ ...v, [id]: result.errors.length ? result.errors.join("；") : `已扫描 ${result.discoveredCount} 个文件` })); })}>{busy === "save" ? "添加并扫描中…" : "选择当前目录并扫描"}</button></div>
    </div></Modal>}
    {editing && <Modal title={`更新 ${editing.name} 的凭据`} width="small" onClose={() => { if (!busy) { setEditing(null); setCredentials({ username: "", password: "" }); } }}><div className="form-grid"><label className="field span-2"><span>用户名</span><input value={credentials.username} onChange={e => setCredentials(v => ({ ...v, username: e.target.value }))} /></label><label className="field span-2"><span>密码</span><input type="password" value={credentials.password} onChange={e => setCredentials(v => ({ ...v, password: e.target.value }))} /></label>{error && <p className="error-message span-2">{error}</p>}<button className="button primary span-2" disabled={!!busy} onClick={() => void perform("credentials", async () => { await remoteApi.credentials(editing.id, credentials.username, credentials.password); setEditing(null); setCredentials({ username: "", password: "" }); toast("凭据已更新", "success"); })}>验证并保存</button></div></Modal>}
  </section>;
}

export function RemoteFileActions({ id, path }: { id: string; path: string }) {
  const toast = useToasts(s => s.push);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [cached, setCached] = useState("");
  useEffect(() => {
    if (!path.startsWith("webdav://") || busy) return;
    let cancelled = false;
    void remoteApi.cache().then(rows => { const row = rows.find(r => r.mediaFileId === id); if (!cancelled) setCached(row?.completed ? row.pinned ? "已下载" : "已缓存" : ""); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, path, busy]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { void remoteApi.cache().then(rows => { const row = rows.find(r => r.mediaFileId === id); if (row) setProgress(formatBytes(row.size)); }).catch(() => {}); }, 1000);
    return () => window.clearInterval(timer);
  }, [busy, id]);
  if (!path.startsWith("webdav://")) return null;
  const download = async (pinned: boolean) => {
    setBusy(true); setProgress("");
    try { await remoteApi.download(id, pinned); toast(pinned ? "已下载并保留离线" : "缓存完成", "success"); }
    catch (e) { toast(getErrorMessage(e), "error"); } finally { setBusy(false); }
  };
  return <span className="remote-file-actions">{busy ? <span role="status">下载中 {progress}</span> : <>{cached && <span>{cached}</span>}<button className="button ghost compact" onClick={() => void download(false)}>缓存</button><button className="button ghost compact" onClick={() => void download(true)}>保留离线</button></>}</span>;
}
