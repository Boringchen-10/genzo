# Genzo UI Design v1.1.2 — Backend Capability Matrix

版本：v1.1.2  
日期：2026-09-14（**2026-09-16 更新：动画详情与排行榜前端接线完成，见文末 FE-* 登记**）  
证据来源：只读核对 `H:\二次元阅读器`（`src-tauri/src/commands.rs`、`src/api.ts`、`src/types.ts`、`src-tauri/src/{metadata,bangumi,anime_parser,grouping,scanner,launcher,explore,metadata_aggregator}.rs`、迁移 `0001_initial.sql` / `0002_metadata_matching.sql` / `0007_anime_file_structure.sql`；契约记录见 `CONTRACT_CHANGELOG.md` 012）

状态枚举：EXISTING_VERIFIED / EXISTING_PARTIAL / NEW_REQUIRED / MOCK_ONLY / FUTURE / NEEDS_CONFIRMATION

## 命令命名更正

正式 **Tauri command 为 `recognize_media_file`**（单文件识别）。`recognize_media` 只是 `metadata.rs` 的 **Rust 内部函数名**，不是前端 command，不得写成命令。

已核实命令：`recognize_media_file`、`recognize_unmatched_media`、`list_match_candidates`、`confirm_match_candidate`、`cancel_match_candidates`、`set_work_field_lock`、`scan_library_root`、`list_scan_jobs`、`create_work_from_media`、`attach_media_file`、`detach_media_file`、`launch_media`、`open_media_directory`。

## 逐项能力

