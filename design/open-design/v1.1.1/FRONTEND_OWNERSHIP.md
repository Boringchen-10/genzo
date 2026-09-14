# 前端归属与 Provider 接入（前后端职责分离）

本文件定义 Open Design 与 Codex 在新协作模型下的边界，以及本轮已落地的前端资产。

## 分工

| 范围 | 归属 | 说明 |
|---|---|---|
| `src/pages/` `src/components/` `src/layouts/` `src/styles/` `src/assets/` `src/routes/` 前端 `hooks/`、前端专用 store、`App.tsx` | **Open Design** | 页面、组件、样式、路由、响应式、全部 UI 状态 |
| `src/data/`（`provider.ts` / `mockProvider.ts` / `index.ts`） | **Open Design**（接口） | 前端数据访问契约与设计期 Mock |
| `src/data/tauriProvider.ts` | **Codex** | 委托 `src/api.ts` 接入真实后端；当前为抛 `ProviderNotImplementedError` 的占位 |
| `src-tauri/`、Rust、SQLite、迁移、Tauri Commands、`contracts/`、后端生成类型 | **Codex** | Open Design 只读，不得修改 |
| `src/api.ts`、`src/types.ts` | **Codex** | Open Design 只读引用 |
| `src/store.ts` | 前端 | 已核对为 zustand `persist` 外观偏好 + Toast（localStorage），非后端状态 |
| `package.json`、构建配置、依赖 | **不动** | 确需变更须先说明并获授权 |

## 已落地文件

- `src/data/provider.ts`：`GenzoDataProvider` 接口、`ProviderMeta`（`kind: "mock" | "tauri"`）、`ProviderNotImplementedError`。
- `src/data/mockProvider.ts`：`createMockProvider()` + `MOCK_NOTICE`；系统级操作（导入封面、检测/测试工具、启动播放、打开目录）抛 `ProviderNotImplementedError`，**不伪造成功**。
- `src/data/tauriProvider.ts`：占位实现，每方法显式失败，`satisfies GenzoDataProvider` 保证表面一致。
- `src/data/index.ts`：`getDataProvider()` 当前固定返回 Mock；`isTauriRuntime()` 供 Codex 切换。

## 视觉与验收

- 沿用冻结视觉令牌（深色 `#090d0f`、薄荷绿 `#75d2ad`、圆角 ≤8px、220ms 动效、内联 1.8px 线性 SVG）。
- 交付边界：不渲染、不截图、不预览、不做生成后检查；人工验收走 `SCREENSHOT_CHECKLIST.md`（1024×640 / 1366×768 / 1920×1080）。

## 本轮未处理（需确认）

- Provider 接口是否迁入 `contracts/` 作为正式共享契约。
- UI 页面接入 Mock Provider 的批量改造尚未开始（下一步）。
