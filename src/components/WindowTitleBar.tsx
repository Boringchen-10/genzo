import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { getDataProvider, MOCK_NOTICE } from "../data";
import { useToasts } from "../store";

type WindowAction = "minimize" | "maximize" | "close";

const actionErrors: Record<WindowAction, string> = {
  minimize: "无法最小化窗口",
  maximize: "无法切换窗口大小",
  close: "无法关闭窗口",
};

export function WindowTitleBar() {
  const provider = getDataProvider();
  const toast = useToasts((state) => state.push);
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  const syncMaximized = useCallback(async () => {
    if (!isTauri()) return;
    setMaximized(await getCurrentWindow().isMaximized());
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let stopResize: (() => void) | undefined;
    let stopScale: (() => void) | undefined;
    let stopFocus: (() => void) | undefined;
    const appWindow = getCurrentWindow();

    void (async () => {
      const materialSupported = await invoke<boolean>("window_material_supported");
      document.documentElement.classList.toggle("native-window-material", materialSupported);
      setMaximized(await appWindow.isMaximized());
      stopResize = await appWindow.onResized(() => void syncMaximized());
      stopScale = await appWindow.onScaleChanged(() => void syncMaximized());
      stopFocus = await appWindow.onFocusChanged(({ payload }) => setFocused(payload));
      if (disposed) {
        stopResize();
        stopScale();
        stopFocus();
      }
    })().catch(() => {
      // Browser previews do not expose the native window event bridge.
    });

    return () => {
      disposed = true;
      stopResize?.();
      stopScale?.();
      stopFocus?.();
    };
  }, [syncMaximized]);

  const runAction = async (action: WindowAction) => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    try {
      if (action === "minimize") await appWindow.minimize();
      if (action === "maximize") {
        await appWindow.toggleMaximize();
        await syncMaximized();
      }
      if (action === "close") await appWindow.close();
    } catch {
      toast(actionErrors[action], "error");
    }
  };

  const handleTitleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".window-controls, .window-tools")) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 2) {
      void runAction("maximize");
      return;
    }
    if (isTauri()) {
      void getCurrentWindow().startDragging().catch(() => toast("无法拖动窗口", "error"));
    }
  };

  return (
    <header
      className={`window-titlebar ${focused ? "" : "is-unfocused"}`}
      aria-label="窗口标题栏"
      data-tauri-drag-region
      onMouseDown={handleTitleMouseDown}
    >
      <div className="window-identity" data-tauri-drag-region>
        <img src="/genzo-icon.svg" alt="" data-tauri-drag-region />
        <span data-tauri-drag-region>Genzo</span>
      </div>
      <div className="window-drag-space" data-tauri-drag-region>
        {provider.meta.mock ? (
          <span className="provider-flag" data-tooltip={MOCK_NOTICE}>
            示例数据
          </span>
        ) : null}
      </div>
      {/* 首页工具条（作品数 / 媒体库 / 刷新 / 设置）由 HomePage 通过 portal 渲染到这里，
          位置固定在窗口控制按钮（最小化/最大化/关闭）左侧。 */}
      <div className="window-tools" id="window-titlebar-tools" />
      <div className="window-controls" aria-label="窗口控制">
        <button
          type="button"
          className="window-control"
          aria-label="最小化"
          title="最小化"
          data-tooltip="最小化"
          onClick={() => void runAction("minimize")}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="window-control window-control-maximize"
          aria-label={maximized ? "还原" : "最大化"}
          title={maximized ? "还原" : "最大化"}
          data-tooltip={maximized ? "还原" : "最大化"}
          onClick={() => void runAction("maximize")}
        >
          {maximized ? <Copy size={12} strokeWidth={1.45} /> : <Square size={11} strokeWidth={1.45} />}
        </button>
        <button
          type="button"
          className="window-control window-control-close"
          aria-label="关闭"
          title="关闭"
          data-tooltip="关闭"
          onClick={() => void runAction("close")}
        >
          <X size={15} strokeWidth={1.45} />
        </button>
      </div>
    </header>
  );
}
