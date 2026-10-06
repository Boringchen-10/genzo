import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { defaultReadingNetwork, readingNetworkApi, readingRoutes, type NodeProbe, type ReadingNetwork } from "../readingNetwork";
import { getErrorMessage } from "../utils";
import { ErrorState, LoadingState } from "./common";
import "../reading-network.css";

export function ReadingNetworkPanel() {
  const [config, setConfig] = useState<ReadingNetwork | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [probes, setProbes] = useState<NodeProbe[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (isTauri()) void readingNetworkApi.get().then(value => { if (!cancelled) setConfig(value); })
      .catch(reason => { if (!cancelled) setError(getErrorMessage(reason)); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (!isTauri()) return <p className="quiet-inline">请通过 pnpm dev:desktop 启动 Genzo 桌面应用后配置阅读网络。</p>;
  if (!config) return error ? <ErrorState message={error} retry={() => { setError(""); setAttempt(v => v + 1); }} /> : <LoadingState label="正在读取阅读网络设置" />;
  const change = <K extends keyof ReadingNetwork>(key: K, value: ReadingNetwork[K]) => { setConfig({ ...config, [key]: value }); setNotice(""); setProbes([]); };
  const action = async (operation: "save" | "fill" | "test") => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (operation === "save") { await readingNetworkApi.save(config); setNotice("阅读网络已保存，下次请求生效；正在获取的章卷继续使用原设置。"); }
      if (operation === "fill") { setConfig(await readingNetworkApi.fill(config)); setProbes([]); setNotice("已从来源读取 API 和请求版本，点击保存后生效。"); }
      if (operation === "test") { setProbes(await readingNetworkApi.test(config)); setNotice("测速使用当前表单的代理设置，显示实际 API 请求耗时；点击节点选择后保存。"); }
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <section className="reading-network-panel" aria-label="阅读网络设置">
    <p className="quiet-inline">用于漫画、轻小说的目录与正文。系统代理、线路与并发仅保存在这台设备。</p>
    <fieldset disabled={busy}>
      <div className="setting"><label htmlFor="readingProxy">代理设置</label>
        <select id="readingProxy" value={config.proxyMode} onChange={e => change("proxyMode", e.target.value as ReadingNetwork["proxyMode"])}>
          <option value="system">系统代理</option><option value="direct">直连</option><option value="manual">手动 HTTP / HTTPS 代理</option>
        </select>
        {config.proxyMode === "manual" && <input aria-label="阅读代理地址" placeholder="http://127.0.0.1:7890" value={config.proxyUrl} onChange={e => change("proxyUrl", e.target.value)} />}
        <small>系统模式使用 Windows 固定代理或代理环境变量；PAC 自动配置可填写手动代理地址。</small>
      </div>
      <div className="setting"><label htmlFor="readingRoute">线路与节点</label>
        <select id="readingRoute" value={config.route} onChange={e => setConfig({ ...config, route: Number(e.target.value), node: "" })}>
          <option value={0}>线路 1</option><option value={1}>线路 2</option>
        </select>
        <select aria-label="阅读节点" value={config.node} onChange={e => change("node", e.target.value)}>
          <option value="">线路内失败自动切换</option>{readingRoutes[config.route]?.map(host => <option key={host} value={host}>{host}</option>)}
        </select>
        <button className="button secondary" type="button" onClick={() => void action("test")}>测速全部节点</button>
        {!!probes.length && <div className="reading-node-results">{probes.map(p => <button key={p.host} type="button" disabled={p.route === null || p.milliseconds === null} title={p.error ?? "选择此节点，保存后生效"}
          className={config.node === p.host ? "selected" : ""} onClick={() => { setConfig({ ...config, route: p.route!, node: p.host }); setNotice("已选择节点，点击保存后生效。"); }}>
          <span>{p.route === null ? "COPY API" : `线路 ${p.route + 1}`} · {p.host}</span><strong>{p.milliseconds === null ? "连接失败" : `${p.milliseconds} ms`}</strong>
        </button>)}</div>}
      </div>
      <div className="setting"><label htmlFor="readingApi">COPY API 域名</label><input id="readingApi" value={config.apiHost} maxLength={80} onChange={e => change("apiHost", e.target.value.trim())} />
        <label htmlFor="readingVersion">COPY 请求版本</label><input id="readingVersion" value={config.appVersion} maxLength={30} onChange={e => change("appVersion", e.target.value.trim())} />
        <label className="switch-field"><input type="checkbox" checked={config.autoUpdate} onChange={e => change("autoUpdate", e.target.checked)} /><span className="switch" /><span>每天自动检查 API / 请求版本</span></label>
        <small>启动时距上次检查超过 24 小时才更新；失败保留原值。上次成功：{config.updatedAt ? new Date(config.updatedAt).toLocaleString("zh-CN") : "尚未更新"}</small>
        <div className="reading-network-actions"><button className="button secondary" type="button" onClick={() => void action("fill")}>从来源填充</button>
          <button className="button secondary" type="button" onClick={() => { setConfig({ ...defaultReadingNetwork }); setProbes([]); setNotice("已恢复默认值，点击保存后生效。"); }}>重置</button></div>
      </div>
      <div className="setting"><label htmlFor="comicConcurrency">漫画图片并发：{config.comicConcurrency}</label><input id="comicConcurrency" type="range" min={1} max={8} value={config.comicConcurrency} onChange={e => change("comicConcurrency", Number(e.target.value))} />
        <label htmlFor="novelConcurrency">小说插图并发：{config.novelConcurrency}</label><input id="novelConcurrency" type="range" min={1} max={4} value={config.novelConcurrency} onChange={e => change("novelConcurrency", Number(e.target.value))} />
        <small>最多同时获取两章卷。较低并发可减少来源限流；正文顺序保持不变。</small>
      </div>
      <button className="button primary" type="button" onClick={() => void action("save")}>保存阅读网络</button>
    </fieldset>
    {busy && <p role="status" className="quiet-inline">正在处理…</p>}
    {error && <p role="alert" className="reading-network-error">{error}</p>}
    {notice && <p role="status" className="quiet-inline">{notice}</p>}
  </section>;
}
