import { useCallback, useEffect, useState } from "react";
import { Database, FolderOpen, HardDrive, Info, Monitor, Moon, Sun } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, PageHeader } from "../components/common";
import { usePreferences, useToasts } from "../store";
import type { AppInfo, ThemeMode } from "../types";
import { getErrorMessage } from "../utils";

export function SettingsPage() {
  const theme = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  const toast = useToasts((state) => state.push);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [appInfo, hiddenSetting] = await Promise.all([api.appInfo(), api.getSetting("scan.include_hidden")]);
      setInfo(appInfo);
      setIncludeHidden(hiddenSetting === "true");
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const updateTheme = async (value: ThemeMode) => {
    setTheme(value);
    try {
      await api.setSetting("theme", value);
      toast("主题设置已保存", "success");
    } catch (saveError: unknown) {
      toast(getErrorMessage(saveError), "error");
    }
  };
  const updateHidden = async (value: boolean) => {
    try {
      await api.setSetting("scan.include_hidden", String(value));
      setIncludeHidden(value);
      toast("扫描设置已保存", "success");
    } catch (saveError: unknown) {
      toast(getErrorMessage(saveError), "error");
    }
  };
  const openData = async () => {
    try {
      await api.openDataDirectory();
    } catch (openError: unknown) {
      toast(getErrorMessage(openError), "error");
    }
  };

  return (
    <div className="page workspace-page settings-page">
      <PageHeader title="设置" description="主题、本地数据位置和扫描行为" />
      {loading ? <LoadingState label="正在读取设置" /> : null}
      {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
      {!loading && info ? (
        <div className="settings-layout">
          <section className="settings-section">
            <div className="settings-heading"><Monitor size={19} /><div><h2>外观</h2><p>默认跟随 Windows 的浅色或深色模式。</p></div></div>
            <div className="setting-row">
              <div><strong>主题</strong><span>更改会立即生效</span></div>
              <div className="theme-choice" role="radiogroup" aria-label="主题模式">
                {([
                  ["system", "跟随系统", Monitor],
                  ["light", "浅色", Sun],
                  ["dark", "深色", Moon],
                ] as const).map(([value, label, Icon]) => <button type="button" role="radio" aria-checked={theme === value} className={theme === value ? "active" : ""} key={value} onClick={() => void updateTheme(value)}><Icon size={16} />{label}</button>)}
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-heading"><HardDrive size={19} /><div><h2>扫描</h2><p>扫描仅读取文件元数据。</p></div></div>
            <div className="setting-row">
              <div><strong>包含隐藏文件</strong><span>默认忽略以点开头或带 Windows 隐藏属性的文件</span></div>
              <label className="switch-field"><input type="checkbox" checked={includeHidden} onChange={(e) => void updateHidden(e.target.checked)} /><span className="switch" /><span>{includeHidden ? "包含" : "忽略"}</span></label>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-heading"><Database size={19} /><div><h2>本地数据</h2><p>数据库和封面信息只保存在这台电脑上。</p></div></div>
            <div className="path-setting"><div><strong>数据库</strong><code>{info.databasePath}</code></div></div>
            <div className="path-setting"><div><strong>封面缓存</strong><code>{info.coverCachePath}</code></div></div>
            <div className="setting-row"><div><strong>数据目录</strong><span>{info.dataDirectory}</span></div><button type="button" className="button secondary icon-text" onClick={() => void openData()}><FolderOpen size={16} />打开目录</button></div>
          </section>

          <section className="settings-section">
            <div className="settings-heading"><Info size={19} /><div><h2>关于</h2><p>Genzo 是本地优先的 ACGN 统一媒体库。</p></div></div>
            <div className="setting-row"><div><strong>当前版本</strong><span>Genzo v{info.version}</span></div><span className="local-badge">本地模式</span></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