| 功能 ID | 页面 | 操作 | 状态 | 证据 / 说明 |
|---|---|---|---|---|
| SHELL-001 | 全局 | 侧栏导航、页面切换 | MOCK_ONLY | 纯前端路由，无后端 |
| SHELL-002 | 标题栏 | 拖动 / 最小化 / 最大化 / 关闭 | FUTURE | 需桌面壳（Tauri）实现；HTML 原型不模拟 |
| HOME-001 | 首页 | 最近添加、作品统计、收藏 | EXISTING_VERIFIED | `get_dashboard`、`list_works`；`works` / `works.favorite` |
| HOME-002 | 首页 | 继续观看与播放进度 | NEW_REQUIRED | 无进度表与进度命令 |
| LIBRARY-001 | 媒体库 | 来源 / 类型 / 收藏筛选 | EXISTING_PARTIAL | `list_works` 返回 tags/favorite/mediaCount；服务端过滤参数缺失 |
| LIBRARY-002 | 媒体库 | 本地文件夹来源增删启停 | EXISTING_VERIFIED | `list/add/update/delete_library_root`；`library_roots` |
| LIBRARY-003 | 媒体库 | WebDAV 来源 | FUTURE | 无协议实现（界面已禁用并标 Future） |
| LIBRARY-004 | 媒体库 | 网盘来源 / 授权 | FUTURE | 无 provider/OAuth（界面已禁用并标 Future） |
| SCAN-001 | 媒体库 | 扫描目录 | EXISTING_VERIFIED | `scan_library_root`、`list_scan_jobs`；`scan_jobs` |
| SCAN-002 | 媒体库 | 查看最终统计与错误列表 | EXISTING_VERIFIED | `scan_library_root -> ScanResult`、`scan_jobs.errors_json` |
| SCAN-003 | 媒体库 | 重新扫描整个目录 | EXISTING_VERIFIED | 再次调用 `scan_library_root`（整目录重扫） |
| SCAN-004 | 媒体库 | 单个失败项重试 | NEW_REQUIRED | 无按失败项重试的能力 |
| SCAN-005 | 媒体库 | 扫描实时百分比 | NEW_REQUIRED | 扫描只在结束时返回最终统计，无进度事件 |
| SCAN-006 | 媒体库 | 目录组数量统计 | NEW_REQUIRED | 无目录组统计字段 |
| INBOX-001 | 待整理 | 未整理媒体分组 | EXISTING_VERIFIED | `list_unassigned_media`、`list_unassigned_media_groups`；`UnassignedMediaGroup` |
| INBOX-002 | 待整理 | 从媒体组创建作品并关联组内文件 | EXISTING_VERIFIED | `create_work_from_media`、`attach_media_file` |
| INBOX-003 | 待整理 | 确认候选后关联组内文件 | EXISTING_VERIFIED | `confirm_match_candidate` + `attach_media_file` |
| INBOX-004 | 待整理 | 基于整个作品组的标题 / 季度 / 别名综合识别 | EXISTING_PARTIAL → NEW_REQUIRED 扩展 | 现有为**文件级**识别（`recognize_media_file`、`recognize_unmatched_media`）与文件名解析（`anime_parser.rs`）；整组综合识别与别名索引需新增。**不得笼统写成完全不存在** |
| INBOX-005 | 待整理 | 批量确认 / 批量重新识别 / 忽略 | NEW_REQUIRED | 无批量命令（界面禁用于 Future 入口） |
| INBOX-006 | 待整理 / 作品详情 | 逐集手动映射保存 | **EXISTING_VERIFIED**（前端已接入） | `set_media_episode`；迁移 `0007_anime_file_structure.sql` 的 `media_episode_links`（自动 `parsed` 链接 + 用户 `manual` 覆盖），传 `null` 即解除映射 |
| INBOX-007 | 待整理 | 漫画「作品 → 卷/话 → 图片」 | EXISTING_PARTIAL（基础聚合）→ NEW_REQUIRED（完整模型） | 已有基础漫画目录聚合与下钻；完整卷/话/图片结构化模型待建 |
| DETAIL-001 | 作品详情 | 读取作品 | EXISTING_VERIFIED | `get_work`；`WorkDetail` |
| DETAIL-002 | 作品详情 | 官方分集 + 多个本地版本 | **EXISTING_VERIFIED**（前端已接入） | `get_anime_work_structure`；`AnimeWorkStructure.episodes[].localFiles`；迁移 `0007_anime_file_structure.sql` 的 `media_episode_links`。多个本地压制版本可关联同一官方分集，**不得按集数去重删除** |
| DETAIL-003 | 作品详情 | 关联作品 / 季度 | **EXISTING_VERIFIED**（前端已接入） | `AnimeWorkStructure.seasons`（`relation` / `seasonNumber` / `localWorkId` / `current`）。来自 Bangumi **关联条目**，不保证都是季度：`seasonNumber` 为空时**不得**称「第 N 季」 |
| DETAIL-006 | 作品详情 | 刷新元数据 | **EXISTING_VERIFIED**（前端已接入） | `refresh_work_metadata`；绕过 30 天聚合缓存重读 Bangumi 详情 / 官方分集 / 补源。**只返回 `AnimeWorkStructure`**，简介与标签必须再调 `get_work`；自动刷新只替换 `metadata` 来源标签、保留 `manual` 标签 |
| DETAIL-007 | 作品详情 | 制作人员与角色 | **EXISTING_VERIFIED**（前端已接入） | `AnimeWorkStructure.staff` / `characters`（多源聚合结果） |
| DETAIL-008 | 作品详情 | 视频缩略图 | **EXISTING_PARTIAL** | `get_media_thumbnail` 返回本地 JPEG 路径或 `null`（先读 Windows 缩略图缓存，再请 Shell 处理器）。实际 MKV/x264 与 MKV/x265 在当前机器均返回 `WTS_E_FAILEDEXTRACTION`，**不承诺所有编码可生成**；前端必须处理 `null`，且不得用作品海报冒充视频帧 |
| DETAIL-009 | 作品详情 | 字幕与视频的持久化关联 | NEEDS_CONFIRMATION | 契约 012 声明了视频 / 集数的持久化（`media_episode_links`），**未声明字幕映射表**；不得按旧原型的 `subtitleLinks` 假定已实现 |
| DETAIL-004 | 作品详情 | 本地评分 | EXISTING_VERIFIED | `update_work`；`works.rating` |
| DETAIL-005 | 作品详情 | 备注 / 点评 | EXISTING_VERIFIED | `update_work`；`works.notes` |
| MATCH-001 | 识别 | 单文件识别 | EXISTING_VERIFIED | **`recognize_media_file`** |
| MATCH-002 | 识别 | 批量识别未分配视频 | EXISTING_VERIFIED | `recognize_unmatched_media` |
| MATCH-003 | 识别 | 候选列表 / 确认 / 取消 | EXISTING_VERIFIED | `list_match_candidates`、`confirm_match_candidate`、`cancel_match_candidates`；`match_candidates` |
| MATCH-004 | 识别 | 字段锁定 | EXISTING_VERIFIED | `set_work_field_lock`；`work_field_locks` |
| META-001 | 元数据编辑 | 编辑字段 | EXISTING_VERIFIED（字段集 PARTIAL） | `update_work`；authors/artists 等字段缺失 |
| PLAYER-001 | 播放器 | 外部工具启动媒体 | EXISTING_VERIFIED | `launch_media`、`open_media_directory`；`external_tools` |
| PLAYER-002 | 播放器 | 按媒体类型探测可用程序 / 设为默认 | EXISTING_PARTIAL | `external_tools` + `supportedMediaTypes` 已支持 comic / novel，缺按类型可用性探测 |
| READER-001 | 阅读器 | 选择外部阅读器并打开 | **EXISTING_VERIFIED / EXISTING_PARTIAL** | 可作为 `ExternalTool` 配置；`supportedMediaTypes` 已含 `comic` 与 `novel`；`launch_media` 可启动外部阅读器。**已有外部阅读器打开能力** |
| READER-002 | 阅读器 | 内置阅读器 | FUTURE | 不在当前范围 |
| READER-003 | 阅读器 | 阅读页码 / 阅读进度 | NEW_REQUIRED | 无页码与阅读进度字段 |
| TOOLS-001 | 工具 | 外部工具 CRUD / 检测 / 测试 | EXISTING_VERIFIED | `list/create/update/delete_external_tool`、`detect_external_tools`、`test_external_tool` |
| TOOLS-002 | 工具 | 一键下载 / 自动安装 | FUTURE | 无下载后端（界面已禁用并标 Future） |
| SETTINGS-001 | 设置 | 通用设置 / 外观 | EXISTING_PARTIAL | `get_setting` / `set_setting`；`app_settings`；主题键结构未定义 |
| SETTINGS-002 | 设置 | 下载与备份 | FUTURE | 无命令与表（界面已禁用并标 Future） |
| EXPLORE-001 | 探索 | Bangumi 条目搜索与详情 | EXISTING_VERIFIED | `search_explore_subjects`、`get_explore_subject`；`explore.rs`、`bangumi.rs`、`metadata_cache`、`work_external_ids` |
| EXPLORE-002 | 探索 | 番组日历（按年月选择本季） | EXISTING_PARTIAL | `get_explore_overview(year, month)` 返回该月本季番组（bangumi-data 索引 + 当前月份叠加实时番组日历）；**按星期分组的放送时间表仍为 NEW_REQUIRED** |
| EXPLORE-003 | 探索 | 排行 / 评分人数 / 网络评分缓存 | EXISTING_VERIFIED | `ExploreSubject.score/rank/ratingCount/collectionCount`；`metadata_cache`；`explore.rs::overview` 按评分人数 / 收藏人数排序热度榜 |
| EXPLORE-004 | 探索 | 追番状态 | EXISTING_VERIFIED | `save_explore_subject`；`works.status` / `works.favorite` / `work_external_ids`（幂等创建或更新，不写个人评分） |
| EXPLORE-005 | 探索 | 别名与番组索引 | EXISTING_VERIFIED | `bangumi-data` 索引（`explore.rs::load_bangumi_data`）、`ExploreSubject.aliases`、`titleTranslate` |
| EXPLORE-006 | 探索 | 漫画探索数据源 | NEW_REQUIRED | 当前只接入 Bangumi 动画条目，无漫画探索数据源（界面禁用 + `Future`） |
| EXPLORE-007 | 探索 | 全年 / 全量动画浏览 | NEW_REQUIRED | `get_explore_overview` 只按年月返回本季番组，无全量浏览查询（界面禁用 + `Future`） |
| EXPLORE-008 | 探索 | 按星期分组的放送时间表 | NEW_REQUIRED | 契约只提供 `airDate` / `broadcast` 单条字段，无按星期聚合（界面禁用 + `Future`） |
| COMPLIANCE-001 | 全局 | 在线片源搜索 / 聚合 / 下载 | REJECTED | 产品与合规边界禁止 |

