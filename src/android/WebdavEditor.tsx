import { useEffect, useState } from "react";
import { ArrowLeft, Check, Eye, EyeOff, Folder, LoaderCircle, RefreshCw } from "lucide-react";
import { remoteApi } from "../api";
import type { RemoteEntry, WebdavConnection } from "../types";

export default function WebdavEditor({ sourceId, onSaved, onBusyChange }: { sourceId?: string; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [input, setInput] = useState<WebdavConnection>({ name: "", endpoint: "", directory: "", username: "", password: "", kind: "video" });
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [stack, setStack] = useState<string[]>([]);
  const [tested, setTested] = useState(false);
  const [loading, setLoading] = useState(!!sourceId);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    void remoteApi.listSources().then(sources => {
      const source = sources.find(item => item.id === sourceId);
      if (!source) throw new Error("WebDAV 来源不存在");
      if (active) setInput(previous => ({ ...previous, name: source.name, endpoint: source.endpoint, directory: source.directory }));
    }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceId]);
  function change(key: "name" | "endpoint" | "username" | "password", value: string) {
    setInput(previous => ({ ...previous, [key]: value, ...(!sourceId && key !== "name" ? { directory: "" } : {}) }));
    if (key !== "name") { setTested(false); setEntries([]); setStack([]); }
    setError("");
  }
  async function browse(directory: string, parents: string[]) {
    setBusy(true); setError(""); setTested(false);
    try {
      const result = await remoteApi.browse({ ...input, directory });
      setEntries(result); setInput(previous => ({ ...previous, directory })); setStack(parents); setTested(true);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!tested) return;
    setBusy(true); setError("");
    try {
      if (sourceId) await remoteApi.credentials(sourceId, input.username, input.password);
      else await remoteApi.add(input);
      await onSaved();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    {error && <p className="gz-error" role="alert">{error}</p>}
    <fieldset disabled={busy || loading} className="gz-form-fields">
      <label>来源名称<input required maxLength={128} value={input.name} readOnly={!!sourceId} onChange={event => change("name", event.target.value)} /></label>
      <label>WebDAV 地址<input required type="url" value={input.endpoint} readOnly={!!sourceId} placeholder="https://example.com/dav/" onChange={event => change("endpoint", event.target.value)} /></label>
      <label>用户名<input autoComplete="off" value={input.username} onChange={event => change("username", event.target.value)} /></label>
      <label>密码<div className="gz-input-action"><input autoComplete="off" type={visible ? "text" : "password"} value={input.password} onChange={event => change("password", event.target.value)} /><button type="button" className="gz-iconbtn" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
      <button type="button" className="gz-btn" disabled={!input.endpoint.trim()} onClick={() => void browse(sourceId ? input.directory : "", [])}>{busy ? <LoaderCircle size={16} /> : <RefreshCw size={16} />}测试连接</button>
      {tested && <section aria-label="WebDAV 目录">
        <p className="gz-file-name">{input.directory || "/"}</p>
        {!sourceId && stack.length > 0 && <button type="button" className="gz-btn" onClick={() => void browse(stack.at(-1)!, stack.slice(0, -1))}><ArrowLeft size={16} />上一级</button>}
        {!sourceId && entries.filter(entry => entry.directory).map(entry => <button type="button" className="gz-row-card" key={entry.href} onClick={() => void browse([...input.directory.split("/").filter(Boolean), entry.name].join("/"), [...stack, input.directory])}><Folder size={18} /><span className="gz-row-main">{entry.name}</span></button>)}
        <p className="gz-meta">连接成功 · {entries.filter(entry => !entry.directory).length} 个文件</p>
      </section>}
      <button className="gz-btn primary" type="submit" disabled={!tested || !input.name.trim()}><Check size={18} />{sourceId ? "保存凭据" : "添加所选目录"}</button>
    </fieldset>
  </form>;
}
