import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, BarChart3, Bell, Bookmark, BookOpen, Bot, Check, ChevronRight, CircleHelp, Compass, Download, Film, Folder, Heart, History, Home, Inbox, Info, Library, LoaderCircle, Network, Palette, Play, Plus, RefreshCw, Search, Settings, SlidersHorizontal, User, UserPlus, X } from "lucide-react";
import { api } from "../api";
import type { MatchCandidate, MediaFile, ThemeMode, UnassignedMediaGroup, WorkDetail, WorkInput, WorkListItem, WorkStatus } from "../types";
import { activeScan, type ScanTask } from "../scanTasks";
import { playbackPercent, playbackTime, type PlaybackProgress } from "../playback";
import { usePreferences, type ThemeStyle } from "../store";
import { androidApi, type VideoSource } from "./api";
import AndroidPrototype from "./AndroidPrototype";
import "./mobile.css";

const tabs = [{ route: "home", title: "首页", icon: Home }, { route: "library", title: "媒体库", icon: Library }, { route: "bookshelf", title: "书架", icon: BookOpen }, { route: "explore", title: "发现", icon: Compass }, { route: "profile", title: "我的", icon: User }];
const categories = [{ id: "all", title: "全部" }, { id: "anime", title: "动漫" }, { id: "movie", title: "电影" }, { id: "tv", title: "电视剧" }, { id: "video", title: "未分类影视" }];
const statuses: Record<WorkStatus, string> = { planned: "计划看", in_progress: "在看", completed: "看过", paused: "搁置", dropped: "放弃" };
const sourceStates: Record<string, string> = { available: "可访问", checking: "待检查", offline: "来源离线", permission_denied: "授权失效", credential_invalid: "凭据失效", connection_failed: "连接失败" };
const taskStages: Record<string, string> = { queued: "等待扫描", scanning: "查询目录", indexing: "建立索引", committing: "保存索引", completed: "扫描完成", failed: "扫描失败", cancelled: "已取消", interrupted: "已中断" };
const metadataStates: Record<string, string> = { unmatched: "待整理", candidate_pending: "待确认", matched: "已匹配", manually_created: "手动整理", error: "识别失败" };
const asset = (path: string | null | undefined) => path ? (/^(https?:|asset:|data:|blob:)/.test(path) ? path : convertFileSrc(path)) : undefined;
const routeFromHash = () => location.hash.slice(2) || "home";
const bytes = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
const inputFor = (work: WorkDetail): WorkInput => ({ title: work.title, originalTitle: work.originalTitle, type: work.type, description: work.description, coverPath: work.coverPath, status: work.status, favorite: work.favorite, rating: work.rating, notes: work.notes, tags: work.tags });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const hslToHex = (hue: number, sat: number, light: number) => {
  const saturation = clamp(sat, 0, 100) / 100;
  const lightness = clamp(light, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const match = lightness - chroma / 2;
  return `#${[red, green, blue].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
};
const hslToHsv = (hue: number, sat: number, light: number) => {
  const saturation = clamp(sat, 0, 100) / 100;
  const lightness = clamp(light, 0, 100) / 100;
  const value = lightness + saturation * Math.min(lightness, 1 - lightness);
  const hsvSat = value === 0 ? 0 : 2 * (1 - lightness / value);
  return { h: hue, s: hsvSat * 100, v: value * 100 };
};
const hsvToHsl = (hue: number, sat: number, value: number) => {
  const hsvSat = clamp(sat, 0, 100) / 100;
  const hsvVal = clamp(value, 0, 100) / 100;
  const lightness = hsvVal * (1 - hsvSat / 2);
  const sl = lightness === 0 || lightness === 1 ? 0 : (hsvVal - lightness) / Math.min(lightness, 1 - lightness);
  return { hue, sat: sl * 100, light: lightness * 100 };
};
const hsvToHex = (hue: number, sat: number, value: number) => {
  const hsvSat = clamp(sat, 0, 100) / 100;
  const hsvVal = clamp(value, 0, 100) / 100;
  const chroma = hsvVal * hsvSat;
  const section = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const match = hsvVal - chroma;
  return `#${[red, green, blue].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
};
const themeStyles: { id: ThemeStyle; label: string; sat: number; light: number; neutral: number; lift?: number; rainbow?: boolean }[] = [
  { id: "soft", label: "柔和", sat: 0.95, light: 1, neutral: 28, lift: 0 },
  { id: "vivid", label: "鲜明", sat: 1.4, light: 1.06, neutral: 48, lift: 1.2 },
  { id: "expressive", label: "表现", sat: 1.6, light: 1.12, neutral: 62, lift: 2.4 },
  { id: "accurate", label: "准确", sat: 0.85, light: 0.94, neutral: 14, lift: 0 },
  { id: "content", label: "内容", sat: 1.15, light: 1, neutral: 34, lift: 0.6 },
  { id: "neutral", label: "中性", sat: 0.4, light: 0.98, neutral: 8, lift: 1 },
  { id: "mono", label: "黑白", sat: 0, light: 1, neutral: 0, lift: 1.5 },
  { id: "rainbow", label: "彩虹", sat: 1.45, light: 1.06, neutral: 58, lift: 1.5, rainbow: true },
];
const presetSwatches = [
  { hex: "#5a6b70", h: 194, s: 10, l: 40 },
  { hex: "#0f9b8e", h: 174, s: 82, l: 33 },
  { hex: "#3b6cf6", h: 224, s: 91, l: 60 },
  { hex: "#2fa84f", h: 135, s: 56, l: 42 },
  { hex: "#f5a623", h: 38, s: 91, l: 55 },
  { hex: "#ef4b7c", h: 338, s: 84, l: 62 },
  { hex: "#1f7ae0", h: 210, s: 76, l: 50 },
  { hex: "#7b3ff2", h: 264, s: 87, l: 60 },
  { hex: "#b23bd6", h: 287, s: 66, l: 54 },
  { hex: "#14b8c4", h: 184, s: 82, l: 42 },
  { hex: "#2e9e6b", h: 154, s: 55, l: 40 },
  { hex: "#8bc34a", h: 88, s: 51, l: 53 },
  { hex: "#f0a500", h: 41, s: 100, l: 47 },
  { hex: "#f4522e", h: 12, s: 90, l: 57 },
  { hex: "#2f6bff", h: 224, s: 100, l: 59 },
];
const rainbowGradient = "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)";
function ColorPicker({ hue, sat, light, onCancel, onConfirm }: { hue: number; sat: number; light: number; onCancel: () => void; onConfirm: (value: { hue: number; sat: number; light: number }) => void }) {
  const initial = hslToHsv(hue, sat, light);
  const [h, setH] = useState(Math.round(initial.h));
  const [s, setS] = useState(clamp(initial.s, 0, 100));
  const [v, setV] = useState(clamp(initial.v, 0, 100));
  const ring = useRef<HTMLDivElement>(null);
  const square = useRef<HTMLDivElement>(null);
  const mode = useRef<"hue" | "sv" | null>(null);
  const pickHue = (clientX: number, clientY: number) => {
    const rect = ring.current?.getBoundingClientRect();
    if (!rect) return;
    const angle = Math.atan2(clientX - (rect.left + rect.width / 2), -(clientY - (rect.top + rect.height / 2))) * 180 / Math.PI;
    setH(Math.round((angle + 360) % 360));
  };
  const pickSv = (clientX: number, clientY: number) => {
    const rect = square.current?.getBoundingClientRect();
    if (!rect) return;
    setS(clamp((clientX - rect.left) / rect.width * 100, 0, 100));
    setV(clamp((1 - (clientY - rect.top) / rect.height) * 100, 0, 100));
  };
  const end = () => { mode.current = null; };
  const rad = h * Math.PI / 180;
  return <div className="gz-scrim gz-scrim-center" onClick={onCancel}><section className="gz-sheet gz-picker" role="dialog" aria-modal="true" aria-label="自定义主题色" onClick={event => event.stopPropagation()}>
    <p className="gz-meta">点击色盘选择自定义主题色</p>
    <div className="gz-picker-ring" ref={ring} style={{ background: rainbowGradient }}
      onPointerDown={event => { mode.current = "hue"; event.currentTarget.setPointerCapture(event.pointerId); pickHue(event.clientX, event.clientY); }}
      onPointerMove={event => { if (mode.current === "hue") pickHue(event.clientX, event.clientY); }}
      onPointerUp={end} onPointerCancel={end}>
      <span className="gz-picker-hue" style={{ left: `${50 + 45 * Math.sin(rad)}%`, top: `${50 - 45 * Math.cos(rad)}%` }} aria-hidden="true" />
      <div className="gz-picker-square" ref={square} style={{ background: `linear-gradient(to right, #fff, rgba(255,255,255,0)), linear-gradient(to top, #000, rgba(0,0,0,0)), hsl(${h} 100% 50%)` }}
        onPointerDown={event => { event.stopPropagation(); mode.current = "sv"; event.currentTarget.setPointerCapture(event.pointerId); pickSv(event.clientX, event.clientY); }}
        onPointerMove={event => { if (mode.current === "sv") pickSv(event.clientX, event.clientY); }}
        onPointerUp={event => { event.stopPropagation(); end(); }} onPointerCancel={end}>
        <span className="gz-picker-sv" style={{ left: `${s}%`, top: `${100 - v}%` }} aria-hidden="true" />
      </div>
    </div>
    <output className="gz-picker-hex">{hsvToHex(h, s, v).toUpperCase()}</output>
    <div className="gz-picker-actions"><button className="gz-btn" onClick={onCancel}>取消</button><button className="gz-btn primary" onClick={() => onConfirm(hsvToHsl(h, s, v))}>确定</button></div>
  </section></div>;
}

const homeSections: { id: string; title: string; match: (work: WorkListItem) => boolean }[] = [
  { id: "anime", title: "动画", match: work => (work.category ?? work.type) === "anime" },
  { id: "books", title: "书籍", match: work => work.type === "comic" || work.type === "novel" },
  { id: "movie", title: "电影", match: work => (work.category ?? work.type) === "movie" },
  { id: "tv", title: "电视剧", match: work => (work.category ?? work.type) === "tv" },
  { id: "video", title: "影视", match: work => (work.category ?? work.type) === "video" },
];
const recentCovers = (items: WorkListItem[]) => [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10);

function Poster({ work }: { work: WorkListItem | WorkDetail }) {
  const [failed, setFailed] = useState(false);
  const url = asset(work.coverPath);
  useEffect(() => setFailed(false), [url]);
  return <div className={`gz-poster ${!url || failed ? "missing" : ""}`}>
    {url && !failed ? <img src={url} alt={work.title} onError={() => setFailed(true)} /> : <><Film aria-hidden="true" /><span>暂无封面</span></>}
    {work.favorite && <span className="gz-fav"><Heart size={14} fill="currentColor" /></span>}
  </div>;
}
function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="gz-empty"><Library size={30} /><h2>{title}</h2>{children}</div>;
}
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="gz-section"><div className="gz-section-head"><h2>{title}</h2>{action}</div>{children}</section>;
}
function MenuRow({ label, icon: Icon, subtitle, onClick, chevron = true, dot = false }: { label: string; icon: React.ComponentType<{ size?: number | string }>; subtitle?: string; onClick?: () => void; chevron?: boolean; dot?: boolean }) {
  return <button type="button" className="gz-menu-row" onClick={onClick}>
    <span className="gz-menu-iconwrap"><Icon size={22} />{dot && <span className="gz-menu-dot" aria-hidden="true" />}</span>
    <span className="gz-menu-body"><strong>{label}</strong>{subtitle && <span className="gz-meta gz-truncate">{subtitle}</span>}</span>
    {chevron && <ChevronRight className="gz-menu-arrow" size={18} aria-hidden="true" />}
  </button>;
}
function WorkEditor({ work, onSave, busy }: { work: WorkDetail; onSave: (input: WorkInput) => void; busy: boolean }) {
  const [input, setInput] = useState(() => inputFor(work));
  return <form onSubmit={event => { event.preventDefault(); onSave(input); }}>
    <label>作品标题 *<input required maxLength={200} value={input.title} onChange={event => setInput({ ...input, title: event.target.value })} /></label>
    <label>个人状态<select value={input.status} onChange={event => setInput({ ...input, status: event.target.value as WorkStatus })}>{Object.entries(statuses).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
    <label>个人评分（0–10）<input type="number" min={0} max={10} step={0.5} value={input.rating ?? ""} onChange={event => setInput({ ...input, rating: event.target.value === "" ? null : Number(event.target.value) })} /></label>
    <label>个人备注<textarea rows={4} value={input.notes} onChange={event => setInput({ ...input, notes: event.target.value })} /></label>
    <button className="gz-btn primary" disabled={busy || !input.title.trim()} type="submit"><Check size={18} />保存记录</button>
  </form>;
}
function Organize({ group, works, busy, onRun, onDone }: { group: UnassignedMediaGroup; works: WorkListItem[]; busy: boolean; onRun: (operation: () => Promise<void>) => void; onDone: (workId: string) => Promise<void> }) {
  const [title, setTitle] = useState(group.title);
  const [query, setQuery] = useState(group.representative.parsedTitle || group.title);
  const [kind, setKind] = useState<"anime" | "movie" | "tv">("anime");
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [members, setMembers] = useState<MediaFile[]>([]);
  const [target, setTarget] = useState(works[0]?.id ?? "");
  const [readError, setReadError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([api.listRecognitionGroupMembers(group.representative.id), api.listMatchCandidates(group.representative.id)])
      .then(([context, choices]) => { if (active) { setMembers(context.members); setCandidates(choices); } })
      .catch(reason => { if (active) setReadError(String(reason)); });
    return () => { active = false; };
  }, [group.representative.id]);
  return <>
    <p className="gz-meta">以下操作整理数据库中的作品关联，原始文件保持原位。</p>
    {readError && <p role="alert">{readError}</p>}
    <details className="gz-panel"><summary>本次文件范围 · {members.length} 个</summary>{members.map(file => <p className="gz-file-name" key={file.id}>{file.fileName}</p>)}</details>
    <form onSubmit={event => { event.preventDefault(); onRun(async () => {
      const result = await api.recognizeMedia(group.representative.id, query, kind);
      setCandidates(result.candidates);
      if (result.error) throw new Error(result.error);
    }); }}>
      <label>搜索作品资料<input required value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>资料类型<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="anime">动漫 · Bangumi</option><option value="movie">电影 · TMDB</option><option value="tv">电视剧 · TMDB</option></select></label>
      <button className="gz-btn" disabled={busy || !query.trim() || !members.length}><Search size={18} />查找候选</button>
    </form>
    <div className="gz-candidates">{candidates.length ? candidates.map(candidate => <div className="gz-panel" key={candidate.id}>
      <strong>{candidate.title}</strong><p className="gz-meta">{candidate.provider} · {candidate.year ?? "年份未知"} · 置信度 {candidate.confidence}</p>
      <p className="gz-meta">{candidate.matchReasons.join("；")}</p>
      <button className="gz-btn primary" disabled={busy || !members.length} onClick={() => onRun(async () => onDone(await api.confirmMatch(group.representative.id, candidate.id, members.filter(file => !file.workId).map(file => file.id), "season")))}>确认该作品</button>
    </div>) : <p className="gz-meta">暂无候选。可以修改名称再搜索，或在下方手动整理。</p>}</div>
    <form onSubmit={event => { event.preventDefault(); onRun(async () => {
      const work = await api.createWorkFromMedia(group.representative.id, { title: title.trim(), originalTitle: null, type: "video", description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [] });
      await onDone(work.id);
    }); }}><label>手动创建作品 *<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label><button className="gz-btn" disabled={busy || !title.trim() || !members.length}><Plus size={18} />创建并整理本组</button></form>
    {works.length > 0 && <form onSubmit={event => { event.preventDefault(); onRun(async () => { await api.attachMediaFiles(target, members.filter(file => !file.workId).map(file => file.id)); await onDone(target); }); }}>
      <label>归入已有作品<select value={target} onChange={event => setTarget(event.target.value)}>{works.map(work => <option key={work.id} value={work.id}>{work.title}</option>)}</select></label>
      <button className="gz-btn" disabled={busy || !target || !members.length}>关联本组文件</button>
    </form>}
  </>;
}