## 尚需新增（汇总）

按作品文件夹整组识别；更可靠的动画文件名解析；字幕与视频的持久化关联（待确认，见 DETAIL-009）；扫描实时进度事件；单个失败项重试；目录组数量统计；播放 / 阅读进度；内置阅读器；探索的**按星期分组放送时间表**、**全年 / 全量动画浏览查询**、**漫画探索数据源**与**最近 30 日注目动画**。

本轮从 NEW_REQUIRED 转正（后端已实现 + 前端已接入）：逐集手动映射保存（INBOX-006）、官方分集与本地多版本（DETAIL-002）、关联作品 / 季度（DETAIL-003）、刷新元数据（DETAIL-006）、制作人员与角色（DETAIL-007）、动画排行（EXPLORE-020）。视频缩略图（DETAIL-008）为 EXISTING_PARTIAL，受 Windows Shell 编解码限制。

## Future（不在当前范围）

WebDAV、SMB/NAS、网盘、远程播放、下载到本地、工具一键下载或自动安装、内置播放器、内置漫画 / PDF / EPUB 阅读器、跨设备同步、推荐与社区分享。

## 语义约束

- 扫描只有任务结束后的最终统计，界面不得显示可靠实时百分比。
- 「重新扫描」为整目录重扫，不得称为「只重试失败项」。
- 逐集映射为 NEW_REQUIRED，不得标为当前可直接接入。
- HTML 按钮、Toast、模拟数据与设计文档描述均**不是**后端已实现的证据。

