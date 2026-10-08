import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { personalSync, type Conflict, type SyncStatus } from "../personalSync";
import { dataProvider } from "../data";
import type { MediaFile, WorkListItem } from "../types";
import { getErrorMessage } from "../utils";
import "./personal-sync.css";
import { PortableDataPanel } from "./PortableDataPanel";

export function PersonalSyncPanel({ initialDeviceName = "我的电脑", onStatusChange }: {initialDeviceName?: string; onStatusChange?: (status: SyncStatus) => void} = {}) {
  const desktop = isTauri();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(initialDeviceName);
  const [loopback, setLoopback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [media, setMedia] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    const value = await personalSync.status();
    setStatus(value);
    onStatusChange?.(value);
    if (value.connected) setConflicts(await personalSync.conflicts());
  }, [onStatusChange]);
  useEffect(() => {
    if (!desktop) return;
    let stopped = false;
    void refresh().catch(e => setError(getErrorMessage(e)));
    let dispose: (() => void) | undefined;
    void listen<SyncStatus>("sync-status", event => {
      if (!stopped) { setStatus(event.payload); onStatusChange?.(event.payload); if (!event.payload.running && event.payload.connected) void refresh().catch(e => setError(getErrorMessage(e))); }
    }).then(fn => { if (stopped) fn(); else dispose = fn; }).catch(() => {});
    return () => { stopped = true; dispose?.(); };
  }, [desktop, refresh]);
  useEffect(() => {
    if (status?.connected) void dataProvider.listWorks().then(list => setWorks(list.filter(w => w.type === "video"))).catch(e => setError(getErrorMessage(e)));
  }, [status?.connected]);
  const action = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); await refresh(); setMessage(success); }
    catch (e) { setError(getErrorMessage(e)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const input = { endpoint, username, password, deviceName, allowLoopbackHttp: loopback };
  const blocked = busy || status?.running;
  if (!desktop) return <section className="personal-sync-panel" aria-label="个人同步验证"><h2>个人同步 · 第一版</h2><p>浏览器预览无法连接本机数据库或安全凭据。请在 Genzo 应用内使用 WebDAV 同步。</p></section>;
  return <section className="personal-sync-panel" aria-label="个人同步验证">
    <h2>个人同步 · 第一版</h2>
    <PortableDataPanel connected={status?.connected} />
    <p className="quiet-inline">同步动漫、电影、电视剧的资料与个人记录。媒体文件、路径和密码保存在各设备。此处为功能验证入口。</p>
    {error ? <p role="alert" className="sync-error">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {status ? <div className="sync-status" aria-live="polite">
      <strong>{status.running ? "正在同步…" : !status.connected ? "尚未连接" : status.errorCode ? "需要重试" : status.enabled ? "自动同步已启用" : "自动同步已暂停"}</strong>
      <span>待上传 {status.pending} · 冲突 {status.conflicts}</span>
      <span>最近成功：{status.lastSuccess ? new Date(status.lastSuccess).toLocaleString() : "尚未完成"}</span>
      {status.message ? <p>{status.message}</p> : null}
    </div> : <p>正在读取同步状态…</p>}
    {!status?.connected ? <>
      <label className="field">专用 WebDAV 同步目录<input type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://sync.example.com/genzo/" autoComplete="off" /></label>
      <label className="field">账号<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label>
      <label className="field">密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label>
      <label className="field">设备名称<input value={deviceName} onChange={e => setDeviceName(e.target.value)} maxLength={80} /></label>
      <label className="sync-check"><input type="checkbox" checked={loopback} onChange={e => setLoopback(e.target.checked)} />仅用于本机隔离服务的 HTTP 测试</label>
      <div className="sync-actions">
        <button type="button" className="button secondary" disabled={blocked || !endpoint} onClick={() => void action(() => personalSync.test(input), "认证、读写和条件写入测试通过；尚未连接资料库")}>测试连接</button>
        <button type="button" className="button secondary" disabled={blocked || !endpoint} onClick={() => void action(async () => { await personalSync.connect(input,"join"); setPassword(""); }, "已读取并合并同步资料")}>加入已有空间</button>
        <button type="button" className="button primary" disabled={blocked || !endpoint} onClick={() => void action(async () => { await personalSync.connect(input,"create"); setPassword(""); }, "同步空间已准备并完成同步")}>创建同步空间</button>
      </div>
    </> : <>
      <p className="sync-address">{status.endpoint}</p>
      <div className="sync-actions"><button className="button primary" disabled={blocked} onClick={() => void action(() => personalSync.now(), "同步完成")}>立即同步 / 重试</button><button className="button secondary" disabled={blocked} onClick={() => void action(() => personalSync.enabled(!status.enabled), status.enabled ? "已暂停，待上传记录保留" : "已启用自动同步")}>{status.enabled ? "暂停自动同步" : "启用自动同步"}</button></div>
      <details><summary>更新连接凭据</summary><label className="field">账号<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label><label className="field">新密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label><button className="button secondary" disabled={blocked} onClick={() => void action(async () => { await personalSync.credentials(username,password); setPassword(""); }, "凭据已保存至本机安全存储")}>保存凭据</button></details>
      <details><summary>确认视频版本以跨设备续播</summary><p className="quiet-inline">两端对同一分集的文件分别校验。不同剪辑不会套用进度；长视频校验可能需要等待。WebDAV 正文不在此处下载。</p><label className="field">作品<select defaultValue="" onChange={e => { setMedia(""); setFiles([]); if (e.target.value) void dataProvider.getWork(e.target.value).then(w => setFiles(w.mediaFiles.filter(f => f.mediaType === "video" && !f.missing && !f.path.startsWith("webdav://")))).catch(err => setError(getErrorMessage(err))); }}><option value="">选择影视作品</option>{works.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label><label className="field">文件<select value={media} onChange={e => setMedia(e.target.value)}><option value="">选择已关联分集的文件</option>{files.map(f => <option key={f.id} value={f.id}>{f.fileName}</option>)}</select></label><button className="button secondary" disabled={blocked || !media} onClick={() => void action(() => personalSync.bindMedia(media), "视频版本已确认；后续有效播放采样将携带版本信息")}>校验并绑定版本</button></details>
    </>}
    {conflicts.map(conflict => {
      const key = `${conflict.entity}:${conflict.field}`;
      return <article className="sync-conflict" key={key}><h3>{conflict.field === "notes" ? "笔记有两端修改" : `字段冲突：${conflict.field}`}</h3>{conflict.candidates.map(candidate => <div key={candidate.id}><small>{candidate.deviceId.slice(0,8)} · {new Date(candidate.observedAt).toLocaleString()}</small><pre>{typeof candidate.value === "string" ? candidate.value : JSON.stringify(candidate.value,null,2)}</pre><button className="button secondary" disabled={blocked} onClick={() => void action(() => personalSync.resolve(conflict.entity,conflict.field,candidate.value), "已保留选择，等待同步")}>使用这份内容</button></div>)}{conflict.field === "notes" ? <><label className="field">合并后的笔记<textarea value={drafts[key] ?? ""} rows={5} onChange={e => setDrafts(old => ({...old,[key]:e.target.value}))} /></label><button className="button primary" disabled={blocked || drafts[key] === undefined} onClick={() => void action(() => personalSync.resolve(conflict.entity,"notes",drafts[key]), "合并笔记已保存，等待同步")}>保存合并内容</button></> : null}</article>;
    })}
  </section>;
}
