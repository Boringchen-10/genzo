import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, Check, ChevronRight, CircleHelp, Film, Folder, Heart, Home, Inbox, Library, LoaderCircle, Play, Plus, RefreshCw, Search, Settings, User, X } from "lucide-react";
import { api } from "../api";
import type { MatchCandidate, MediaFile, ThemeMode, UnassignedMediaGroup, WorkDetail, WorkInput, WorkListItem, WorkStatus } from "../types";
import { activeScan, type ScanTask } from "../scanTasks";
import { playbackPercent, playbackTime, type PlaybackProgress } from "../playback";
import { androidApi, type VideoSource } from "./api";
import AndroidPrototype from "./AndroidPrototype";
import "./mobile.css";

const tabs = [{ route: "home", title: "首页", icon: Home }, { route: "library", title: "媒体库", icon: Library }, { route: "favorites", title: "收藏", icon: Heart }, { route: "profile", title: "我的", icon: User }];
const categories = [{ id: "all", title: "全部" }, { id: "anime", title: "动漫" }, { id: "movie", title: "电影" }, { id: "tv", title: "电视剧" }, { id: "video", title: "未分类影视" }];
const statuses: Record<WorkStatus, string> = { planned: "计划看", in_progress: "在看", completed: "看过", paused: "搁置", dropped: "放弃" };
const sourceStates: Record<string, string> = { available: "可访问", checking: "待检查", offline: "来源离线", permission_denied: "授权失效", credential_invalid: "凭据失效", connection_failed: "连接失败" };
const taskStages: Record<string, string> = { queued: "等待扫描", scanning: "查询目录", indexing: "建立索引", committing: "保存索引", completed: "扫描完成", failed: "扫描失败", cancelled: "已取消", interrupted: "已中断" };
const metadataStates: Record<string, string> = { unmatched: "待整理", candidate_pending: "待确认", matched: "已匹配", manually_created: "手动整理", error: "识别失败" };
const asset = (path: string | null | undefined) => path ? (/^(https?:|asset:|data:|blob:)/.test(path) ? path : convertFileSrc(path)) : undefined;
const routeFromHash = () => location.hash.slice(2) || "home";
const bytes = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
const inputFor = (work: WorkDetail): WorkInput => ({ title: work.title, originalTitle: work.originalTitle, type: work.type, description: work.description, coverPath: work.coverPath, status: work.status, favorite: work.favorite, rating: work.rating, notes: work.notes, tags: work.tags });

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
  const [modal, setModal] = useState<{ kind: "edit"; work: WorkDetail } | { kind: "organize"; group: UnassignedMediaGroup } | null>(null);
  const main = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const refreshSequence = useRef(0);
  const dark = theme === "system" ? systemDark : theme === "dark";
  const top = tabs.find(tab => tab.route === route);
  const workId = route.startsWith("detail/") ? decodeURIComponent(route.slice(7)) : null;
  const title = top?.title || ({ sources: "来源管理", inbox: "待整理", diagnostics: "开发验证", bookshelf: "书架", explore: "探索" }[route]) || "作品详情";

  async function refresh() {
    const sequence = ++refreshSequence.current;
    const [allWorks, allGroups, allSources, allTasks, overview] = await Promise.all([api.listWorks(), api.listUnassignedGroups(), androidApi.sources(), androidApi.tasks(), androidApi.progress()]);
    if (sequence !== refreshSequence.current) return;
    setWorks(allWorks.filter(work => work.type === "video"));
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
  const featured = works[0];
  const continueItems = progress.filter(item => !item.completed && item.positionMs > 0);
  const primary = route.startsWith("detail/") ? "library" : top ? route : "profile";
  const futureCards = <div className="gz-future-grid">{[{ route: "bookshelf", title: "书架", sub: "漫画 / 轻小说", icon: BookOpen }, { route: "explore", title: "探索", sub: "发现 / 推荐", icon: Search }].map(item => <button className="gz-panel" key={item.route} onClick={() => navigate(item.route)}><item.icon /><strong>{item.title}</strong><span className="gz-meta">{item.sub}</span><span className="gz-badge">Future · 预留</span></button>)}</div>;
  return <div className="android-app" data-theme={dark ? "dark" : "light"}>
    <header className="gz-topbar">{top ? <span className="gz-brand">G<span>·</span></span> : <button className="gz-iconbtn" aria-label="返回" onClick={back}><ArrowLeft /></button>}<h1>{route === "home" ? "Genzo" : title}</h1><button className="gz-iconbtn" aria-label="刷新页面数据" disabled={busy || loading} onClick={() => void run(refresh)}><RefreshCw size={20} /></button></header>
    <main ref={main} inert={!!modal} className="gz-scroll" onScroll={() => { scrollPositions.current[route] = main.current?.scrollTop ?? 0; }}>
      {error && <div className="gz-error" role="alert"><span>{error}</span><button className="gz-iconbtn" aria-label="关闭错误提示" onClick={() => setError("")}><X size={18} /></button></div>}
      {loading && <p className="gz-loading"><LoaderCircle />正在读取媒体库…</p>}
      {route === "home" && <>
        <section className="gz-hero" style={featured?.bannerPath ? { backgroundImage: `linear-gradient(0deg,#090d0f,transparent),url("${asset(featured.bannerPath)}")` } : undefined}>
          <div className="gz-hero-inner"><span className="gz-eyebrow">你的媒体，安静归档</span><h2>{featured?.title ?? "从你的第一部作品开始"}</h2><p className="gz-meta">{featured ? `${featured.metadataYear ?? "年份未填写"} · ${statuses[featured.status]} · ${featured.mediaCount} 个已索引文件` : "添加已下载视频的目录，整理作品与观看记录。"}</p><div className="gz-actions">
            <button className="gz-btn primary" onClick={() => navigate(featured ? `detail/${featured.id}` : "sources")}>{featured ? <Film size={18} /> : <Plus size={18} />}{featured ? "查看作品" : "添加来源"}</button>
            <button className="gz-btn" onClick={() => navigate("library")}>媒体库<ChevronRight size={16} /></button>
          </div></div>
        </section>
        <Section title="继续观看">{continueItems.length ? <div className="gz-rail">{continueItems.map(item => <button className="gz-continue" disabled={busy || item.missing} key={item.mediaFileId} onClick={() => void run(() => play(item.mediaFileId))}><div className="gz-continue-cover"><Play /><span>{item.missing ? "文件缺失" : `${playbackTime(item.positionMs)} / ${playbackTime(item.durationMs)}`}</span><progress max={100} value={playbackPercent(item)} /></div><strong>{item.title}</strong><span className="gz-meta">{item.fileName}</span></button>)}</div> : <p className="gz-panel gz-meta">暂无观看记录。开始播放后，续播入口会出现在这里。</p>}</Section>
        <Section title="最近添加" action={<button className="gz-link" onClick={() => navigate("library")}>媒体库<ChevronRight size={16} /></button>}>{works.length ? <div className="gz-grid">{works.slice(0, 6).map(card)}</div> : <Empty title="媒体库还没有作品"><p>扫描视频目录后，在待整理中确认作品。</p><button className="gz-btn" onClick={() => navigate("sources")}>添加来源</button></Empty>}</Section>
        <Section title="来源与扫描" action={<button className="gz-link" onClick={() => navigate("sources")}>管理<ChevronRight size={16} /></button>}><div className="gz-panel"><p className="gz-meta">{sources.length} 个来源 · {works.length} 部作品 · {groups.length} 组待整理</p><div className="gz-actions"><span className={`gz-badge ${scanning ? "warn" : "ok"}`}>{scanning ? "正在扫描" : "扫描空闲"}</span><button className="gz-link" onClick={() => navigate("inbox")}>查看待整理</button></div></div></Section>
        <Section title="后续扩展" action={<span className="gz-meta">Future</span>}>{futureCards}</Section>
      </>}
      {(route === "library" || route === "favorites") && <>
        <label className="gz-search"><Search size={20} /><input type="search" aria-label="搜索媒体库" placeholder="搜索标题 / 原名 / 标签" value={query} onChange={event => { setQuery(event.target.value); setLimit(48); }} /></label>
        {route === "library" && <div className="gz-chips"><button className="gz-chip active">媒体库</button><button className="gz-chip" onClick={() => navigate("inbox")}>待整理 · {groups.length}</button><button className="gz-chip" onClick={() => navigate("sources")}>来源管理</button></div>}
        <div className="gz-chips" role="radiogroup" aria-label="作品类型">{categories.map(item => <button className={`gz-chip ${filter === item.id ? "active" : ""}`} role="radio" aria-checked={filter === item.id} key={item.id} onClick={() => { setFilter(item.id); setLimit(48); }}>{item.title}</button>)}</div>
        <p className="gz-meta">共 {filtered.length} 部作品</p>{filtered.length ? <><div className="gz-grid">{filtered.slice(0, limit).map(card)}</div>{filtered.length > limit && <button className="gz-btn" onClick={() => setLimit(limit + 48)}>加载更多</button>}</> : <Empty title={route === "favorites" ? "还没有符合条件的收藏" : "没有匹配的作品"}><p>{query || filter !== "all" ? "试试其他关键词，或清除筛选。" : "添加来源并扫描，再到待整理中确认作品。"}</p><button className="gz-btn" onClick={() => { setQuery(""); setFilter("all"); if (!works.length) navigate("sources"); }}>{works.length ? "清除筛选" : "管理来源"}</button></Empty>}
      </>}
      {route === "profile" && <>
        <div className="gz-user"><div className="gz-row-icon"><User /></div><div><strong>本机用户</strong><p className="gz-meta">Genzo · Android · 本地优先</p></div></div>
        <Section title="外观"><div className="gz-seg" role="radiogroup" aria-label="主题">{(["dark", "light", "system"] as ThemeMode[]).map(mode => <button role="radio" aria-checked={theme === mode} key={mode} onClick={() => void run(async () => { await api.setSetting("theme", mode); setTheme(mode); })}>{({ dark: "深色", light: "浅色", system: "跟随系统" })[mode]}</button>)}</div></Section>
        {[{ title: "目录与来源", sub: `${sources.length} 个来源 · 授权与扫描`, route: "sources", icon: Folder }, { title: "待整理队列", sub: `${groups.length} 个分组待确认`, route: "inbox", icon: Inbox }].map(item => <button className="gz-row-card" key={item.route} onClick={() => navigate(item.route)}><span className="gz-row-icon"><item.icon /></span><span className="gz-row-main"><strong>{item.title}</strong><span className="gz-meta">{item.sub}</span></span><ChevronRight size={18} /></button>)}
        <Section title="当前预览范围"><div className="gz-panel"><p>本地目录授权、扫描索引、作品整理、收藏、个人记录和本地播放已接入。</p><p className="gz-meta">播放控件仍为原生验证界面；WebDAV 播放、自动字幕关联与更多资料管理正在接入。此预览只在电脑模拟器展示。</p></div></Section>
        <Section title="后续扩展">{futureCards}</Section>
        <button className="gz-row-card" onClick={() => navigate("diagnostics")}><CircleHelp /><span className="gz-row-main"><strong>开发验证</strong><span className="gz-meta">数据库、目录和播放器诊断</span></span><ChevronRight size={18} /></button>
        <p className="gz-footer">Genzo · 基于 Windows v0.5.0 · GPLv3</p>
      </>}
      {route === "sources" && <>
        <p className="gz-meta">授权你已下载视频的目录。扫描只建立索引，不复制视频；停用来源保留作品和个人记录。</p>
        <div className="gz-actions"><button className="gz-btn primary" disabled={busy} onClick={() => void run(() => authorize())}><Plus size={18} />添加本地目录</button><button className="gz-btn" disabled={busy} onClick={() => void run(() => authorize(undefined, true))}>登记已授权目录</button></div>
        {!sources.length && <Empty title="还没有视频来源"><p>选择目录并在系统选择器中点击“使用此文件夹”。</p></Empty>}
        {sources.map(source => { const task = tasks.find(task => task.rootId === source.id); return <section className="gz-panel gz-source" key={source.id}>
          <div className="gz-row"><Folder /><div className="gz-row-main"><strong>{source.label}</strong><span className="gz-meta">{source.kind === "saf" ? "本地授权目录" : "WebDAV 服务"}</span></div><button role="switch" aria-checked={source.enabled} aria-label={`${source.enabled ? "停用" : "启用"} ${source.label}`} className={`gz-switch ${source.enabled ? "active" : ""}`} disabled={busy} onClick={() => void run(async () => { await api.updateRoot(source.id, "video", !source.enabled); await refresh(); })}><span /></button></div>
          <div className="gz-actions"><span className={`gz-badge ${source.state === "available" && source.enabled ? "ok" : "warn"}`}>{source.enabled ? sourceStates[source.state] || source.state : "已停用"}</span><span className="gz-meta">{source.lastScannedAt ? `上次扫描 ${new Date(source.lastScannedAt).toLocaleString("zh-CN")}` : "尚未扫描"}</span></div>
          <div className="gz-actions"><button className="gz-btn" disabled={busy || !source.enabled || !!task && activeScan(task)} onClick={() => void run(async () => { await androidApi.scan(source.id); await refresh(); })}><RefreshCw size={16} />扫描</button>{source.kind === "saf" && <button className="gz-btn" disabled={busy} onClick={() => void run(() => authorize(source.id))}>重新授权</button>}</div>
          {task && <div className="gz-task"><strong>{taskStages[task.stage]}</strong><progress aria-label="扫描进度" {...(!["scanning", "queued"].includes(task.stage) ? { max: Math.max(1, task.discovered), value: task.processed } : {})} /><p className="gz-meta">已发现 {task.discovered} · 已处理 {task.processed} · 复用 {task.reused} · 目录 {task.visitedDirectories}</p>{task.errors.length > 0 && <details><summary>{task.errors.length} 项问题</summary>{task.errors.map((message, index) => <p className="gz-file-name" key={index}>{message}</p>)}</details>}{activeScan(task) ? <button className="gz-btn" disabled={busy} onClick={() => void run(async () => { await androidApi.cancel(task.id); await refresh(); })}>取消扫描</button> : ["failed", "interrupted", "cancelled"].includes(task.stage) && <button className="gz-btn" disabled={busy || !source.enabled} onClick={() => void run(async () => { await androidApi.retry(task.id); await refresh(); })}>重试失败范围</button>}</div>}
        </section>; })}
        <Section title="远程来源"><div className="gz-panel"><strong>WebDAV 与网盘服务</strong><p className="gz-meta">已有协议正在接入安卓页面与远程播放验证。通过网盘的 WebDAV 服务接入，与网盘账号/API 直连是两种方式。</p><span className="gz-badge warn">接入中</span></div></Section>
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
      {(route === "bookshelf" || route === "explore") && <Empty title={`${title} · Future`}><p>{route === "bookshelf" ? "漫画与轻小说阅读将在后续版本接入。" : "发现与推荐保留扩展位置。"}</p><button className="gz-btn" onClick={back}>返回</button></Empty>}
      {route === "diagnostics" && <AndroidPrototype />}
    </main>
    <nav className="gz-tabbar" aria-label="主导航">{tabs.map(tab => <button aria-current={primary === tab.route ? "page" : undefined} className={primary === tab.route ? "active" : ""} key={tab.route} onClick={() => navigate(tab.route)}><tab.icon size={22} /><span>{tab.title}</span></button>)}</nav>
    {toast && <div className="gz-toast" role="status">{toast}</div>}
    {busy && <div className="gz-busy" role="status"><LoaderCircle size={18} />正在处理…</div>}
    {modal && <div className="gz-scrim" onClick={() => setModal(null)}><section ref={sheet} className="gz-sheet" role="dialog" aria-modal="true" aria-labelledby="gz-dialog-title" onClick={event => event.stopPropagation()}><div className="gz-section-head"><h2 id="gz-dialog-title">{modal.kind === "edit" ? "个人记录" : "整理作品"}</h2><button className="gz-iconbtn" aria-label="关闭" onClick={() => setModal(null)}><X /></button></div>{error && <p className="gz-error" role="alert">{error}</p>}{modal.kind === "edit" ? <WorkEditor work={modal.work} busy={busy} onSave={input => void run(async () => { const updated = await api.updateWork(modal.work.id, input); setDetail(updated); await refresh(); setModal(null); setToast("个人记录已保存"); })} /> : <Organize group={modal.group} works={works} busy={busy} onRun={operation => void run(operation)} onDone={async id => { await refresh(); setModal(null); navigate(`detail/${id}`); setToast("作品整理完成"); }} />}</section></div>}
  </div>;
}
