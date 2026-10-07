import { useEffect, useMemo, useState } from "react";
import { CircleGauge, Globe, LoaderCircle, RefreshCw, Save, Server, Zap } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { bangumiNetworkApi, BANGUMI_NETWORK_CHANGED, defaultBangumiNetwork, type BangumiNetwork, type BangumiProbe } from "../bangumiNetwork";
import { readingNetworkApi, readingRoutes, type NodeProbe, type ReadingNetwork } from "../readingNetwork";
import LoadingIndicator from "./LoadingIndicator";
import { androidSession, READING_NETWORK_CHANGED } from "./sessionCache";

type Props = { onToast: (message: string) => void };
type LoadState = "loading" | "ready" | "error";

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const KAZUMI_MIRROR_URL = "https://api.bgmapi.com";

export default function NetworkPanel({ onToast }: Props) {
  const [reading, setReading] = useState<ReadingNetwork | null>(null);
  const [bangumi, setBangumi] = useState<BangumiNetwork | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "fill" | "test-reading" | "test-bangumi" | null>(null);
  const [nodeProbes, setNodeProbes] = useState<NodeProbe[]>([]);
  const [bangumiProbes, setBangumiProbes] = useState<BangumiProbe[]>([]);

  useEffect(() => {
    let alive = true;
    if (!isTauri()) {
      setState("error");
      setError("网络设置需要在 Genzo Android 应用中使用。");
      return () => { alive = false; };
    }
    void Promise.all([readingNetworkApi.get(), bangumiNetworkApi.get()]).then(([readingConfig, bangumiConfig]) => {
      if (!alive) return;
      setReading(readingConfig);
      setBangumi(bangumiConfig);
      setState("ready");
    }).catch(reason => {
      if (!alive) return;
      setError(errorMessage(reason));
      setState("error");
    });
    return () => { alive = false; };
  }, []);

  const routeNodes = useMemo(() => reading ? readingRoutes[reading.route] ?? [] : [], [reading]);
  const updateReading = (patch: Partial<ReadingNetwork>) => {
    setReading(value => value ? { ...value, ...patch } : value);
    setNodeProbes([]);
  };
  const updateBangumi = (patch: Partial<BangumiNetwork>) => {
    setBangumi(value => value ? { ...value, ...patch } : value);
    setBangumiProbes([]);
  };

  const fillReading = async () => {
    if (!reading) return;
    setBusy("fill"); setError("");
    try {
      setReading(await readingNetworkApi.fill(reading));
      onToast("COPY 网络信息已更新");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  };

  const testReading = async () => {
    if (!reading) return;
    setBusy("test-reading"); setError("");
    try { setNodeProbes(await readingNetworkApi.test(reading)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  };

  const testBangumi = async () => {
    if (!bangumi) return;
    setBusy("test-bangumi"); setError("");
    try { setBangumiProbes(await bangumiNetworkApi.test(bangumi)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!reading || !bangumi) return;
    setBusy("save"); setError("");
    try {
      await readingNetworkApi.save(reading);
      androidSession.invalidate("reading:");
      window.dispatchEvent(new Event(READING_NETWORK_CHANGED));
      await bangumiNetworkApi.save(bangumi);
      window.dispatchEvent(new Event(BANGUMI_NETWORK_CHANGED));
      onToast("网络配置已保存");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  };

  if (state === "loading") return <LoadingIndicator label="正在读取网络设置…" />;
  if (state === "error" || !reading || !bangumi) return <div className="gz-empty"><Server size={26} /><h2>网络设置不可用</h2><p>{error}</p></div>;

  const disabled = busy !== null;
  const mirrorPreset = bangumi.mirrorUrl === KAZUMI_MIRROR_URL ? "kazumi" : "custom";
  return <div className="gz-network">
    <section className="gz-net-card">
      <div className="gz-net-head"><Globe size={16} /><h2>Bangumi 数据源</h2></div>
      <p className="gz-meta">发现页的热门番组、搜索和放送表会使用这里选择的接口。</p>
      <label className="gz-field"><span>连接方式</span>
        <select value={bangumi.mode} disabled={disabled} onChange={event => updateBangumi({ mode: event.target.value as BangumiNetwork["mode"] })}>
          <option value="system">系统代理 · 官方 API</option>
          <option value="direct">直连 · 官方 API</option>
          <option value="mirror">自定义镜像 · 直连</option>
        </select>
      </label>
      {bangumi.mode === "mirror" && <>
        <label className="gz-field"><span>镜像源</span>
          <select value={mirrorPreset} disabled={disabled} onChange={event => updateBangumi({ mirrorUrl: event.target.value === "kazumi" ? KAZUMI_MIRROR_URL : "" })}>
            <option value="kazumi">Kazumi 兼容镜像</option>
            <option value="custom">自定义镜像</option>
          </select>
        </label>
        {mirrorPreset === "custom" ? <label className="gz-field"><span>镜像根地址</span>
          <input inputMode="url" placeholder="https://mirror.example.com" value={bangumi.mirrorUrl} disabled={disabled} onChange={event => updateBangumi({ mirrorUrl: event.target.value })} />
          <small className="gz-meta">需要兼容 /v0 和 /calendar，远程镜像使用 HTTPS。</small>
        </label> : <p className="gz-meta">https://api.bgmapi.com · 兼容 /v0 和 /calendar</p>}
      </>}
      <div className="gz-net-row">
        <button type="button" className="gz-btn" disabled={disabled} onClick={() => void testBangumi()}>{busy === "test-bangumi" ? <LoaderCircle className="gz-spin" size={16} /> : <Zap size={16} />}测试连接</button>
        <button type="button" className="gz-btn" disabled={disabled} onClick={() => { setBangumi({ ...defaultBangumiNetwork }); setBangumiProbes([]); }}><RefreshCw size={16} />恢复默认</button>
      </div>
      {!!bangumiProbes.length && <div className="gz-probe-list">{bangumiProbes.map(probe => <p key={probe.name} className={probe.error ? "gz-error" : "gz-meta"}>{probe.name}：{probe.error ?? `${probe.milliseconds} ms · 可用`}</p>)}</div>}
    </section>

    <section className="gz-net-card">
      <div className="gz-net-head"><CircleGauge size={16} /><h2>COPY 漫画与轻小说</h2></div>
      <div className="gz-net-row">
        <label className="gz-field"><span>代理模式</span>
          <select value={reading.proxyMode} disabled={disabled} onChange={event => updateReading({ proxyMode: event.target.value as ReadingNetwork["proxyMode"] })}>
            <option value="system">系统代理</option><option value="direct">直连</option><option value="manual">手动 HTTP 代理</option>
          </select>
        </label>
        <label className="gz-field"><span>漫画并发</span><input inputMode="numeric" min="1" max="8" type="number" value={reading.comicConcurrency} disabled={disabled} onChange={event => updateReading({ comicConcurrency: Number(event.target.value) })} /></label>
      </div>
      {reading.proxyMode === "manual" && <label className="gz-field"><span>代理地址</span><input inputMode="url" placeholder="http://127.0.0.1:7890" value={reading.proxyUrl} disabled={disabled} onChange={event => updateReading({ proxyUrl: event.target.value })} /></label>}
      <div className="gz-net-row">
        <label className="gz-field"><span>线路</span><select value={reading.route} disabled={disabled} onChange={event => updateReading({ route: Number(event.target.value), node: "" })}><option value={0}>线路 1</option><option value={1}>线路 2</option></select></label>
        <label className="gz-field"><span>节点</span><select value={reading.node} disabled={disabled} onChange={event => updateReading({ node: event.target.value })}><option value="">自动选择</option>{routeNodes.map(node => <option key={node} value={node}>{node}</option>)}</select></label>
      </div>
      <div className="gz-net-row">
        <label className="gz-field"><span>API 域名</span><input inputMode="url" value={reading.apiHost} disabled={disabled} onChange={event => updateReading({ apiHost: event.target.value })} /></label>
        <label className="gz-field"><span>接口版本</span><input value={reading.appVersion} disabled={disabled} onChange={event => updateReading({ appVersion: event.target.value })} /></label>
      </div>
      <div className="gz-net-row">
        <button type="button" className="gz-btn" disabled={disabled} onClick={() => void fillReading()}>{busy === "fill" ? <LoaderCircle className="gz-spin" size={16} /> : <RefreshCw size={16} />}自动更新版本</button>
        <button type="button" className="gz-btn" disabled={disabled} onClick={() => void testReading()}>{busy === "test-reading" ? <LoaderCircle className="gz-spin" size={16} /> : <Zap size={16} />}一键测速</button>
      </div>
      {!!nodeProbes.length && <div className="gz-probe-list">{nodeProbes.map(probe => <p key={`${probe.route ?? "api"}-${probe.host}`} className={probe.error ? "gz-error" : "gz-meta"}>{probe.host}：{probe.error ?? `${probe.milliseconds} ms · 可用`}</p>)}</div>}
      <label className="gz-toggle-row" role="switch" aria-checked={reading.autoUpdate}><span className="gz-row-main"><strong>每日自动检查</strong><span className="gz-meta">启动时检查 COPY API 和版本信息。</span></span><input type="checkbox" checked={reading.autoUpdate} disabled={disabled} onChange={event => updateReading({ autoUpdate: event.target.checked })} /></label>
    </section>

    <div className="gz-net-save">
      {error && <p className="gz-error" role="alert">{error}</p>}
      <button type="button" className="gz-btn primary" disabled={disabled} onClick={() => void save()}>{busy === "save" ? <LoaderCircle className="gz-spin" size={16} /> : <Save size={16} />}保存网络配置</button>
      <p className="gz-meta">Bangumi 镜像和 COPY 设置仅保存在本机，不会同步到其他设备。</p>
    </div>
  </div>;
}
