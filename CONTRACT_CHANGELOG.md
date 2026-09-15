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

---

## 004 · 2026-09-14 · 探索后端与共享数据契约

- **变更**：新增 `ExploreSubject`、`ExploreSourceStatus`、`ExploreOverview`、`ExploreSaveInput` 共享类型，以及 `get_explore_overview`、`search_explore_subjects`、`get_explore_subject`、`save_explore_subject` 四个 Tauri Command。`src/api.ts` 对应新增 `exploreOverview`、`searchExplore`、`getExploreSubject`、`saveExploreSubject`。
- **原因**：交付 v0.2 Bangumi 探索 MVP，并切实使用用户指定的 `bangumi-data` 番组索引；保持 Open Design 正式 React 界面与 Codex 后端职责分离。
- **数据源**：`bangumi-data@0.3` 用于季度标题、中文/外文别名、放送日期、周期和 Bangumi ID；Bangumi 官方 API 用于当前番组日历、搜索、详情、封面、网络评分、排名、评分人数和收藏人数。二者均使用现有 SQLite `metadata_cache`，远端失败时只有在已有缓存的情况下才返回，并通过 `stale` / `sources.warning` 明示状态。
- **本地状态**：`ExploreSubject.inLibrary`、`favorite`、`localWorkId`、`localStatus` 来自现有 `works` 与 `work_external_ids`。`save_explore_subject` 幂等创建或更新本地作品，`status` 使用既有 `WorkStatus`，网络评分不会写入用户个人评分字段。
- **兼容性**：**向后兼容**。未新增迁移；复用 `metadata_cache`、`work_external_ids`、`works`、标签和字段锁定。`WorkMetadata` 新字段带 Serde 默认值，可读取旧缓存。未修改页面、组件、样式、路由、Mock 或 Open Design Provider 接口。
- **受影响功能 ID**：EXPLORE-001、EXPLORE-002、EXPLORE-003、EXPLORE-004（仅本地状态）、EXPLORE-005、FE-EXPLORE-001。
- **变更方**：Codex（Rust、SQLite 访问、Tauri Command、共享类型和最薄 API 适配）。

### Open Design 待接入契约

Open Design 需要在其负责的 `GenzoDataProvider` / Mock Provider 中声明同名四个方法，并让 `ExplorePage.tsx` 使用 Provider。Mock 必须继续明确标记为示例数据；Tauri Provider 只需逐方法委托上述 `src/api.ts` 方法。此条目不授权 Codex 修改这些前端文件。

---

## 005 · 2026-09-14 · 前端接入探索契约（Open Design）

- **变更**：`src/data/provider.ts` 新增探索方法（`exploreOverview` / `searchExplore` / `getExploreSubject` / `saveExploreSubject`）与 `GenzoExploreProvider` 子集；`src/data/index.ts` 新增 `getExploreProvider()` 能力访问器；`src/data/mockProvider.ts` 完整实现四个方法（示例数据，不请求网络）；`src/pages/ExplorePage.tsx` 由本地 `samples` 占位改为按 Provider 真实取数，并新增 `src/explore.ts`（纯展示辅助 + 单元测试）、`src/explore.css`。
- **原因**：接入 004 号条目交付的 Bangumi 探索后端，让正式 React 探索界面真正可用；遵守 004 的「不授权 Codex 修改前端文件」与「Open Design 负责 Provider 接口 / Mock」的分工。
- **字段**：与 `src/api.ts` 的 `get_explore_overview` / `search_explore_subjects` / `get_explore_subject` / `save_explore_subject` 一一对应，参数与返回类型直接引用 `src/types.ts` 的 `ExploreOverview` / `ExploreSubject` / `ExploreSaveInput`。**未新增或改义任何 Tauri Command，未修改 `src/api.ts` / `src/types.ts` / `src-tauri/`。**
- **兼容性**：**向后兼容**。四个探索方法在 `GenzoDataProvider` 上声明为**可选成员**，`src/data/tauriProvider.ts`（Codex 维护，本轮未改动）继续满足接口，其余命令调用方不受影响。运行期由 `getExploreProvider()` 判定：方法齐备则返回可调用子集，否则返回 `null`，页面显示明确的「尚未接入」错误态，**不伪造数据**。
- **受影响功能 ID**：EXPLORE-001、EXPLORE-002、EXPLORE-003、EXPLORE-004、EXPLORE-005、FE-EXPLORE-001、FE-PROVIDER-002。
- **变更方**：Open Design（前端）。

### 待 Codex 处理

1. 在 `src/data/tauriProvider.ts` 补齐四个委托（其余文件零改动）：

   ```ts
   exploreOverview: api.exploreOverview,
   searchExplore: api.searchExplore,
   getExploreSubject: api.getExploreSubject,
   saveExploreSubject: api.saveExploreSubject,
   ```

2. 补齐后可将 `GenzoDataProvider` 上的四个方法改为**必选**（届时 `satisfies GenzoDataProvider` 会强制约束表面），本条目的「尚未接入」错误态随之消失，前端无需再改。
3. 新的契约需求（尚未提供，界面保持禁用 + `Future`，见 `design/open-design/v1.1.2/BACKEND_CAPABILITY_MATRIX.md`）：按星期分组的放送时间表、全年 / 全量动画浏览查询、漫画探索数据源。
4. 是否将 `GenzoExploreProvider` 迁入 `contracts/` 作为正式共享契约。

---

## 006 · 2026-09-15 · 动画多源聚合、分集与探索扩展契约（Codex）

