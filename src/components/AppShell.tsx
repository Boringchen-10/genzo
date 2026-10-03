import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  Compass,
  FolderTree,
  Heart,
  Home,
  Library,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { usePreferences, useToasts, useUi } from "../store";
import { Drawer } from "./common";
import { SettingsPanel } from "./SettingsPanel";
import { WindowTitleBar } from "./WindowTitleBar";

/* 把主题色色相换算成 rgb 三元组：--tint / --shade 在 CSS 里以 rgba(var(--tint), α)
   的形式被大量复用（描边 / 悬停 / 滚动条 / 标题栏与面板底色），直接改这两个变量，
   即可让中性色整体带着主题色的色相，界面不再是固定灰调。hsl() 与 rgb() 无法在 CSS 里
   互转，故在此计算。 */
function hslTriplet(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value);
  };
  return `${channel(0)}, ${channel(8)}, ${channel(4)}`;
}

const navigation = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/library", label: "媒体库", icon: Library },
  { to: "/bookshelf", label: "书架", icon: BookOpen },
  { to: "/explore", label: "探索", icon: Compass },
  { to: "/favorites", label: "收藏", icon: Heart },
  { to: "/sources", label: "资源库", icon: FolderTree },
  { to: "/tools", label: "工具", icon: Wrench },
  { to: "/settings", label: "设置", icon: Settings },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const theme = usePreferences((state) => state.theme);
  const accentHue = usePreferences((state) => state.accentHue);
  const glassBlur = usePreferences((state) => state.glassBlur);
  const cornerRadius = usePreferences((state) => state.cornerRadius);
  const topbarOpacity = usePreferences((state) => state.topbarOpacity);
  const shelfColumns = usePreferences((state) => state.shelfColumns);
  const messages = useToasts((state) => state.messages);
  const dismiss = useToasts((state) => state.dismiss);
  const settingsOpen = useUi((state) => state.settingsOpen);
  const openSettings = useUi((state) => state.openSettings);
  const closeSettings = useUi((state) => state.closeSettings);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      const root = document.documentElement;
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
      root.style.setProperty("--accent", `hsl(${accentHue} ${dark ? 48 : 66}% ${dark ? 62 : 30}%)`);
      root.style.setProperty("--accent-hover", `hsl(${accentHue} ${dark ? 54 : 68}% ${dark ? 70 : 25}%)`);
      root.style.setProperty("--accent-soft", `hsl(${accentHue} ${dark ? 48 : 66}% ${dark ? 62 : 30}% / .12)`);
      /* 主题色不只驱动强调元素（--accent*），还整体调和界面的中性色：
         --accent-h 供 CSS 以 hsl(var(--accent-h) …) 派生背景 / 表面 / 文字 / 描边，
         --tint / --shade 两个 rgb 三元组则被 rgba() 大量复用。色相全部跟随滑块，
         饱和度略高于极克制档，让深浅两套主题都能明显读出主题色的存在感，
         但仍住在低饱和区间，不出现高饱和色块。 */
      root.style.setProperty("--accent-h", String(accentHue));
      root.style.setProperty("--tint", dark ? hslTriplet(accentHue, 28, 92) : hslTriplet(accentHue, 52, 8));
      root.style.setProperty("--shade", dark ? hslTriplet(accentHue, 30, 6.5) : hslTriplet(accentHue, 22, 96));
      root.style.setProperty("--ui-blur", `${glassBlur}px`);
      root.style.setProperty("--ui-radius", `${cornerRadius}px`);
      root.style.setProperty("--topbar-opacity", String(Math.min(1, Math.max(0, topbarOpacity / 100))));
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, accentHue, glassBlur, cornerRadius, topbarOpacity]);

  /* 首页书架的每行作品数量：默认 7，可在设置里切换。窗口越窄允许的最大列数越小，
     取「用户选择」与「当前宽度上限」的较小值，窄窗口下不会把海报压得过小。 */
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const cap = viewportWidth <= 560 ? 2 : viewportWidth <= 760 ? 3 : viewportWidth <= 980 ? 4 : viewportWidth <= 1240 ? 5 : viewportWidth <= 1440 ? 6 : 9;
    const columns = Math.min(Math.max(4, shelfColumns), cap);
    document.documentElement.style.setProperty("--shelf-cols", String(columns));
  }, [shelfColumns, viewportWidth]);

  /* 记住每个历史条目的滚动位置：从列表点进作品详情、再返回时回到原来的位置，
     而不是每次都弹回顶部。位置随滚动实时记录，返回时按历史 key 恢复。 */
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const remember = () => scrollPositions.current.set(location.key, main.scrollTop);
    main.addEventListener("scroll", remember, { passive: true });
    return () => main.removeEventListener("scroll", remember);
  }, [location.key]);

  useLayoutEffect(() => {
    const saved = scrollPositions.current.get(location.key) ?? 0;
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      const main = mainRef.current;
      if (!main) return;
      main.scrollTo({ top: saved, left: 0 });
      /* 目标页数据可能仍在加载、内容还不够高；短暂重试直到该位置可达。 */
      if (saved > 0 && main.scrollTop < saved - 2 && attempts < 30) {
        attempts += 1;
        frame = window.requestAnimationFrame(restore);
      }
    };
    restore();
    return () => window.cancelAnimationFrame(frame);
  }, [location.key]);

  /* The settings drawer keeps the sidebar clickable, so switching pages from it
     closes the drawer first (the 设置 nav item opens it without navigating). */
  useEffect(() => {
    const ui = useUi.getState();
    if (ui.settingsOpen) ui.closeSettings();
  }, [location.pathname, location.search]);

  /* 全局键盘快捷键：`/` 直接聚焦页面搜索框，`Esc` 退出搜索，
     `g` 后接 h/e/l/b/f/r/t 跳转到首页 / 媒体库 / 书架 / 探索 / 收藏 / 资源库 / 工具。
     输入框里打字、或有弹窗接管键盘（root 被设为 inert）时不触发。 */
  useEffect(() => {
    const destinations: Record<string, string> = {
      h: "/",
      e: "/explore",
      l: "/library",
      b: "/bookshelf",
      f: "/favorites",
      r: "/sources",
      t: "/tools",
    };
    let pendingG = false;
    let gTimer = 0;
    const isTypingTarget = (target: EventTarget | null) => {
      const node = target as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) active.blur();
        return;
      }
      if (document.getElementById("root")?.inert) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "/") {
        const search = mainRef.current?.querySelector<HTMLInputElement>(
          ".search-box input, input[type='search']",
        );
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }
      if (event.key === "g" || event.key === "G") {
        pendingG = true;
        window.clearTimeout(gTimer);
        gTimer = window.setTimeout(() => {
          pendingG = false;
        }, 1500);
        return;
      }
      if (pendingG) {
        const destination = destinations[event.key.toLowerCase()];
        pendingG = false;
        window.clearTimeout(gTimer);
        if (destination) {
          event.preventDefault();
          navigate(destination);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(gTimer);
    };
  }, [navigate]);

  /* 沉浸式路由：首页与作品详情都让海报铺到标题栏 / 侧栏之后，
     顶部栏与侧栏的不透明度由设置里的「顶部栏透明度」控制，两者表现一致。 */
  const routeClass = location.pathname === "/"
    ? "is-home-route"
    : /^\/(?:library|bookshelf)\/[^/]+$/.test(location.pathname)
      ? "is-detail-route"
      : "is-workspace-route";

  return (
    <div className={`app-frame ${routeClass}`}>
      <WindowTitleBar />
      <aside className="sidebar">
        <nav className="nav-list" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon, end }) => {
            const opensSettings = to === "/settings";
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                aria-haspopup={opensSettings ? "dialog" : undefined}
                data-nav-label={label}
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={opensSettings ? (event) => { event.preventDefault(); openSettings(); } : undefined}
              >
                <Icon size={20} strokeWidth={1.8} />
                <span>{label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          <span>本地资料库</span>
          <small>v0.3.0</small>
        </div>
      </aside>
      <main ref={mainRef} className="main-content">
        <Outlet />
      </main>
      {settingsOpen ? (
        <Drawer title="设置" onClose={closeSettings}>
          <SettingsPanel />
        </Drawer>
      ) : null}
      <div className="toast-stack" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`toast toast-${message.tone}`}>
            <span>{message.text}</span>
            <button
              type="button"
              className="icon-button small"
              aria-label="关闭通知"
              data-tooltip="关闭"
              onClick={() => dismiss(message.id)}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
