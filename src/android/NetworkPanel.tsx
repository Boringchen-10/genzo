import { useState } from "react";
import { CircleGauge, Globe, LoaderCircle, Plus, RefreshCw, Save, Server, Trash2, Zap } from "lucide-react";

type NodeItem = { id: string; name: string; url: string; latency: number | null };

const seedNodes = (): NodeItem[] => [
  { id: "n1", name: "直连", url: "", latency: null },
];

export default function NetworkPanel({ onToast }: { onToast: (message: string) => void }) {
  const [proxy, setProxy] = useState("");
  const [timeout, setTimeoutMs] = useState("15");
  const [retry, setRetry] = useState("2");
  const [concurrency, setConcurrency] = useState("8");
  const [nodes, setNodes] = useState<NodeItem[]>(seedNodes);
  const [testing, setTesting] = useState(false);
  const [domain, setDomain] = useState("");
  const [version, setVersion] = useState("");

  const pending = (label: string) => onToast(`${label}：待接入阅读网络后端`);

  const addNode = () => {
    const id = `n${Date.now()}`;
    setNodes(list => [...list, { id, name: `线路 ${list.length + 1}`, url: "", latency: null }]);
  };
  const updateNode = (id: string, patch: Partial<NodeItem>) =>
    setNodes(list => list.map(node => node.id === id ? { ...node, ...patch } : node));
  const removeNode = (id: string) => setNodes(list => list.filter(node => node.id !== id));

  const testAll = async () => {
    setTesting(true);
    try {
      await new Promise(resolve => window.setTimeout(resolve, 600));
      setNodes(list => list.map((node, index) => ({ ...node, latency: node.url ? 40 + index * 12 : null })));
      onToast("测速为界面演示，真实测速待接入后端");
    } finally { setTesting(false); }
  };

  return <div className="gz-network">
    <section className="gz-net-card">
      <div className="gz-net-head"><Server size={16} /><h2>代理设置</h2></div>
      <label className="gz-field"><span>HTTP 代理</span>
        <input inputMode="url" placeholder="http://127.0.0.1:7890" value={proxy} onChange={event => setProxy(event.target.value)} />
      </label>
      <div className="gz-net-row">
        <label className="gz-field"><span>超时（秒）</span>
          <input inputMode="numeric" value={timeout} onChange={event => setTimeoutMs(event.target.value)} />
        </label>
        <label className="gz-field"><span>重试次数</span>
          <input inputMode="numeric" value={retry} onChange={event => setRetry(event.target.value)} />
        </label>
      </div>
    </section>

    <section className="gz-net-card">
      <div className="gz-net-head"><Globe size={16} /><h2>线路与节点</h2>
        <button className="gz-iconbtn gz-net-add" aria-label="新增线路" onClick={addNode}><Plus size={18} /></button>
      </div>
      <ul className="gz-node-list">{nodes.map(node => <li className="gz-node" key={node.id}>
        <input className="gz-node-name" aria-label="线路名称" value={node.name} onChange={event => updateNode(node.id, { name: event.target.value })} />
        <input className="gz-node-url" aria-label="线路地址" inputMode="url" placeholder="https://example.com" value={node.url} onChange={event => updateNode(node.id, { url: event.target.value })} />
        <span className={`gz-node-latency ${node.latency == null ? "" : node.latency < 120 ? "good" : "slow"}`}>{node.latency == null ? "未测" : `${node.latency} ms`}</span>
        <button className="gz-iconbtn" aria-label="删除线路" onClick={() => removeNode(node.id)}><Trash2 size={16} /></button>
      </li>)}</ul>
      <button className="gz-btn" disabled={testing} onClick={() => void testAll()}>{testing ? <LoaderCircle className="gz-spin" size={16} /> : <Zap size={16} />}{testing ? "测速中…" : "一键测速"}</button>
    </section>

    <section className="gz-net-card">
      <div className="gz-net-head"><CircleGauge size={16} /><h2>COPY 漫画源</h2></div>
      <label className="gz-field"><span>API 域名</span>
        <input inputMode="url" placeholder="https://api.example.com" value={domain} onChange={event => setDomain(event.target.value)} />
      </label>
      <label className="gz-field"><span>接口版本</span>
        <input placeholder="v1" value={version} onChange={event => setVersion(event.target.value)} />
      </label>
      <div className="gz-net-row">
        <label className="gz-field"><span>并发数</span>
          <input inputMode="numeric" value={concurrency} onChange={event => setConcurrency(event.target.value)} />
        </label>
        <button className="gz-btn" onClick={() => pending("填充域名与版本")}><RefreshCw size={16} />自动填充</button>
      </div>
    </section>

    <div className="gz-net-save">
      <button className="gz-btn primary" onClick={() => pending("保存网络配置")}><Save size={16} />保存配置</button>
      <p className="gz-meta">安卓分支尚未接入 reading_network 后端命令，本页配置暂不生效，仅作界面预览。</p>
    </div>
  </div>;
}