## 前端 Provider 接入登记（前后端职责分离后新增）

| 功能 ID | 页面 | 用户操作 | 能力状态 | 代码证据 / 说明 | 持久化 | 建议版本 |
|---|---|---|---|---|---|---|
| FE-PROVIDER-001 | 全局 | 前端通过 Provider 契约取数 | EXISTING_VERIFIED（契约已定义，Codex 已实现） | `src/data/provider.ts`（接口，前端拥有）；`src/data/tauriProvider.ts` 已由 Codex 逐方法委托 `src/api.ts`（见 003 与 FE-PROVIDER-003 的探索缺口） | 否 | v0.1 P0 |
| FE-MOCK-001 | 全局 | 设计期示例数据 | MOCK_ONLY | `src/data/mockProvider.ts`，导出 `MOCK_NOTICE`，UI 必须显示“示例数据” | 否（内存） | 仅设计 |
| FE-STORE-001 | 全局 | 主题/视图偏好、Toast | 前端专用（非后端能力） | `src/store.ts` = zustand `persist`，键 `genzo-preferences`，仅外观偏好与 Toast | localStorage | v0.1 P1 |
| FE-MOCK-002 | 全局 | 标注示例数据来源 | MOCK_ONLY | `WindowTitleBar` 在 `provider.meta.mock` 为真时显示「示例数据」，tooltip = `MOCK_NOTICE`（`mockProvider.ts`）；探索页写入提示同样带「示例数据」后缀 | 否 | 仅设计 |
| FE-GAP-001 | 多页 | UI 已具备、等待后端 Provider | NEW_REQUIRED | 继续观看进度、制作人员/角色、阅读器、下载与备份：UI 可完成，数据由 `tauriProvider.ts` 提供（探索数据已由 004/005 接入，不再在此列） | 待定 | v0.2–v0.3 |
| FE-PROVIDER-002 | 全局 | 运行期按环境选择数据源 | EXISTING_VERIFIED | `src/data/index.ts`：`isTauriRuntime()` → `createTauriProvider()`，否则 Mock；`dataProvider` 单例供 UI 使用（Codex 已实现 `tauriProvider.ts`，见 003） | 否 | v0.1 P0 |
| FE-PROVIDER-003 | 全局 | Tauri Provider 补齐探索委托 | NEW_REQUIRED | `src/data/tauriProvider.ts`（Codex 维护）尚未包含 `exploreOverview` / `searchExplore` / `getExploreSubject` / `saveExploreSubject`；补齐前 `getExploreProvider()` 在桌面壳返回 `null`，探索页显示「尚未接入」错误态 | 否 | v0.2 P0 |
| FE-EXPLORE-001 | 探索 | 探索页数据（本季番组 / 热度 / 搜索 / 详情 / 加入媒体库） | EXISTING_VERIFIED（后端 + 前端已接入） | `ExplorePage.tsx` 已改用 `getExploreProvider()`，不再使用本地 `samples`；新增 `src/explore.ts`（纯展示辅助 + 单测）与 `src/explore.css`；Mock Provider 保留「示例数据」标记 | 缓存由后端负责 | v0.2 |
| FE-PROVIDER-004 | 全局 | 动画详情 / 缩略图能力访问器 | EXISTING_VERIFIED | `src/data/provider.ts` 新增**可选**方法 `getAnimeWorkStructure` / `refreshWorkMetadata` / `setMediaEpisode` / `getMediaThumbnail`；`src/data/index.ts` 的 `getAnimeDetailProvider()` 在四个方法都可用时返回子集，否则返回 `null`，页面显示「尚未接入」，不伪造数据 | 否 | v0.3 P0 |
| FE-PROVIDER-005 | 全局 | Tauri Provider 补齐动画详情与排行委托 | **EXISTING_VERIFIED（已解除）** | Codex 已提交 `631b8f9 feat(data): connect anime detail provider`：`src/data/tauriProvider.ts` 补齐 `getAnimeWorkStructure` / `refreshWorkMetadata` / `setMediaEpisode` / `getMediaThumbnail` / `animeRanking` 五个委托（仅该文件 +5 行）。桌面壳内 `getAnimeDetailProvider()` 与 `getAnimeRankingProvider()` 现已返回可用子集，「尚未接入」状态只在方法缺失时出现 | 否 | v0.3 P0 |
| FE-DETAIL-004 | 作品详情 / 探索 | 离线状态提示 | EXISTING_VERIFIED（UI 已接入） | `useOffline()`（`src/components/common.tsx`，`navigator.onLine` + `online`/`offline` 事件）；详情页提示「网络已断开：刷新元数据与视频缩略图可能失败，本地文件仍可打开」，探索页提示「离线时可能只显示本地缓存或加载失败，不影响本地媒体库」。**纯前端信号，不代表后端能力** | 否 | v0.3 P1 |
| FE-DETAIL-005 | 作品详情 | 网络图片加载失败回退 | EXISTING_VERIFIED（UI 已接入） | `SafeImage`（`src/components/common.tsx`）：关联作品封面、制作人员 / 角色头像在缺失**或加载失败**时回退首字占位，不出现浏览器破图；与探索卡片的 `ExploreCover` 回退策略一致 | 否 | v0.3 P1 |
| FE-DETAIL-001 | 作品详情 | 官方分集 / 本地多版本 / 关联作品 / 刷新 / 制作人员 | EXISTING_VERIFIED（UI 已接入） | `WorkDetailPage.tsx` 并行读取 `getWork` + `getAnimeWorkStructure`；`refreshWorkMetadata` 后**重新** `getWork()` + `getAnimeWorkStructure()`；失败保留旧内容并提示 | 否（读） | v0.3 P0 |
| FE-DETAIL-002 | 作品详情 | 手动分集映射 | EXISTING_VERIFIED（UI 已接入） | 未匹配文件 → `setMediaEpisode(mediaFileId, episodeExternalId)`（`null` 解除映射），成功后重新读取结构；失败显示真实错误，不显示假成功 | 是（后端 `media_episode_links`） | v0.3 P0 |
| FE-DETAIL-003 | 作品详情 | 视频缩略图懒加载 | EXISTING_VERIFIED（UI 已接入） | `LocalFileThumb` 用 `IntersectionObserver` 只对可见项按需调 `getMediaThumbnail`，每个文件最多一次；`null` → 中性文件占位，**不用作品海报冒充视频帧** | 缓存由后端负责 | v0.3 P1 |
| FE-RANKING-001 | 探索 | 动画排行展示 | EXISTING_VERIFIED（UI 已接入） | `getAnimeRankingProvider()` + `ExplorePage.tsx` 排行区：分页「加载更多」、loading / 错误 / 空 / `stale` 缓存标记、入库与收藏角标、按钮键盘可达；网络失败**不用本季热度冒充** | 缓存由后端负责 | v0.3 P0 |
| FE-INBOX-001 | 媒体库 · 待整理 | 按媒体源文件夹层级浏览（媒体源 → 子文件夹 → 文件） | **NEW_REQUIRED（前端已实现，后端待补过滤 / 分页）** | 前端：`src/pages/LibraryPage.tsx` 的 `inboxBreadcrumb` / `inboxLevel` / `inboxGroupHere`，数据用 `listRoots()` + `listUnassignedGroups()` + `listUnassignedMedia()`。后端缺口：`src-tauri/src/grouping.rs:250` 为 `SELECT … FROM media_files WHERE work_id IS NULL ORDER BY path`，**无 library_root / path 过滤、无分页**；大库下前端需一次性接收全部未整理记录 | 否 | v0.3 P1 |
| FE-INBOX-002 | 媒体库 · 待整理 | 文件级操作：打开 / 打开所在目录 | EXISTING_VERIFIED | `src/api.ts` 的 `launch_media`（`useSystem = true`）与 `open_media_directory`；前端仅复用，不新增后端能力 | 否 | v0.1 P0 |

