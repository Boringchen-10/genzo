import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Trash2 } from "lucide-react";
import { api } from "../api";
import type { MetadataProviderStatus } from "../types";

export default function MetadataSettings() {
  const [providers, setProviders] = useState<MetadataProviderStatus[]>([]);
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void api.metadataProviderStatuses().then(value => { if (active) setProviders(value); })
      .catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function save(value: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api.setSetting("metadata.tmdb_read_token", value);
      setToken(""); setVisible(false);
      setProviders(await api.metadataProviderStatuses());
      setMessage(value ? "TMDB 配置已保存" : "TMDB 配置已清除");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(token.trim()); }}>
    {error && <p className="gz-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {providers.map(provider => <div className="gz-correction-row" key={provider.key}><strong>{provider.label}</strong><p className="gz-meta">{provider.requiresCredential ? provider.configured ? "已配置" : "未配置" : provider.available ? "可用" : "暂不可用"}</p>{provider.message && <p className="gz-meta">{provider.message}</p>}</div>)}
    <fieldset className="gz-form-fields" disabled={busy}>
      <label>TMDB API Read Access Token<div className="gz-input-action"><input autoComplete="off" type={visible ? "text" : "password"} maxLength={512} value={token} onChange={event => setToken(event.target.value)} /><button type="button" className="gz-iconbtn" aria-label={visible ? "隐藏 Token" : "显示 Token"} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
      <div className="gz-actions"><button className="gz-btn primary" disabled={!token.trim()} type="submit"><Check size={18} />保存 Token</button><button className="gz-btn" type="button" onClick={() => void save("")}><Trash2 size={18} />清除 Token</button></div>
    </fieldset>
  </form>;
}