- **变更**：新增 `get_discovery_list`、`get_weekly_calendar`、`check_in_local_library`、`get_metadata_provider_statuses`、`list_anime_episodes` 五个 Tauri Command；`src/api.ts` 新增对应薄适配。`ExploreSubject` 向后兼容新增可选背景图和来源字段；新增 `WeeklyCalendar`、`MetadataProviderStatus`、`AnimeEpisodeMetadata` 类型。
- **原因**：落实用户确认的 v0.2 动画识别、多源元数据和探索后端范围，同时保持 Open Design 对页面与 Provider 接口的所有权。
- **字段**：`ExploreSubject.bannerUrl/sourceKeys/coverProvider/bannerProvider/scoreProvider`；`MetadataProviderStatus.key/label/available/configured/requiresCredential/message`；`AnimeEpisodeMetadata.provider/externalId/episodeNumber/sortNumber/title/originalTitle/description/airDate/duration/fetchedAt`。
- **持久化**：迁移 `0004_anime_episode_numbers.sql` 为 `media_files` 增加整数集数起止字段；迁移 `0005_metadata_aggregation.sql` 新增 `metadata_provider_records` 与 `anime_episodes`。继续复用 `works`、`media_files`、`work_external_ids` 和 `metadata_cache`，未建立重复媒体库表。
- **数据源语义**：Bangumi 始终为主锚点；TMDB 与 AniList 只有在标题/年份综合置信度达到 0.85 后才能补全。TMDB 需要 `metadata.tmdb_read_token` 或 `TMDB_READ_TOKEN`；AniList 使用公开 GraphQL；豆瓣返回明确不可用状态，不抓取网页或未公开接口。
- **兼容性**：**向后兼容**。Rust `WorkMetadata` 新字段使用 Serde 默认值，可读取旧缓存；TypeScript `ExploreSubject` 新字段为可选，不要求 Open Design 立即修改现有 Mock。新命令尚未加入 Open Design 拥有的 `GenzoDataProvider`，现有四个探索方法保持原语义。
- **受影响功能 ID**：INBOX-004、MATCH-001、MATCH-002、EXPLORE-001、EXPLORE-002、EXPLORE-003、EXPLORE-005、EXPLORE-007、EXPLORE-008、FE-PROVIDER-003。
- **变更方**：Codex（Rust、SQLite、共享类型与 `src/api.ts`）；未修改页面、组件、样式、路由、Mock Provider 或前端 Provider 接口。

### Open Design 后续接线

Open Design 可按正式 UI 节奏把 `discoveryList`、`weeklyCalendar`、`metadataProviderStatuses` 与 `listAnimeEpisodes` 加入其 Provider 接口和 Mock，并连接探索筛选、周时间表、设置数据源状态及详情分集区域。`manga` 分类当前会返回明确“尚未接入”错误，不得用动画数据冒充。

---

## 007 · 2026-09-15 · 探索封面 HTTPS 与本地缩略图缓存（Codex）

- **变更**：Bangumi 图片地址统一升级为 HTTPS；探索列表首次使用 Bangumi `common` 缩略图并后台缓存，后续请求优先返回本地 400×600 以内缩略图。`src/api.ts` 仅在真实 Tauri 结果为本地路径时转换为 asset URL。
- **原因**：避免 `large` 原图并发加载和 HTTP 307 跳转导致海报墙长期空白或显示破图图标。
- **字段**：没有新增或改名字段；`ExploreSubject.coverUrl` 仍为可直接展示的 URL。
- **兼容性**：向后兼容。远程缓存失败时继续返回 HTTPS 网络缩略图，不阻断探索数据；Mock Provider 和 Open Design 页面无需修改。
- **受影响功能 ID**：EXPLORE-001、EXPLORE-002、EXPLORE-003、EXPLORE-005。
- **变更方**：Codex（Rust、Tauri Command 内部处理和最薄数据适配）；未修改页面、组件、样式或 Mock。

---

## 008 · 2026-09-15 · 探索首屏多源补图与高清图片缓存（Codex）

- **变更**：本季、全年动画列表和周时间表在返回前，使用 `bangumi-data` 的 AniList ID 批量补全封面、背景图和评分；补源结果继续执行标题与年份置信度≥0.85 校验，并按条目缓存 30 天。Bangumi 详情不可用且无缓存时，改用内置 `bangumi-data` 作为明确的过期/部分主锚点，使 AniList/TMDB 补全仍可继续。封面缓存由 400×600 提升为最大 600×900，并新增背景图本地缓存；首次返回仍使用可直接展示的 HTTPS 高清源。应用启动后异步预热当前季度元数据与图片缓存，不阻塞主窗口。
- **原因**：避免探索页先显示大量空白占位、点开后才补图，并防止 Bangumi 单源 404 或短暂故障中断已有多源映射的条目。
- **字段**：无新增、删除或改名字段；继续使用 `ExploreSubject.coverUrl` / `bannerUrl` / `sourceKeys` 及现有来源字段。
- **兼容性**：**向后兼容**。无新迁移、无新 Tauri Command、无 Provider 签名变化；AniList 不可用时列表仍返回离线基础数据，不伪造封面或成功状态。超过 100 条的广域查询只合并现有缓存，不会在一次列表请求中触发无界批量网络调用。
- **受影响功能 ID**：EXPLORE-001、EXPLORE-002、EXPLORE-003、EXPLORE-005、EXPLORE-007、EXPLORE-008。
- **变更方**：Codex（Rust 数据源、聚合、缓存与契约记录）；未修改 Open Design 拥有的页面、组件、样式、Mock 或 Provider 界面。