export default function AndroidApp() {
  const [route, setRoute] = useState(routeFromHash);
  const [allWorks, setAllWorks] = useState<WorkListItem[]>([]);
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [groups, setGroups] = useState<UnassignedMediaGroup[]>([]);
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [tasks, setTasks] = useState<ScanTask[]>([]);
  const [progress, setProgress] = useState<PlaybackProgress[]>([]);
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(matchMedia("(prefers-color-scheme: dark)").matches);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(48);
  const accentHue = usePreferences(state => state.accentHue);
  const accentSat = usePreferences(state => state.accentSat);
  const accentLight = usePreferences(state => state.accentLight);
  const themeStyle = usePreferences(state => state.themeStyle);
  const coverBrightness = usePreferences(state => state.coverBrightness);
  const amoled = usePreferences(state => state.amoled);
  const fontScale = usePreferences(state => state.fontScale);
  const shadowScale = usePreferences(state => state.shadowScale);
  const glassBlur = usePreferences(state => state.glassBlur);
  const cornerRadius = usePreferences(state => state.cornerRadius);
  const setAccentHue = usePreferences(state => state.setAccentHue);
  const setAccentSat = usePreferences(state => state.setAccentSat);
  const setAccentLight = usePreferences(state => state.setAccentLight);
  const setThemeStyle = usePreferences(state => state.setThemeStyle);
  const setCoverBrightness = usePreferences(state => state.setCoverBrightness);
  const setAmoled = usePreferences(state => state.setAmoled);
  const setFontScale = usePreferences(state => state.setFontScale);
  const setShadowScale = usePreferences(state => state.setShadowScale);
  const setGlassBlur = usePreferences(state => state.setGlassBlur);
  const setCornerRadius = usePreferences(state => state.setCornerRadius);
  const resetAppearance = usePreferences(state => state.resetAppearance);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modal, setModal] = useState<{ kind: "edit"; work: WorkDetail } | { kind: "organize"; group: UnassignedMediaGroup } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const refreshSequence = useRef(0);
  const dark = theme === "system" ? systemDark : theme === "dark";
  const accentStyle = themeStyles.find(item => item.id === themeStyle) ?? { id: "soft" as ThemeStyle, label: "柔和", sat: 1, light: 1, neutral: 30 };
  const accentSatValue = clamp(accentSat * accentStyle.sat, 0, 100);
  const accentLightValue = dark ? clamp(accentLight * accentStyle.light, 10, 92) : clamp(accentLight * accentStyle.light * 0.5, 12, 46);
  const neutralSatValue = clamp(accentStyle.neutral, 0, 100);
  const neutralLiftValue = accentStyle.lift ?? 0;
  const accentHex = hslToHex(accentHue, accentSatValue, accentLightValue);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    node.style.setProperty("--accent-h", String(accentHue));
    node.style.setProperty("--accent-s", `${accentSatValue}%`);
    node.style.setProperty("--accent-l", `${accentLightValue}%`);
    node.style.setProperty("--n-s", String(neutralSatValue));
    node.style.setProperty("--n-lift", String(neutralLiftValue));
    node.style.setProperty("--ui-blur", `${glassBlur}px`);
    node.style.setProperty("--radius", `${cornerRadius}px`);
    node.style.setProperty("--cover-brightness", String(coverBrightness / 100));
    node.style.setProperty("--shadow-scale", String(shadowScale));
    node.style.fontSize = `${(16 * fontScale) / 100}px`;
  }, [accentHue, accentSatValue, accentLightValue, neutralSatValue, neutralLiftValue, glassBlur, cornerRadius, coverBrightness, shadowScale, fontScale]);
  const top = tabs.find(tab => tab.route === route);
  const workId = route.startsWith("detail/") ? decodeURIComponent(route.slice(7)) : null;
  const title = top?.title || ({ sources: "来源管理", inbox: "待整理", diagnostics: "开发验证", bookshelf: "书架", explore: "发现", appearance: "外观" }[route]) || "作品详情";

  async function refresh() {
    const sequence = ++refreshSequence.current;
    const [workList, allGroups, allSources, allTasks, overview] = await Promise.all([api.listWorks(), api.listUnassignedGroups(), androidApi.sources(), androidApi.tasks(), androidApi.progress()]);
    if (sequence !== refreshSequence.current) return;
    setAllWorks(workList);
    setWorks(workList.filter(work => work.type === "video"));
    setGroups(allGroups.filter(group => group.destination === "media" && group.mediaType === "video"));
    setSources(allSources); setTasks(allTasks); setProgress(overview.items);
  }
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError("");
    try { await operation(); } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  function navigate(next: string) {
    if (next === route) return;
    scrollPositions.current[route] = main.current?.scrollTop ?? 0;
    history.pushState({ genzoDepth: (history.state?.genzoDepth ?? 0) + 1 }, "", `#/${next}`);
    setRoute(next);
  }
  function openCategory(category: string) {
    setFilter(category);
    setLimit(48);
    if (route !== "library") navigate("library");
  }
  function back() {
    if (modal) { setModal(null); return true; }
    if (route === "home") return false;
    scrollPositions.current[route] = main.current?.scrollTop ?? 0;
    if (history.state?.genzoDepth > 0) history.back();
    else { history.replaceState({ genzoDepth: 0 }, "", "#/home"); setRoute("home"); }
    return true;
  }
  useEffect(() => {
    if (!location.hash) history.replaceState({ genzoDepth: 0 }, "", "#/home");
    const changed = () => setRoute(routeFromHash());
    addEventListener("popstate", changed); addEventListener("hashchange", changed);
    void refresh().catch(reason => setError(String(reason))).finally(() => setLoading(false));
    void api.getSetting("theme").then(value => { if (["light", "dark", "system"].includes(value ?? "")) setTheme(value as ThemeMode); }).catch(reason => setError(String(reason)));
    const foreground = () => { if (!document.hidden) void refresh().catch(reason => setError(String(reason))); };
    addEventListener("focus", foreground); document.addEventListener("visibilitychange", foreground);
    return () => { removeEventListener("popstate", changed); removeEventListener("hashchange", changed); removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, []);
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = scrollPositions.current[route] ?? 0; }, [route]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; void androidApi.appearance(dark).catch(reason => setError(String(reason))); }, [dark]);
  useEffect(() => {
    const windowWithBack = window as Window & { __genzoBack?: () => boolean };
    windowWithBack.__genzoBack = back;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") back(); };
    addEventListener("keydown", escape);
    return () => { delete windowWithBack.__genzoBack; removeEventListener("keydown", escape); };
  }, [route, modal]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const elements = () => Array.from(sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,summary,[tabindex="0"]') ?? []);
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const targets = elements();
      if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0]?.focus(); }
    };
    addEventListener("keydown", trap);
    return () => { removeEventListener("keydown", trap); previous?.focus(); };
  }, [modal]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2800); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError("");
    if (workId) void api.getWork(workId).then(work => { if (active) setDetail(work); }).catch(reason => { if (active) { setError(String(reason)); setDetailError(String(reason)); } });
    return () => { active = false; };
  }, [workId]);
  const scanning = tasks.some(activeScan);
  useEffect(() => {
    if (!scanning && route !== "sources") return;
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(reason => setError(String(reason))); }, 1000);
    return () => clearInterval(timer);
  }, [scanning, route]);
  async function play(id: string) { const state = await androidApi.play(id); if (state.error) throw new Error(state.error.message); }
  async function favorite(work: WorkListItem | WorkDetail) {
    const current = await api.getWork(work.id);
    const updated = await api.updateWork(work.id, { ...inputFor(current), favorite: !current.favorite });
    if (workId === work.id) setDetail(updated);
    await refresh(); setToast(updated.favorite ? "已加入收藏" : "已取消收藏");
  }
  async function authorize(id?: string, reuse = false) {
    const result = await androidApi.authorize(id, reuse);
    if (result.status === "permission_denied") throw new Error("没有目录读取授权。请重新选择目录，并在系统提示中确认。");
    if (result.status === "authorized") { await refresh(); setToast("来源已添加，可以开始扫描"); }
  }
  const card = (work: WorkListItem) => <button className="gz-card" key={work.id} onClick={() => navigate(`detail/${encodeURIComponent(work.id)}`)}><Poster work={work} /><strong>{work.title}</strong><span className="gz-meta">{statuses[work.status]} · {work.mediaCount} 个文件</span></button>;
  const filtered = works.filter(work => (route !== "favorites" || work.favorite) && (filter === "all" || (work.category ?? work.type) === filter) && [work.title, work.originalTitle ?? "", ...work.tags].some(text => text.toLowerCase().includes(query.toLowerCase())));
  const continueItems = progress.filter(item => !item.completed && item.positionMs > 0).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 10);
  const bookWorks = allWorks.filter(work => work.type === "comic" || work.type === "novel").sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const primary = route.startsWith("detail/") ? "library" : top ? route : "profile";
  const sourceManager = <>
    <p className="gz-meta">授权你已下载视频的目录。扫描只建立索引，不复制视频；停用来源保留作品和个人记录。</p>
    <div className="gz-actions"><button className="gz-btn primary" disabled={busy} onClick={() => void run(() => authorize())}><Plus size={18} />添加本地目录</button><button className="gz-btn" disabled={busy} onClick={() => void run(() => authorize(undefined, true))}>登记已授权目录</button></div>
    {!sources.length && <Empty title="还没有视频来源"><p>选择目录并在系统选择器中点击“使用此文件夹”。</p></Empty>}
    {sources.map(source => { const task = tasks.find(task => task.rootId === source.id); return <section className="gz-panel gz-source" key={source.id}>
      <div className="gz-row"><Folder /><div className="gz-row-main"><strong>{source.label}</strong><span className="gz-meta">{source.kind === "saf" ? "本地授权目录" : "WebDAV 服务"}</span></div><button role="switch" aria-checked={source.enabled} aria-label={`${source.enabled ? "停用" : "启用"} ${source.label}`} className={`gz-switch ${source.enabled ? "active" : ""}`} disabled={busy} onClick={() => void run(async () => { await api.updateRoot(source.id, "video", !source.enabled); await refresh(); })}><span /></button></div>
      <div className="gz-actions"><span className={`gz-badge ${source.state === "available" && source.enabled ? "ok" : "warn"}`}>{source.enabled ? sourceStates[source.state] || source.state : "已停用"}</span><span className="gz-meta">{source.lastScannedAt ? `上次扫描 ${new Date(source.lastScannedAt).toLocaleString("zh-CN")}` : "尚未扫描"}</span></div>
      <div className="gz-actions"><button className="gz-btn" disabled={busy || !source.enabled || !!task && activeScan(task)} onClick={() => void run(async () => { await androidApi.scan(source.id); await refresh(); })}><RefreshCw size={16} />扫描</button>{source.kind === "saf" && <button className="gz-btn" disabled={busy} onClick={() => void run(() => authorize(source.id))}>重新授权</button>}</div>
      {task && <div className="gz-task"><strong>{taskStages[task.stage]}</strong><progress aria-label="扫描进度" {...(!["scanning", "queued"].includes(task.stage) ? { max: Math.max(1, task.discovered), value: task.processed } : {})} /><p className="gz-meta">已发现 {task.discovered} · 已处理 {task.processed} · 复用 {task.reused} · 目录 {task.visitedDirectories}</p>{task.errors.length > 0 && <details><summary>{task.errors.length} 项问题</summary>{task.errors.map((message, index) => <p className="gz-file-name" key={index}>{message}</p>)}</details>}{activeScan(task) ? <button className="gz-btn" disabled={busy} onClick={() => void run(async () => { await androidApi.cancel(task.id); await refresh(); })}>取消扫描</button> : ["failed", "interrupted", "cancelled"].includes(task.stage) && <button className="gz-btn" disabled={busy || !source.enabled} onClick={() => void run(async () => { await androidApi.retry(task.id); await refresh(); })}>重试失败范围</button>}</div>}
    </section>; })}
  </>;
  return <div ref={rootRef} className="android-app" data-theme={dark ? "dark" : "light"} data-amoled={amoled ? "true" : "false"} data-style={themeStyle}>
    <div className="gz-rainbow-layer" aria-hidden="true" />
    <main ref={main} inert={!!modal} className="gz-scroll" onScroll={() => { scrollPositions.current[route] = main.current?.scrollTop ?? 0; }}>
      {!top && <button className="gz-iconbtn gz-back" aria-label="返回" onClick={() => back()}><ArrowLeft /></button>}
      {error && <div className="gz-error" role="alert"><span>{error}</span><button className="gz-iconbtn" aria-label="关闭错误提示" onClick={() => setError("")}><X size={18} /></button></div>}
      {loading && <p className="gz-loading"><LoaderCircle />正在读取媒体库…</p>}
      {route === "home" && <>
        <Section title="继续观看">{continueItems.length ? <div className="gz-rail gz-cover-rail">{continueItems.map(item => <button className="gz-continue" disabled={busy || item.missing} key={item.mediaFileId} onClick={() => void run(() => play(item.mediaFileId))}><div className="gz-continue-cover"><Play /><span>{item.missing ? "文件缺失" : `${playbackTime(item.positionMs)} / ${playbackTime(item.durationMs)}`}</span><progress max={100} value={playbackPercent(item)} /></div><strong>{item.title}</strong><span className="gz-meta">{item.fileName}</span></button>)}</div> : <p className="gz-panel gz-meta">暂无观看记录。开始播放后，续播入口会出现在这里。</p>}</Section>
        {allWorks.length ? homeSections.map(section => { const items = recentCovers(allWorks.filter(section.match)); return <Section key={section.id} title={section.title} action={<button className="gz-link" onClick={() => section.id === "books" ? navigate("bookshelf") : openCategory(section.id)}>更多<ChevronRight size={16} /></button>}>{items.length ? <div className="gz-rail gz-cover-rail">{items.map(work => <button className="gz-cover" key={work.id} onClick={() => navigate(`detail/${encodeURIComponent(work.id)}`)}><Poster work={work} /><span className="gz-cover-label">{work.title}</span></button>)}</div> : <p className="gz-panel gz-meta">{section.id === "books" ? "漫画与轻小说书架将在后续版本接入。" : "暂无最近添加的作品。"}</p>}</Section>; }) : <section className="gz-hero"><div className="gz-hero-inner"><span className="gz-eyebrow">你的媒体，安静归档</span><h2>从你的第一部作品开始</h2><p className="gz-meta">添加已下载视频的目录，整理作品与观看记录。</p><div className="gz-actions"><button className="gz-btn primary" onClick={() => navigate("sources")}><Plus size={18} />添加来源</button></div></div></section>}
      </>}
      {(route === "library" || route === "favorites") && <>
        <label className="gz-search"><Search size={20} /><input type="search" aria-label="搜索媒体库" placeholder="搜索标题 / 原名 / 标签" value={query} onChange={event => { setQuery(event.target.value); setLimit(48); }} /></label>
        <div className="gz-chips" role="radiogroup" aria-label="作品类型">{categories.map(item => <button className={`gz-chip ${filter === item.id ? "active" : ""}`} role="radio" aria-checked={filter === item.id} key={item.id} onClick={() => { setFilter(item.id); setLimit(48); }}>{item.title}</button>)}</div>
        <p className="gz-meta">共 {filtered.length} 部作品</p>{filtered.length ? <><div className="gz-grid">{filtered.slice(0, limit).map(card)}</div>{filtered.length > limit && <button className="gz-btn" onClick={() => setLimit(limit + 48)}>加载更多</button>}</> : <Empty title={route === "favorites" ? "还没有符合条件的收藏" : "没有匹配的作品"}><p>{query || filter !== "all" ? "试试其他关键词，或清除筛选。" : "添加来源并扫描，再到待整理中确认作品。"}</p><button className="gz-btn" onClick={() => { setQuery(""); setFilter("all"); if (!works.length) navigate("sources"); }}>{works.length ? "清除筛选" : "管理来源"}</button></Empty>}
      </>}
      {route === "profile" && <>
        <div className="gz-menu">
          <div className="gz-menu-group">
            <MenuRow label="未登录" icon={UserPlus} chevron={false} onClick={() => setToast("账号功能待接入")} />
            <MenuRow label="通用" icon={SlidersHorizontal} onClick={() => navigate("future/通用")} />
            <MenuRow label="外观" icon={Palette} onClick={() => navigate("appearance")} />
            <MenuRow label="网络" icon={Network} onClick={() => navigate("sources")} />
          </div>
          <div className="gz-menu-group">
            <MenuRow label="下载中心" icon={Download} onClick={() => navigate("future/下载中心")} />
            <MenuRow label="浏览记录" icon={History} onClick={() => navigate("future/浏览记录")} />
            <MenuRow label="书签" icon={Bookmark} onClick={() => navigate("future/书签")} />
            <MenuRow label="继续阅读漫画" icon={BookOpen} subtitle={continueItems[0] ? `${continueItems[0].title} · ${continueItems[0].fileName}` : "暂无阅读记录"} onClick={() => navigate("future/继续阅读漫画")} />
            <MenuRow label="阅读统计" icon={BarChart3} onClick={() => navigate("future/阅读统计")} />
          </div>
          <div className="gz-menu-group">
            <MenuRow label="AI配置" icon={Bot} onClick={() => navigate("future/AI配置")} />
            <MenuRow label="通知中心" icon={Bell} dot onClick={() => navigate("future/通知中心")} />
            <MenuRow label="关于" icon={Info} onClick={() => navigate("diagnostics")} />
          </div>
        </div>
        <p className="gz-footer">Genzo · 基于 Windows v0.5.0 · GPLv3</p>
      </>}
      {route === "appearance" && <>
        <Section title="主题模式" action={<span className="gz-meta">{theme === "system" ? `跟随系统（当前${dark ? "深色" : "浅色"}）` : theme === "dark" ? "深色" : "浅色"}</span>}>
          <div className="gz-field-row"><span className="gz-row-main"><strong>主题模式</strong><span className="gz-meta">深色 / 浅色 / 跟随系统</span></span><select className="gz-select" aria-label="主题模式" value={theme} onChange={event => void run(async () => { const mode = event.target.value as ThemeMode; await api.setSetting("theme", mode); setTheme(mode); })}><option value="system">系统</option><option value="dark">深色</option><option value="light">浅色</option></select></div>
        </Section>
        <Section title="暗色模式封面亮度" action={<output className="gz-set-value">{coverBrightness}%</output>}>
          <input type="range" min={20} max={100} value={coverBrightness} aria-label="暗色模式封面亮度" onChange={event => setCoverBrightness(Number(event.target.value))} />
          <p className="gz-meta">仅深色主题下调整封面亮度，数值越低封面越暗。</p>
        </Section>
        <Section title="主题风格">
          <div className="gz-style-chips" role="radiogroup" aria-label="主题风格">{themeStyles.map(item => <button key={item.id} role="radio" aria-checked={themeStyle === item.id} className={`gz-style-chip ${themeStyle === item.id ? "active" : ""}`} onClick={() => setThemeStyle(item.id)}><span className={`gz-style-dot ${item.rainbow ? "rainbow" : ""}`} style={item.rainbow ? undefined : { background: hslToHex(accentHue, clamp(accentSat * item.sat, 0, 100), clamp(accentLight * item.light, 10, 92)) }} aria-hidden="true" />{item.label}</button>)}</div>
          <p className="gz-meta">主题风格会同时调整强调色强度与界面底色、面板的染色程度，切换后整体配色气质随之变化。</p>
        </Section>
        <Section title="主题色" action={<output className="gz-set-value">{accentHex.toUpperCase()}</output>}>
          <div className="gz-accent-row"><button className="gz-swatch" aria-label="打开取色盘" style={{ background: accentStyle.rainbow ? rainbowGradient : accentHex }} onClick={() => setPickerOpen(true)} /><span className="gz-meta">点击色盘选择自定义主题色</span></div>
          <div className="gz-swatches">{presetSwatches.map(color => <button key={color.hex} className={`gz-swatch-sm ${accentHue === color.h ? "active" : ""}`} style={{ background: color.hex }} aria-label={`主题色 ${color.hex}`} onClick={() => { setAccentHue(color.h); setAccentSat(color.s); setAccentLight(color.l); }} />)}</div>
        </Section>
        <button type="button" className="gz-toggle-row" disabled>
          <span className="gz-row-main"><strong>动态颜色</strong><span className="gz-meta">基于壁纸动态生成配色（Android 12+，待接入）</span></span>
          <span className="gz-switch" aria-hidden="true"><span /></span>
        </button>
        <button type="button" role="switch" aria-checked={amoled} className="gz-toggle-row" onClick={() => setAmoled(!amoled)}>
          <span className="gz-row-main"><strong>AMOLED 纯黑模式</strong><span className="gz-meta">在深色主题中使用纯黑背景</span></span>
          <span className={`gz-switch ${amoled ? "active" : ""}`} aria-hidden="true"><span /></span>
        </button>
        <Section title="默认字体大小" action={<output className="gz-set-value">{fontScale}%</output>}>
          <input type="range" min={85} max={130} value={fontScale} aria-label="默认字体大小" onChange={event => setFontScale(Number(event.target.value))} />
          <p className="gz-meta">当前默认正文 16px，标题与辅助文字会按比例调整。</p>
        </Section>
        <Section title="统一阴影大小" action={<output className="gz-set-value">{shadowScale.toFixed(1)}</output>}>
          <input type="range" min={0} max={3} step={0.1} value={shadowScale} aria-label="统一阴影大小" onChange={event => setShadowScale(Number(event.target.value))} />
          <p className="gz-meta">统一调整卡片与面板的阴影强度，0 为关闭。</p>
        </Section>
        <Section title="玻璃与背景模糊" action={<output className="gz-set-value">{glassBlur}px</output>}>
          <input type="range" min={0} max={48} value={glassBlur} aria-label="玻璃与背景模糊" onChange={event => setGlassBlur(Number(event.target.value))} />
          <p className="gz-meta">控制面板、浮层与弹窗的玻璃模糊程度（0 为完全清晰）。</p>
        </Section>
        <Section title="圆角大小" action={<output className="gz-set-value">{cornerRadius}px</output>}>
          <input type="range" min={0} max={24} value={cornerRadius} aria-label="圆角大小" onChange={event => setCornerRadius(Number(event.target.value))} />
          <p className="gz-meta">0 为直角，数值越大越圆润。</p>
        </Section>
        <button className="gz-btn" onClick={resetAppearance}>恢复默认外观</button>
        <button className="gz-row-card" onClick={() => navigate("diagnostics")}><CircleHelp /><span className="gz-row-main"><strong>开发验证</strong><span className="gz-meta">数据库、目录和播放器诊断</span></span><ChevronRight size={18} /></button>
      </>}
      {route === "sources" && <>
        {sourceManager}
        <button className="gz-row-card" onClick={() => navigate("inbox")}><span className="gz-row-icon"><Inbox /></span><span className="gz-row-main"><strong>待整理队列</strong><span className="gz-meta">{groups.length} 个分组待确认</span></span><ChevronRight size={18} /></button>
        <Section title="远程来源"><div className="gz-panel"><strong>WebDAV 与网盘服务</strong><p className="gz-meta">已有协议正在接入安卓页面与远程播放验证。通过网盘的 WebDAV 服务接入，与网盘账号/API 直连是两种方式。</p><span className="gz-badge warn">接入中</span></div></Section>
        <Section title="网盘直连"><div className="gz-panel"><strong>账号 / API 直连</strong><p className="gz-meta">具体网盘直连需你确认服务后再接入；未确认前保留为扩展位置。</p><span className="gz-badge">Future · 预留</span></div></Section>
        <Section title="元数据服务"><div className="gz-panel"><strong>资料与识别来源</strong><p className="gz-meta">动漫以 Bangumi 为主锚点，影视以 TMDB 为主源；刷新失败时保留已有资料。</p></div></Section>
      </>}
      {route === "inbox" && <><p className="gz-meta">{groups.length} 个作品分组待整理。确认候选、手动创建，或关联已有作品。</p>{groups.length ? groups.slice(0, limit).map(group => <button className="gz-row-card" key={group.key} onClick={() => setModal({ kind: "organize", group })}><span className="gz-row-icon"><Film /></span><span className="gz-row-main"><strong>{group.title}</strong><span className="gz-meta">{group.fileCount} 个文件 · {bytes(group.totalSize)}</span><span className="gz-meta gz-truncate">{group.representative.fileName}</span></span><span className="gz-badge warn">{metadataStates[group.recognitionStatus]}</span></button>) : <Empty title="待整理队列为空"><p>扫描来源后，需要确认的作品会出现在这里。</p><button className="gz-btn" onClick={() => navigate("sources")}>管理来源</button></Empty>}{groups.length > limit && <button className="gz-btn" onClick={() => setLimit(limit + 48)}>加载更多</button>}</>}
      {workId && (detail ? <>
        <section className="gz-detail-head"><Poster work={detail} /><div><span className="gz-badge">{metadataStates[detail.metadataStatus]}</span><h2>{detail.title}</h2>{detail.originalTitle && <p className="gz-meta">{detail.originalTitle}</p>}<p className="gz-meta">{detail.metadataYear ?? "年份未填写"} · {statuses[detail.status]}</p><div className="gz-actions"><button className={`gz-iconbtn ${detail.favorite ? "gz-accent" : ""}`} aria-label={detail.favorite ? "取消收藏" : "加入收藏"} disabled={busy} onClick={() => void run(() => favorite(detail))}><Heart fill={detail.favorite ? "currentColor" : "none"} /></button><button className="gz-btn" onClick={() => setModal({ kind: "edit", work: detail })}><Settings size={16} />个人记录</button></div></div></section>
        <div className="gz-actions"><span className="gz-badge">{detail.rating === null ? "未评分" : `我的评分 ${detail.rating}`}</span>{detail.tags.map(tag => <span className="gz-badge" key={tag}>{tag}</span>)}</div>
        <Section title="作品简介"><p className="gz-description">{detail.description || "暂无作品简介。可以在待整理中匹配资料。"}</p></Section>
        <Section title="本地视频" action={<span className="gz-meta">{detail.mediaFiles.filter(file => file.mediaType === "video").length} 个</span>}><div className="gz-episodes">{detail.mediaFiles.filter(file => file.mediaType === "video").map(file => { const saved = progress.find(item => item.mediaFileId === file.id); return <button className="gz-episode" key={file.id} disabled={busy || file.missing} onClick={() => void run(() => play(file.id))}><div className="gz-episode-cover"><Play /><span>{file.parsedEpisode ? `第 ${file.parsedEpisode} 集` : file.extension.toUpperCase()}</span>{saved && <progress max={100} value={playbackPercent(saved)} />}</div><strong>{file.fileName}</strong><span className="gz-meta">{file.missing ? "文件缺失" : saved?.completed ? "已看完" : saved ? `续播 ${playbackTime(saved.positionMs)}` : `${bytes(file.size)} · 未播放`}</span></button>; })}</div>{!detail.mediaFiles.some(file => file.mediaType === "video") && <p className="gz-panel gz-meta">尚未关联视频。可在待整理中关联本地文件。</p>}</Section>
        <Section title="个人备注"><p className="gz-description">{detail.notes || "还没有写下备注。"}</p></Section>
        <Section title="资料管理"><button className="gz-btn" disabled={busy || !detail.metadata} onClick={() => void run(async () => { await api.refreshWorkMetadata(detail.id); setDetail(await api.getWork(detail.id)); await refresh(); setToast("作品资料已刷新"); })}><RefreshCw size={16} />刷新已匹配资料</button><p className="gz-meta">{detail.metadata ? `资料来源 ${detail.metadata.provider}；刷新失败时保留已有资料。` : "当前为手动作品，尚未绑定资料来源。"}</p></Section>
      </> : detailError ? <Empty title="无法读取作品详情"><p>{detailError}</p><button className="gz-btn" onClick={back}>返回</button></Empty> : <p className="gz-loading">正在读取作品详情…</p>)}
      {route === "bookshelf" && (bookWorks.length ? <>
        <p className="gz-meta">共 {bookWorks.length} 部 · 漫画与轻小说阅读将在后续版本接入</p>
        <div className="gz-grid">{bookWorks.slice(0, limit).map(card)}</div>
        {bookWorks.length > limit && <button className="gz-btn" onClick={() => setLimit(limit + 48)}>加载更多</button>}
      </> : <Empty title="书架还是空的"><p>漫画与轻小说阅读将在后续版本接入；添加来源并扫描后，作品会先显示在这里。</p><button className="gz-btn" onClick={() => navigate("sources")}>管理来源</button></Empty>)}
      {route === "explore" && <Empty title={`${title} · Future`}><p>发现与推荐保留扩展位置。</p><button className="gz-btn" onClick={back}>返回</button></Empty>}
      {route.startsWith("future/") && <Empty title={`${decodeURIComponent(route.slice(7))} · Future`}><p>该能力尚未接入，保留扩展位置。</p><button className="gz-btn" onClick={back}>返回</button></Empty>}
      {route === "diagnostics" && <AndroidPrototype />}
    </main>
    <nav className="gz-tabbar" aria-label="主导航">{tabs.map(tab => <button aria-current={primary === tab.route ? "page" : undefined} aria-label={tab.title} className={primary === tab.route ? "active" : ""} key={tab.route} onClick={() => navigate(tab.route)}><tab.icon size={22} /><span className="gz-tab-label">{tab.title}</span></button>)}</nav>
    {toast && <div className="gz-toast" role="status">{toast}</div>}
    {busy && <div className="gz-busy" role="status"><LoaderCircle size={18} />正在处理…</div>}
    {modal && <div className="gz-scrim" onClick={() => setModal(null)}><section ref={sheet} className="gz-sheet" role="dialog" aria-modal="true" aria-labelledby="gz-dialog-title" onClick={event => event.stopPropagation()}><div className="gz-section-head"><h2 id="gz-dialog-title">{modal.kind === "edit" ? "个人记录" : "整理作品"}</h2><button className="gz-iconbtn" aria-label="关闭" onClick={() => setModal(null)}><X /></button></div>{error && <p className="gz-error" role="alert">{error}</p>}{modal.kind === "edit" ? <WorkEditor work={modal.work} busy={busy} onSave={input => void run(async () => { const updated = await api.updateWork(modal.work.id, input); setDetail(updated); await refresh(); setModal(null); setToast("个人记录已保存"); })} /> : <Organize group={modal.group} works={works} busy={busy} onRun={operation => void run(operation)} onDone={async id => { await refresh(); setModal(null); navigate(`detail/${id}`); setToast("作品整理完成"); }} />}</section></div>}
    {pickerOpen && <ColorPicker hue={accentHue} sat={accentSat} light={accentLight} onCancel={() => setPickerOpen(false)} onConfirm={value => { setAccentHue(Math.round(value.hue)); setAccentSat(Math.round(value.sat)); setAccentLight(Math.round(value.light)); setPickerOpen(false); }} />}
  </div>;
}
