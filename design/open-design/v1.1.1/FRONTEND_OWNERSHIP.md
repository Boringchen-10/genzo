# 前端归属与 Provider 接入（前后端职责分离）

本文件定义 Open Design 与 Codex 在新协作模型下的边界，以及已落地的前端资产。

## 路径说明（避免误判正式来源）

- **正式 Genzo 仓库**：`H:\二次元阅读器`。授权范围内的前端代码（`src/` 下的页面、组件、样式、路由、前端 Provider 层）直接写在这里，**它就是最终前端代码**，Codex 只接入真实数据与业务能力。
- **Open Design 应用数据目录**：`…\Open Design\namespaces\release-stable-win\data\projects\3c549762-06b7-488d-9932-b15a40d171a8`。保存冻结的 v1 基线、`v1.1` / `v1.1.1` 等设计版本与文档副本，用于预览与对照。
- 两份不是同一来源：**正式前端以 `H:\二次元阅读器` 为准**；Open Design 目录中的 HTML 原型是设计参考与历史基线，不再作为“等待 Codex 重写”的交付缓冲。

## 分工

| 范围 | 归属 | 说明 |
|---|---|---|
| `src/pages/` `src/components/` `src/layouts/` `src/styles/` `src/assets/` `src/routes/` 前端 `hooks/`、`App.tsx`、与 UI 展示/交互直接相关的 TS | **Open Design** | 页面、组件、样式、路由、响应式、全部 UI 状态 |
| `src/store.ts` | **Open Design**（前端展示层，已确认归属） | 仅限外观与纯界面状态：`theme`、`libraryView`、`accentHue`、`glassBlur`、`cornerRadius`、Toast、Drawer/Overlay/Tab 等。**禁止**写入媒体库真实数据、扫描任务与结果、识别/匹配业务状态、`invoke`、数据库读写、外部播放器启动、后端缓存或网络请求等应由 Provider 管理的领域数据。若某项设置将来需要 SQLite 或跨设备持久化，先登记 `NEW_REQUIRED` / `NEEDS_CONFIRMATION`，不得把 `localStorage` 当作正式后端持久化方案。 |
| `src/data/provider.ts` | **Open Design**（接口） | 只维护接口与 Provider 选择，不加入视觉逻辑 |
| `src/data/mockProvider.ts` | **Open Design** | 设计期示例数据，导出 `MOCK_NOTICE`，界面必须显式标注 |
| `src/data/tauriProvider.ts` | **Codex** | 接入真实后端（委托 `src/api.ts`）；Open Design **不得修改** |
| `src/data/index.ts` | **Open Design** | 按环境选择 Provider（桌面壳 → Tauri，浏览器 → Mock） |
| `src-tauri/`、Rust、SQLite、迁移、Tauri Commands、后端业务逻辑、`contracts/` 已确认契约、后端生成的 TS 类型 | **Codex** | Open Design 只读，不得修改 |
| `src/api.ts`、`src/types.ts`、`src/services/backend/` | **Codex** | Open Design 只读引用，不得改实现 |
| `package.json`、构建配置、依赖 | **不动** | 确需变更须先说明必要性并获授权 |

共享契约发生变化时，先更新 `CONTRACT_CHANGELOG.md`（原因、字段、兼容性、受影响功能 ID），破坏性修改不得单方面进行。

## 已落地文件

- `src/data/provider.ts`：`GenzoDataProvider` 接口、`ProviderMeta`（`kind: "mock" | "tauri"`、`mock` 标记、`label`）、`ProviderNotImplementedError`。
- `src/data/mockProvider.ts`：`createMockProvider()` + `MOCK_NOTICE`；系统级操作（导入封面、检测/测试工具、启动播放、打开目录）抛 `ProviderNotImplementedError`，**不伪造成功**。
- `src/data/tauriProvider.ts`：Codex 的占位实现，每个方法显式失败（`satisfies GenzoDataProvider` 保证表面一致）。
- `src/data/index.ts`：`getDataProvider()` 单例，按 `isTauriRuntime()` 选择；导出 `dataProvider` 供页面使用。
- UI 接入：9 个页面/组件的取数入口从 `src/api.ts` 切换为 `dataProvider`（`import { dataProvider as api } from "../data"`），调用点未改动。
- Mock 标记：`WindowTitleBar` 在 `provider.meta.mock` 为真时显示「示例数据」标记，tooltip 为 `MOCK_NOTICE`。

## 运行期状态与过渡说明

- 桌面壳运行时选择 **Tauri Provider**；在 Codex 完成 `tauriProvider.ts` 之前，数据操作会抛出 `ProviderNotImplementedError`（明确报错，不伪造成功）。
- 浏览器 / 设计预览选择 **Mock Provider**，界面显示「示例数据」标记。
- 过渡期结束条件：Codex 实现 `tauriProvider.ts`（逐方法委托 `src/api.ts`）后，桌面壳即可恢复正常数据读写，UI 无需改动。

## Git 约定

- 工作分支：`design/open-design-frontend`，使用 Conventional Commits 原子提交。
- 仓库 `.git` 归属异常，`git` 命令仅在单次调用中使用 `git -c safe.directory="H:/二次元阅读器" …`；**不得**修改全局配置，**不得**执行 `reset`、覆盖式 `checkout`、`clean` 等可能丢失用户现有修改的操作。
- 工作区中用户已有的未提交修改一律保留，不回退、不覆盖。

## 视觉与验收

- 沿用冻结视觉令牌（深色 `#090d0f`、薄荷绿 `#75d2ad`、圆角 ≤8px、220ms 动效、内联 1.8px 线性 SVG）。
- 本轮不生成截图，**也不得将视觉验收标记为已通过**；待验收状态保留在 `SCREENSHOT_CHECKLIST.md`，由开发侧在 1024×640 / 1366×768 / 1920×1080 统一完成。

## 待确认

- Provider 接口是否迁入 `contracts/` 作为正式共享契约（由 Codex 确认，Open Design 不单方面改动）。
