import { useCallback, useEffect, useState } from "react";
import { Database, FolderOpen, HardDrive, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { dataProvider as api } from "../data";
import { Drawer, ErrorState, LoadingState } from "../components/common";
import { usePreferences, useToasts } from "../store";
import type { AppInfo, ThemeMode } from "../types";
import { getErrorMessage } from "../utils";

const hueToHex = (hue: number, dark: boolean) => {
  const saturation = dark ? 0.48 : 0.66;
  const lightness = dark ? 0.62 : 0.3;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const match = lightness - chroma / 2;
  return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
};

export function SettingsPage() {
  const navigate = useNavigate();
  const theme = usePreferences((state) => state.theme);
  const accentHue = usePreferences((state) => state.accentHue);
  const glassBlur = usePreferences((state) => state.glassBlur);
  const cornerRadius = usePreferences((state) => state.cornerRadius);
  const setTheme = usePreferences((state) => state.setTheme);
  const setAccentHue = usePreferences((state) => state.setAccentHue);
  const setGlassBlur = usePreferences((state) => state.setGlassBlur);
  const setCornerRadius = usePreferences((state) => state.setCornerRadius);
  const resetAppearance = usePreferences((state) => state.resetAppearance);
  const toast = useToasts((state) => state.push);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const darkAppearance = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

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

  const reset = () => {
    resetAppearance();
    void api.setSetting("theme", "system").catch((saveError: unknown) => toast(getErrorMessage(saveError), "error"));
    toast("外观已恢复默认", "success");
  };

  return (
    <>
      <div className="settings-stage" aria-hidden="true" />
      <Drawer title="设置" onClose={() => navigate(-1)}>
        <div className="settings-page">
          <div className="settings-drawer-tabs" role="tablist" aria-label="设置分类">
            <button className="active" type="button" role="tab" aria-selected="true">主题</button>
            <button type="button" role="tab" aria-selected="false" disabled title="Future：下载与备份需要新增后端">下载与备份 <span className="future-badge">Future</span></button>
          </div>

          <section className="settings-panel" aria-label="主题设置">
            <div className="setting">
              <label>主题</label>
              <div className="theme-choice" role="radiogroup" aria-label="主题模式">
                {([
                  ["dark", "深色"],
                  ["light", "浅色"],
                  ["system", "跟随系统"],
                ] as const).map(([value, label]) => (
                  <button type="button" role="radio" aria-checked={theme === value} className={theme === value ? "active" : ""} key={value} onClick={() => void updateTheme(value)}>
                    {label}
                  </button>
                ))}
              </div>
              <small>深色、浅色，或跟随系统外观。</small>
            </div>

            <div className="setting">
              <label htmlFor="accentHue">主题色 <output>{hueToHex(accentHue, darkAppearance)}</output></label>
              <div className="accent-row">
                <span className="accent-preview" aria-hidden="true" />
                <input id="accentHue" type="range" min="0" max="359" value={accentHue} onChange={(event) => setAccentHue(Number(event.target.value))} />
              </div>
              <small>用于选中状态、进度与主要操作。</small>
            </div>

            <div className="setting">
              <label htmlFor="blurRange">玻璃模糊 <output>{glassBlur}px</output></label>
              <input id="blurRange" type="range" min="0" max="48" value={glassBlur} onChange={(event) => setGlassBlur(Number(event.target.value))} />
              <small>控制侧栏、浮层和工具表面的背景模糊强度。</small>
            </div>

            <div className="setting">
              <label htmlFor="radiusRange">圆角大小 <output>{cornerRadius}px</output></label>
              <input id="radiusRange" type="range" min="0" max="24" value={cornerRadius} onChange={(event) => setCornerRadius(Number(event.target.value))} />
              <small>0 为直角，数值越大越圆润。</small>
            </div>

            <button type="button" className="button secondary icon-text settings-reset" onClick={reset}><RotateCcw size={15} />恢复默认</button>
          </section>

          {loading ? <LoadingState label="正在读取本地设置" /> : null}
          {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
          {!loading && info ? (
            <section className="settings-local" aria-label="本地设置">
              <div className="settings-local-head"><HardDrive size={17} /><div><h2>本地设置</h2><p>扫描和数据均只作用于这台电脑。</p></div></div>
              <div className="setting compact-setting">
                <label htmlFor="includeHidden">包含隐藏文件</label>
                <label className="switch-field"><input id="includeHidden" type="checkbox" checked={includeHidden} onChange={(event) => void updateHidden(event.target.checked)} /><span className="switch" /><span>{includeHidden ? "包含" : "忽略"}</span></label>
              </div>
              <div className="setting local-paths">
                <label><span>数据位置</span><Database size={15} /></label>
                <code title={info.databasePath}>{info.databasePath}</code>
                <code title={info.coverCachePath}>{info.coverCachePath}</code>
                <button type="button" className="button secondary icon-text" onClick={() => void openData()}><FolderOpen size={15} />打开数据目录</button>
                <small>Genzo v{info.version} · 本地模式</small>
              </div>
            </section>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
