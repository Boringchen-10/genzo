import { useCallback, useEffect, useState } from "react";
import { Database, FolderOpen, HardDrive, RotateCcw } from "lucide-react";
import { dataProvider as api } from "../data";
import { ErrorState, LoadingState } from "./common";
import { usePreferences, useToasts } from "../store";
import type { AppInfo, ThemeMode } from "../types";
import { getErrorMessage } from "../utils";
import { PersonalSyncPanel } from "./PersonalSyncPanel";

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

export function SettingsPanel() {
  const theme = usePreferences((state) => state.theme);
  const accentHue = usePreferences((state) => state.accentHue);
  const glassBlur = usePreferences((state) => state.glassBlur);
  const cornerRadius = usePreferences((state) => state.cornerRadius);
  const topbarOpacity = usePreferences((state) => state.topbarOpacity);
  const shelfColumns = usePreferences((state) => state.shelfColumns);
  const setTheme = usePreferences((state) => state.setTheme);
  const setAccentHue = usePreferences((state) => state.setAccentHue);
  const setGlassBlur = usePreferences((state) => state.setGlassBlur);
  const setCornerRadius = usePreferences((state) => state.setCornerRadius);
  const setTopbarOpacity = usePreferences((state) => state.setTopbarOpacity);
  const setShelfColumns = usePreferences((state) => state.setShelfColumns);
  const resetAppearance = usePreferences((state) => state.resetAppearance);
  const toast = useToasts((state) => state.push);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [tmdbToken, setTmdbToken] = useState("");
  const [savingTmdb, setSavingTmdb] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"theme" | "download">("theme");
  const darkAppearance = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [appInfo, hiddenSetting, token] = await Promise.all([api.appInfo(), api.getSetting("scan.include_hidden"), api.getSetting("metadata.tmdb_read_token")]);
      setInfo(appInfo);
      setIncludeHidden(hiddenSetting === "true");
      setTmdbToken(token ?? "");
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

  const saveTmdb = async () => {
    setSavingTmdb(true);
    try {
      await api.setSetting("metadata.tmdb_read_token", tmdbToken.trim());
      toast(tmdbToken.trim() ? "TMDB 凭据已保存，识别时验证连接" : "TMDB 凭据已清除", "success");
    } catch (saveError: unknown) { toast(getErrorMessage(saveError), "error"); }
    finally { setSavingTmdb(false); }
  };

  const reset = () => {
    resetAppearance();
    void api.setSetting("theme", "system").catch((saveError: unknown) => toast(getErrorMessage(saveError), "error"));
    toast("外观已恢复默认", "success");
  };

  return (
    <div className="settings-page">
      <div className="settings-drawer-tabs" role="tablist" aria-label="设置分类">
        <button className={tab === "theme" ? "active" : ""} type="button" role="tab" aria-selected={tab === "theme"} onClick={() => setTab("theme")}>主题</button>
        <button className={tab === "download" ? "active" : ""} type="button" role="tab" aria-selected={tab === "download"} onClick={() => setTab("download")}>下载与备份</button>
      </div>

      {tab === "theme" ? (
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
          <small>作为强调色，并整体调和界面底色、面板与描边的色相，让配色保持统一。</small>
        </div>

        <div className="setting">
          <label htmlFor="blurRange">玻璃与背景模糊 <output>{glassBlur}px</output></label>
          <input id="blurRange" type="range" min="0" max="48" value={glassBlur} onChange={(event) => setGlassBlur(Number(event.target.value))} />
          <small>控制侧栏、浮层的玻璃模糊，以及首页 / 详情页海报背景的模糊程度（拖到 0 背景完全清晰）。</small>
        </div>

        <div className="setting">
          <label htmlFor="radiusRange">圆角大小 <output>{cornerRadius}px</output></label>
          <input id="radiusRange" type="range" min="0" max="24" value={cornerRadius} onChange={(event) => setCornerRadius(Number(event.target.value))} />
          <small>0 为直角，数值越大越圆润。</small>
        </div>

        <div className="setting">
          <label htmlFor="topbarRange">顶部栏透明度 <output>{topbarOpacity}%</output></label>
          <input id="topbarRange" type="range" min="0" max="100" value={topbarOpacity} onChange={(event) => setTopbarOpacity(Number(event.target.value))} />
          <small>0% 完全透明，让顶部栏与侧栏融入首页海报背景；调高更易读。</small>
        </div>

        <div className="setting">
          <label htmlFor="shelfColsRange">每行作品数量 <output>{shelfColumns} 个</output></label>
          <input id="shelfColsRange" type="range" min="5" max="9" value={shelfColumns} onChange={(event) => setShelfColumns(Number(event.target.value))} />
          <small>首页「最近添加」「观看记录」网格每行的作品数量，窗口变窄时会自动减少。</small>
        </div>

        <button type="button" className="button secondary icon-text settings-reset" onClick={reset}><RotateCcw size={15} />恢复默认</button>
      </section>
      ) : (
        <>
          {loading ? <LoadingState label="正在读取本地设置" /> : null}
          {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
          <PersonalSyncPanel />
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
          <div className="setting" aria-label="元数据来源">
            <label htmlFor="tmdbToken">TMDB API Read Access Token</label>
            <input id="tmdbToken" type="password" autoComplete="off" maxLength={512} value={tmdbToken} onChange={event => setTmdbToken(event.target.value)} placeholder="在 TMDB 账户的 API 设置中获取" />
            <small>用于电影、电视剧的中文资料、海报和分集识别；也用于动漫补充资料。清空后保存可停用。</small>
            <button type="button" className="button secondary" disabled={savingTmdb} onClick={() => void saveTmdb()}>{savingTmdb ? "保存中…" : "保存 TMDB 凭据"}</button>
            <small>This product uses the TMDB API but is not endorsed or certified by TMDB.</small>
          </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
