import { useEffect, useRef } from "react";
import {
  Compass,
  Heart,
  Home,
  Library,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { usePreferences, useToasts } from "../store";
import { WindowTitleBar } from "./WindowTitleBar";

const navigation = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/explore", label: "探索", icon: Compass },
  { to: "/library", label: "媒体库", icon: Library },
  { to: "/favorites", label: "收藏", icon: Heart },
  { to: "/tools", label: "工具", icon: Wrench },
  { to: "/settings", label: "设置", icon: Settings },
];

export function AppShell() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const theme = usePreferences((state) => state.theme);
  const accentHue = usePreferences((state) => state.accentHue);
  const glassBlur = usePreferences((state) => state.glassBlur);
  const cornerRadius = usePreferences((state) => state.cornerRadius);
  const messages = useToasts((state) => state.messages);
  const dismiss = useToasts((state) => state.dismiss);

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
      root.style.setProperty("--ui-blur", `${glassBlur}px`);
      root.style.setProperty("--ui-radius", `${cornerRadius}px`);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, accentHue, glassBlur, cornerRadius]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname, location.search]);

  return (
    <div className={`app-frame ${location.pathname === "/" ? "is-home-route" : "is-workspace-route"}`}>
      <WindowTitleBar />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <strong>Genzo</strong>
            <span>MEDIA LIBRARY</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} aria-label={label} data-nav-label={label} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon size={20} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
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