> 说明：`src/data/` 为前端新增层，只读引用 `src/types.ts` 与 `src/api.ts`；不改动任何 Tauri Command、Rust、SQLite、迁移或 `contracts/`。`src/store.ts` 经只读核对为纯前端偏好与 Toast（zustand + localStorage），归前端所有。

## 探索「推荐」页的排行与注目动画（v1.1.2；2026-09-16 更新）

「推荐」页的**本季热度**仍只取**当前季度**：`src-tauri/src/explore.rs` 的 `overview()` 只在 `year == now.year() && month == current_season_start(now)` 时加载 Bangumi 每日放送（第 143 行），否则 `trending` 为空（第 212 行 `unwrap_or_default()`）。因此前端已把「推荐」与年份 / 季度筛选解耦。**动画排行**已由后端实现并完成前端接线；**注目动画（最近 30 日标记）**仍无数据源。

| 功能 ID | 页面 | 用户操作 | 现状与证据 | 需要的后端能力（建议契约） | 建议版本 |
|---|---|---|---|---|---|
| EXPLORE-020 | 探索 · 推荐 | 查看「动画排行」（按 Bangumi 评分 / 排名） | **EXISTING_VERIFIED**（后端已实现，前端本轮已接入） | `get_anime_ranking(page, pageSize)`：使用 Bangumi 官方 `POST /v0/search/subjects`，`sort=rank` 且过滤 `rank >= 1`，缓存 12 小时，不抓取网页（见 `CONTRACT_CHANGELOG.md` 012）。前端：`ExplorePage.tsx` 的「动画排行」区，分页「加载更多」，含 loading / 错误 / 空 / `stale` 缓存标记 / 入库与收藏角标。**本文件此前「Bangumi 无批量排行接口」的结论已被官方 OpenAPI 与真实调用证伪** | v0.3 |
| EXPLORE-021 | 探索 · 推荐 | 查看「注目动画」（最近 30 日标记） | **FUTURE / NEEDS_CONFIRMATION** | 仍无可靠数据源：Bangumi `GET /calendar`（`src-tauri/src/bangumi.rs::calendar`）只返回当季条目；AniList `get_details_many`（`src-tauri/src/providers/anilist.rs`）只有按 id 查详情，无 trending 查询。界面保留 `Future` 说明、**不提供入口**，也**不用排行榜或本季热度冒充** | v0.4（待确认数据源） |

