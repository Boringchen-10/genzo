import { useCallback, useEffect, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, Pencil, Play, Plus, Search, Trash2, Wrench } from "lucide-react";
import { api } from "../api";
import { ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, Modal, PageHeader } from "../components/common";
import { useToasts } from "../store";
import type { ExternalTool, ExternalToolInput, MediaType } from "../types";
import { formatDate, getErrorMessage, mediaLabels } from "../utils";

const emptyTool: ExternalToolInput = {
  name: "",
  executablePath: "",
  supportedMediaTypes: ["video"],
  argumentsTemplate: "{file}",
  workingDirectory: null,
  isDefault: false,
};

function ToolForm({
  tool,
  busy,
  onCancel,
  onSave,
}: {
  tool: ExternalTool | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: ExternalToolInput) => Promise<void>;
}) {
  const [input, setInput] = useState<ExternalToolInput>(tool ? {
    name: tool.name,
    executablePath: tool.executablePath,
    supportedMediaTypes: tool.supportedMediaTypes,
    argumentsTemplate: tool.argumentsTemplate,
    workingDirectory: tool.workingDirectory,
    isDefault: tool.isDefault,
  } : emptyTool);
  const [error, setError] = useState("");

  const chooseExecutable = async () => {
    const result = await open({ multiple: false, directory: false, title: "选择外部程序", filters: [{ name: "Windows 程序", extensions: ["exe"] }] });
    if (typeof result === "string") setInput((current) => ({ ...current, executablePath: result }));
  };
  const chooseWorkingDirectory = async () => {
    const result = await open({ multiple: false, directory: true, title: "选择工作目录" });
    if (typeof result === "string") setInput((current) => ({ ...current, workingDirectory: result }));
  };
  const toggleType = (type: MediaType) => {
    setInput((current) => ({
      ...current,
      supportedMediaTypes: current.supportedMediaTypes.includes(type)
        ? current.supportedMediaTypes.filter((value) => value !== type)
        : [...current.supportedMediaTypes, type],
    }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.name.trim()) return setError("请输入工具名称");
    if (!input.executablePath.trim()) return setError("请选择程序路径");
    if (!input.supportedMediaTypes.length) return setError("请至少选择一种媒体类型");
    if ((input.argumentsTemplate.match(/"/g)?.length ?? 0) % 2 !== 0) return setError("参数模板中的双引号没有闭合");
    setError("");
    await onSave({ ...input, name: input.name.trim(), executablePath: input.executablePath.trim() });
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field span-2"><span>工具名称 *</span><input value={input.name} maxLength={100} onChange={(e) => setInput({ ...input, name: e.target.value })} autoFocus /></label>
      <div className="field span-2"><span>程序路径 *</span><div className="path-picker"><input value={input.executablePath} readOnly placeholder="选择 .exe 程序" /><button type="button" className="button secondary icon-text" onClick={() => void chooseExecutable()}><FolderOpen size={16} />选择</button></div></div>
      <fieldset className="field span-2"><legend>支持的媒体类型 *</legend><div className="check-grid">{(Object.keys(mediaLabels) as MediaType[]).map((type) => <label className="check-field" key={type}><input type="checkbox" checked={input.supportedMediaTypes.includes(type)} onChange={() => toggleType(type)} /><span>{mediaLabels[type]}</span></label>)}</div></fieldset>
      <label className="field span-2"><span>参数模板</span><input value={input.argumentsTemplate} onChange={(e) => setInput({ ...input, argumentsTemplate: e.target.value })} placeholder="{file}" /><small>支持 {'{file}'}、{'{folder}'} 和 {'{title}'}。带空格的组合参数请使用双引号。</small></label>
      <div className="field span-2"><span>工作目录</span><div className="path-picker"><input value={input.workingDirectory ?? ""} readOnly placeholder="可选，默认由工具决定" /><button type="button" className="button secondary icon-text" onClick={() => void chooseWorkingDirectory()}><FolderOpen size={16} />选择</button></div></div>
      <label className="check-field span-2"><input type="checkbox" checked={input.isDefault} onChange={(e) => setInput({ ...input, isDefault: e.target.checked })} /><span>设为所选媒体类型的默认工具</span></label>
      {error ? <p className="form-error span-2">{error}</p> : null}
      <div className="form-actions span-2"><button type="button" className="button secondary" onClick={onCancel} disabled={busy}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? "正在保存…" : "保存工具"}</button></div>
    </form>
  );
}

export function ToolsPage() {
  const toast = useToasts((state) => state.push);
  const [tools, setTools] = useState<ExternalTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ExternalTool | "new" | null>(null);
  const [deleting, setDeleting] = useState<ExternalTool | null>(null);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setTools(await api.listTools());
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const save = async (input: ExternalToolInput) => {
    setBusy(true);
    try {
      if (editing && editing !== "new") await api.updateTool(editing.id, input);
      else await api.createTool(input);
      setEditing(null);
      toast("外部工具已保存", "success");
      await load();
    } catch (saveError: unknown) {
      toast(getErrorMessage(saveError), "error");
    } finally {
      setBusy(false);
    }
  };

  const detect = async () => {
    setBusy(true);
    try {
      const detected = await api.detectTools();
      setTools(detected);
      toast(detected.length ? `检测完成，当前有 ${detected.length} 个工具` : "未在常见安装位置发现工具", "info");
    } catch (detectError: unknown) {
      toast(getErrorMessage(detectError), "error");
    } finally {
      setBusy(false);
    }
  };

  const test = async (tool: ExternalTool) => {
    setTestingId(tool.id);
    try {
      await api.testTool(tool.id);
      toast(`“${tool.name}”已启动`, "success");
    } catch (testError: unknown) {
      toast(getErrorMessage(testError), "error");
    } finally {
      setTestingId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteTool(deleting.id);
      setDeleting(null);
      toast("工具配置已删除", "success");
      await load();
    } catch (deleteError: unknown) {
      toast(getErrorMessage(deleteError), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page workspace-page tools-page">
      <PageHeader
        title="工具管理"
        description="配置用于播放、阅读或启动本地内容的外部程序"
        actions={<><button type="button" className="button secondary icon-text" disabled={busy} onClick={() => void detect()}><Search size={16} />检测常用工具</button><button type="button" className="button primary icon-text" onClick={() => setEditing("new")}><Plus size={17} />添加工具</button></>}
      />
      <div className="info-band"><Wrench size={18} /><span>Genzo 不会自动下载第三方程序。测试工具会实际启动所选程序。</span></div>
      {loading ? <LoadingState label="正在读取工具配置" /> : null}
      {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
      {!loading && !error && tools.length === 0 ? <EmptyState title="尚未配置外部工具" description="可检测 VLC、mpv、PotPlayer 和 MPC-BE 的常见安装位置，也可以手动添加。" action={<button type="button" className="button primary" onClick={() => setEditing("new")}>添加工具</button>} /> : null}
      {!loading && !error && tools.length ? (
        <div className="tool-list">
          {tools.map((tool) => (
            <section className="tool-row" key={tool.id}>
              <div className="tool-icon"><Wrench size={21} /></div>
              <div className="tool-name"><div><strong>{tool.name}</strong>{tool.isDefault ? <span className="default-badge"><Check size={12} />默认</span> : null}</div><span title={tool.executablePath}>{tool.executablePath}</span></div>
              <div className="tool-types">{tool.supportedMediaTypes.map((type) => <span key={type}>{mediaLabels[type]}</span>)}</div>
              <div className="tool-template"><small>参数</small><code>{tool.argumentsTemplate || "{file}"}</code></div>
              <div className="tool-date"><small>更新</small><span>{formatDate(tool.updatedAt).split(" ")[0]}</span></div>
              <div className="tool-actions"><IconButton tooltip="测试启动" onClick={() => void test(tool)} disabled={testingId !== null}><Play size={17} fill="currentColor" /></IconButton><IconButton tooltip="编辑工具" onClick={() => setEditing(tool)}><Pencil size={17} /></IconButton><IconButton tooltip="删除工具" className="danger-ghost" onClick={() => setDeleting(tool)}><Trash2 size={17} /></IconButton></div>
            </section>
          ))}
        </div>
      ) : null}
      {editing ? <Modal title={editing === "new" ? "添加外部工具" : "编辑外部工具"} width="large" onClose={() => setEditing(null)}><ToolForm tool={editing === "new" ? null : editing} busy={busy} onCancel={() => setEditing(null)} onSave={save} /></Modal> : null}
      {deleting ? <ConfirmDialog title="删除工具配置？" description={`将从 Genzo 中删除“${deleting.name}”的配置，不会卸载或修改该程序。`} busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} /> : null}
    </div>
  );
}
