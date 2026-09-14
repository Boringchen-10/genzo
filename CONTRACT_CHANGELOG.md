# CONTRACT_CHANGELOG

共享数据契约与前后端边界的变更记录。字段：序号 / 日期 / 变更 / 原因 / 字段 / 兼容性 / 受影响功能 ID / 变更方。

---

## 001 · 2026-09-14 · 前端新增数据 Provider 契约层

- **变更**：新增前端数据访问契约 `src/data/provider.ts`（`GenzoDataProvider` 接口 + `ProviderMeta` + `ProviderNotImplementedError`），并提供 `src/data/mockProvider.ts`（设计期 Mock，显式标记）、`src/data/tauriProvider.ts`（占位，由 Codex 实现）、`src/data/index.ts`（选择入口）。
- **原因**：确立前后端职责分离——Open Design 拥有正式前端 UI，Codex 只负责让真实数据与业务能力通过稳定接口接入；避免“导出 HTML 后再由 Codex 重写前端”的重复流程。
- **字段**：接口表面与 `src/api.ts` 命令一一对应（listWorks / getWork / createWork / createWorkFromMedia / updateWork / deleteWork / listUnassignedMedia / listUnassignedGroups / attachMedia / detachMedia / importCover / listRoots / addRoot / updateRoot / deleteRoot / scanRoot / listScanJobs / listTools / createTool / updateTool / deleteTool / detectTools / testTool / launchMedia / openMediaDirectory / dashboard / appInfo / openDataDirectory / getSetting / setSetting / recognizeMedia / recognizeUnmatched / listMatchCandidates / confirmMatch / cancelMatch / setFieldLock）。**未新增或改义任何 Tauri Command。**
- **兼容性**：**向后兼容**。纯新增文件与前端的只读引用；未修改 `src/api.ts`、`src/types.ts`、`src/services/backend/`、`contracts/` 或任何 Rust / SQLite / 迁移。既有命令调用方不受影响。
- **受影响功能 ID**：FE-PROVIDER-001、FE-MOCK-001、FE-GAP-001（登记于 `design/open-design/v1.1.1/BACKEND_CAPABILITY_MATRIX.md`）。
- **变更方**：Open Design（前端）。

### 待 Codex 确认

1. Provider 接口是否迁入 `contracts/` 并作为正式共享契约（若迁入，Open Design 不再直接修改该文件，改由契约变更流程更新）。
2. `tauriProvider.ts` 的实现方式：内部委托 `src/api.ts` 现有封装，逐方法替换占位实现。
3. `src/store.ts` 归属确认：现为纯前端偏好（外观）+ Toast，建议保留在前端范围。

---

## 002 · 2026-09-14 · UI 接入 Provider（按运行环境选择）

- **变更**：前端 UI 的取数入口由 `src/api.ts` 切换为 Provider 层——`src/data/index.ts` 新增按环境选择（`isTauriRuntime()` → `createTauriProvider()`，否则 `createMockProvider()`）与单例导出 `dataProvider`；9 个页面/组件（`HomePage`、`Explore` 之外的 `LibraryPage`、`FavoritesPage`、`ToolsPage`、`SettingsPage`、`ScanPage`、`WorkDetailPage`、`WorkForm`、`RecognitionDialog`）改为 `import { dataProvider as api } from "../data"`；`WindowTitleBar` 在 `provider.meta.mock` 为真时显示「示例数据」标记（tooltip = `MOCK_NOTICE`）。
- **原因**：落实前后端职责分离——前端只依赖稳定接口，数据来源由 Provider 决定，Codex 无需重写任何 UI。
- **字段**：无新增字段。调用点与参数保持不变（`api.listWorks()` 等语义与 `src/api.ts` 一致）。**未新增或改义任何 Tauri Command，未修改 `src/api.ts` / `src/types.ts` / `src/store.ts` / 后端与迁移。**
- **兼容性**：**接口向后兼容**；运行期行为在有条件的前提下变化——桌面壳现在通过 `tauriProvider.ts` 取数，而该文件当前是 Codex 的占位实现（抛 `ProviderNotImplementedError`），因此**在 Codex 完成 `tauriProvider.ts` 之前，桌面壳内的数据操作会明确报错**（不伪造成功）；浏览器/设计预览走 Mock 并显示「示例数据」标记。
- **受影响功能 ID**：FE-PROVIDER-001、FE-PROVIDER-002、FE-MOCK-002。
- **变更方**：Open Design（前端）。

### 待 Codex 处理

1. 实现 `src/data/tauriProvider.ts`：逐方法委托 `src/api.ts` 现有封装，替换占位实现，桌面壳即可恢复正常读写。
2. 确认 `ProviderMeta.label` / `mock` 的取值是否需与设置页展示统一。
3. 若 Provider 接口迁入 `contracts/`，按契约变更流程同步本文件。

---

## 003 · 2026-09-14 · Codex 完成 Tauri Provider 实现（前端一行未改）

- **变更**：Codex 提交 `adcc117 feat(data): implement tauri data provider`，将 `src/data/tauriProvider.ts` 从占位实现替换为逐方法委托 `src/api.ts`（`listWorks: api.listWorks` … `setFieldLock: api.setFieldLock`，并以 `satisfies GenzoDataProvider` 约束表面）。
- **原因**：落实前后端职责分离——后端接入由 Codex 完成，前端 UI 不因接入真实数据而改动。
- **字段**：无新增或变更字段；接口表面与 002 号条目登记的完全一致（35 个方法）。
- **兼容性**：**向后兼容**。`src/data/provider.ts`、`src/data/index.ts`、`src/data/mockProvider.ts` 与全部页面/组件**零改动**；`src/api.ts`、`src/types.ts`、`src-tauri/`、迁移与契约均未改动。
- **受影响功能 ID**：FE-PROVIDER-001、FE-PROVIDER-002 —— 待办项「桌面壳数据操作抛 `ProviderNotImplementedError`」已解除；桌面壳现可正常读写真实数据，浏览器/设计预览仍走 Mock 并显示「示例数据」。
- **变更方**：Codex（后端接入）；Open Design 仅做只读核对，未修改该文件。

### 核对结论（Open Design，只读）

- `src/data/tauriProvider.ts` 导入 `api` 并逐方法委托，未新增或改义任何 Tauri Command。
- 除 `ExplorePage.tsx`（本地 `samples` 常量，登记为 FE-EXPLORE-001）外，全部页面/组件的取数入口均为 `../data`，无页面再直接引用 `src/api.ts`。
- 集成未要求任何 UI 变更：无冲突需上报。