前端当前处理（2026-09-16 更新）：`src/pages/ExplorePage.tsx` 的「推荐」页已接入 `animeRanking`（真实排行榜，支持分页与 `stale` 缓存提示）；「注目动画」保留 `Future` 说明且无入口。前端通过 `getAnimeRankingProvider()` 访问，未补齐时显示「尚未接入」，**不伪造数据**。

## 探索封面缓存与详情分集结构加载（v1.1.2；2026-09-18）

后端已把探索全年列表改成本地 bangumi-data，并在后台预取封面与元数据；作品详情普通读取已改为优先本地缓存（提交 `e24e915` / `32fecf5`）。前端据此把封面改为懒加载 + 有限次数的缓存复查，并把详情页的分集结构拆成独立加载。

| 功能 ID | 页面 | 用户操作 | 现状与证据 | 需要的后端能力（建议契约） | 建议版本 |
|---|---|---|---|---|---|
| EXPLORE-022 | 探索 | 列表封面懒加载与缓存复查 | **EXISTING_VERIFIED（前端已接入）** | 前端：`ExplorePage.tsx` 的 `ExploreCover` 用 `IntersectionObserver`（`rootMargin: 320px`）只在卡片接近视口时附图；`scheduleCoverRefresh` 在列表仍存在缺失 / 远程封面时，**间隔 2.5s、最多 3 次**静默重读 `exploreOverview`，不设置 `loading`。后端依赖：缓存完成后 `coverUrl` 由 `null` 变为本地 asset 地址（`src/api.ts::localAssetUrl`） | v0.3 P1 |
| EXPLORE-023 | 探索 | 「封面缓存是否仍在进行」的显式信号 | **NEW_REQUIRED（可选优化）** | 现状：前端只能靠「`coverUrl` 为空或仍是 `http(s)`」推断缓存未完成，因此对**永远拿不到封面**的条目也会做满 3 次复查（有界但无谓）。建议契约：`ExploreSubject.coverCached?: boolean`（或 `coverPending?: boolean`），或在 `exploreOverview` 顶层加 `coversPending: number`，让前端据此决定是否复查；均为**新增只读字段**，不改动既有字段 | v0.3（视需要） |
| DETAIL-015 | 作品详情 | 分集结构 / 关联作品 / 制作人员独立加载 | **EXISTING_VERIFIED（前端已接入）** | 前端：`WorkDetailPage.load()` 先用 `getWork()` + `listTools()` 结束首屏 loading，再单独 `getAnimeWorkStructure()`（独立 `structureLoading`）；无缓存时显示「尚未缓存…点击刷新元数据」。后端依赖：结构读取优先返回本地缓存、不等待网络（提交 `32fecf5`） | v0.3 P1 |
| DETAIL-016 | 作品详情 | 视频缩略图 | **EXISTING_VERIFIED（UI 已接入；覆盖范围受编解码限制）** | `LocalFileThumb` 用 `IntersectionObserver` 只对可见项调用 `getMediaThumbnail`，每个文件最多一次；`null` → 中性文件占位，**不用作品海报冒充视频帧**。部分 MKV / HEVC 在当前 Windows Shell 下无法提取帧，因此**不得标为「全格式完成」** | v0.3 P1 |
