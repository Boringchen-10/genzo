import { useMemo, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { api } from "../api";
import type { MediaType, WorkDetail, WorkInput, WorkStatus } from "../types";
import { mediaLabels, statusLabels } from "../utils";

const defaultInput: WorkInput = {
  title: "",
  originalTitle: null,
  type: "video",
  description: "",
  coverPath: null,
  status: "planned",
  favorite: false,
  rating: null,
  tags: [],
  notes: "",
};

function initialFromWork(work?: WorkDetail | null): WorkInput {
  if (!work) return defaultInput;
  return {
    title: work.title,
    originalTitle: work.originalTitle,
    type: work.type,
    description: work.description,
    coverPath: work.coverPath,
    status: work.status,
    favorite: work.favorite,
    rating: work.rating,
    tags: work.tags,
    notes: work.notes,
  };
}

export function WorkForm({
  work,
  initialInput,
  busy,
  onCancel,
  onSubmit,
}: {
  work?: WorkDetail | null;
  initialInput?: Partial<WorkInput>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: WorkInput) => Promise<void>;
}) {
  const initial = useMemo(
    () => work ? initialFromWork(work) : { ...defaultInput, ...initialInput },
    [work, initialInput],
  );
  const [input, setInput] = useState(initial);
  const [rating, setRating] = useState(initial.rating?.toString() ?? "");
  const [tagText, setTagText] = useState(initial.tags.join("，"));
  const [error, setError] = useState("");

  const chooseCover = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "avif"] }],
    });
    if (typeof selected === "string") {
      try {
        const cachedPath = await api.importCover(selected);
        setInput((current) => ({ ...current, coverPath: cachedPath }));
        setError("");
      } catch (coverError: unknown) {
        setError(coverError instanceof Error ? coverError.message : "无法导入封面");
      }
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedRating = rating.trim() === "" ? null : Number(rating);
    if (!input.title.trim()) return setError("请输入作品标题");
    if (parsedRating !== null && (!Number.isFinite(parsedRating) || parsedRating < 0 || parsedRating > 10)) {
      return setError("评分必须是 0 到 10 之间的数字");
    }
    setError("");
    await onSubmit({
      ...input,
      title: input.title.trim(),
      originalTitle: input.originalTitle?.trim() || null,
      coverPath: input.coverPath?.trim() || null,
      rating: parsedRating,
      tags: tagText.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
    });
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field span-2">
        <span>作品标题 *</span>
        <input value={input.title} maxLength={200} onChange={(e) => setInput({ ...input, title: e.target.value })} autoFocus />
      </label>
      <label className="field span-2">
        <span>原始标题</span>
        <input value={input.originalTitle ?? ""} maxLength={200} onChange={(e) => setInput({ ...input, originalTitle: e.target.value })} />
      </label>
      <label className="field">
        <span>媒体类型 *</span>
        <select value={input.type} onChange={(e) => setInput({ ...input, type: e.target.value as MediaType })}>
          {(Object.keys(mediaLabels) as MediaType[]).map((type) => <option key={type} value={type}>{mediaLabels[type]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>收藏状态 *</span>
        <select value={input.status} onChange={(e) => setInput({ ...input, status: e.target.value as WorkStatus })}>
          {(Object.keys(statusLabels) as WorkStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>评分（0–10）</span>
        <input type="number" min="0" max="10" step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} />
      </label>
      <label className="check-field">
        <input type="checkbox" checked={input.favorite} onChange={(e) => setInput({ ...input, favorite: e.target.checked })} />
        <span>加入收藏</span>
      </label>
      <label className="field span-2">
        <span>标签</span>
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="用逗号分隔，例如：治愈，已购" />
      </label>
      <div className="field span-2">
        <span>本地封面</span>
        <div className="path-picker">
          <input value={input.coverPath ?? ""} readOnly placeholder="未选择" />
          <button type="button" className="button secondary icon-text" onClick={chooseCover}>
            <FolderOpen size={16} /> 选择图片
          </button>
        </div>
      </div>
      <label className="field span-2">
        <span>简介</span>
        <textarea rows={3} maxLength={4000} value={input.description} onChange={(e) => setInput({ ...input, description: e.target.value })} />
      </label>
      <label className="field span-2">
        <span>个人备注</span>
        <textarea rows={3} maxLength={4000} value={input.notes} onChange={(e) => setInput({ ...input, notes: e.target.value })} />
      </label>
      {error ? <p className="form-error span-2">{error}</p> : null}
      <div className="form-actions span-2">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>取消</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? "正在保存…" : "保存作品"}</button>
      </div>
    </form>
  );
}
