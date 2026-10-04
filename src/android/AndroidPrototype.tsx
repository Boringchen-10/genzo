import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./prototype.css";

export default function AndroidPrototype() {
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nativeResult, setNativeResult] = useState<unknown>(null);
  const [videoUri, setVideoUri] = useState("");
  async function native(command: string, payload: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      const response = await invoke<{ uri?: string }>("android_native", { command, payload });
      setNativeResult(response);
      if (command === "pickVideo" && response.uri) setVideoUri(response.uri);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function probe(write: boolean) {
    setBusy(true);
    setError("");
    try { setResult(await invoke("android_probe", { write })); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void probe(false); }, []);
  return <main className="android-prototype">
    <h1>Genzo 安卓验证原型</h1>
    <p>Windows v0.5.0 基线 · 当前为能力验证页，正式页面按 OpenDesign 规范接入</p>
    <h2>数据库与持久化</h2>
    <button disabled={busy} onClick={() => void probe(true)}>写入验证标记</button>
    <button disabled={busy} onClick={() => void probe(false)}>读取验证标记</button>
    {error && <p role="alert">{error}</p>}
    <pre data-testid="probe-result">{JSON.stringify(result, null, 2)}</pre>
    <h2>目录授权与文件枚举</h2>
    <button disabled={busy} onClick={() => void native("pickTree")}>授权视频目录</button>
    <button disabled={busy} onClick={() => void native("listTree")}>读取已授权目录</button>
    <h2>原生播放器验证</h2>
    <button disabled={busy} onClick={() => void native("pickVideo")}>选择视频文件</button>
    <input aria-label="播放 URI" value={videoUri} onChange={(event) => setVideoUri(event.target.value)} placeholder="content:// 或测试流地址" />
    <button disabled={busy || !videoUri} onClick={() => void native("openPlayer", { uri: videoUri, restart: false })}>播放 / 续播</button>
    <button disabled={busy || !videoUri} onClick={() => void native("openPlayer", { uri: videoUri, restart: true })}>从头播放</button>
    <button disabled={busy} onClick={() => void native("playerState")}>读取播放状态</button>
    <p>播放器使用原生独立视图。系统返回后可查看内核状态；进度目前为原型验证记录，媒体 ID 关联在索引阶段接入。</p>
    <pre data-testid="native-result">{JSON.stringify(nativeResult, null, 2)}</pre>
  </main>;
}
