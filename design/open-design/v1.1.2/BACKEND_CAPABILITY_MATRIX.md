# Genzo UI Design v1.1.2 — Backend Capability Matrix

版本：v1.1.2  
日期：2026-09-14  
证据来源：只读核对 `H:\二次元阅读器`（`src-tauri/src/commands.rs`、`src/api.ts`、`src/types.ts`、`src-tauri/src/{metadata,bangumi,anime_parser,grouping,scanner,launcher}.rs`、迁移 `0001_initial.sql` / `0002_metadata_matching.sql`）

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
| INBOX-006 | 待整理 | 逐集手动映射保存 | NEW_REQUIRED | 有文件级 `parsed_season` / `parsed_episode`（0002），无逐集映射保存 |
| INBOX-007 | 待整理 | 漫画「作品 → 卷/话 → 图片」 | EXISTING_PARTIAL（基础聚合）→ NEW_REQUIRED（完整模型） | 已有基础漫画目录聚合与下钻；完整卷/话/图片结构化模型待建 |
| DETAIL-001 | 作品详情 | 读取作品 | EXISTING_VERIFIED | `get_work`；`WorkDetail` |
| DETAIL-002 | 作品详情 | 章节与本地文件 | EXISTING_PARTIAL | `media_files` + `parsed_*`；无章节聚合与进度 |
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
| EXPLORE-001 | 探索 | Bangumi 条目搜索与详情 | EXISTING_PARTIAL | `bangumi.rs` `BangumiProvider::search` / `get_details`；`metadata_cache`、`work_external_ids` |
| EXPLORE-002 | 探索 | 番组日历 | NEW_REQUIRED | 无日历接口 |
| EXPLORE-003 | 探索 | 排行 / 评分人数 / 网络评分缓存 | NEW_REQUIRED | 无评分人数 / 排行 / 网络评分字段 |
| EXPLORE-004 | 探索 | 追番状态 | NEW_REQUIRED | 无追番状态字段 |
| EXPLORE-005 | 探索 | 别名与番组索引 | NEW_REQUIRED | 无 Bangumi / bangumi-data 别名索引 |
| COMPLIANCE-001 | 全局 | 在线片源搜索 / 聚合 / 下载 | REJECTED | 产品与合规边界禁止 |

## 尚需新增（汇总）

按作品文件夹整组识别；更可靠的动画文件名解析；Bangumi / bangumi-data 别名与番组索引；视频 / 集数 / 字幕持久化映射；网络评分 / 人数 / 排名字段及缓存；番组日历与探索数据缓存；用户追番状态；逐集手动映射保存；扫描实时进度事件；单个失败项重试；目录组数量统计；内置阅读器；阅读页码与进度。

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
| FE-PROVIDER-001 | 全局 | 前端通过 Provider 契约取数 | NEW_REQUIRED（契约已定义，实现待 Codex） | `src/data/provider.ts`（接口，前端拥有）；`src/data/tauriProvider.ts` 为占位实现，抛 `ProviderNotImplementedError` | 否 | v0.1 P0 |
| FE-MOCK-001 | 全局 | 设计期示例数据 | MOCK_ONLY | `src/data/mockProvider.ts`，导出 `MOCK_NOTICE`，UI 必须显示“示例数据” | 否（内存） | 仅设计 |
| FE-STORE-001 | 全局 | 主题/视图偏好、Toast | 前端专用（非后端能力） | `src/store.ts` = zustand `persist`，键 `genzo-preferences`，仅外观偏好与 Toast | localStorage | v0.1 P1 |
| FE-GAP-001 | 多页 | UI 已具备、等待后端 Provider | NEW_REQUIRED | 继续观看进度、探索数据、制作人员/角色、阅读器、下载与备份：UI 可完成，数据由 `tauriProvider.ts` 提供 | 待定 | v0.2–v0.3 |
| FE-PROVIDER-002 | 全局 | 运行期按环境选择数据源 | NEW_REQUIRED | `src/data/index.ts`：`isTauriRuntime()` → `createTauriProvider()`，否则 Mock；`dataProvider` 单例供 UI 使用。桌面壳在 `tauriProvider.ts` 完成前会抛 `ProviderNotImplementedError` | 否 | v0.1 P0 |
| FE-MOCK-002 | 全局 | 标注示例数据来源 | MOCK_ONLY | `WindowTitleBar` 在 `provider.meta.mock` 为真时显示「示例数据」，tooltip = `MOCK_NOTICE`（`mockProvider.ts`） | 否 | 仅设计 |
| FE-EXPLORE-001 | 探索 | 探索页数据（日历/排行/网络评分） | NEW_REQUIRED | `ExplorePage.tsx` 目前使用本地 `samples` 常量（设计占位），未接入任何后端；需 Bangumi 数据源与缓存，建议加入 Provider 契约 | 待定（需缓存） | v0.2 |

> 说明：`src/data/` 为前端新增层，只读引用 `src/types.ts` 与 `src/api.ts`；不改动任何 Tauri Command、Rust、SQLite、迁移或 `contracts/`。`src/store.ts` 经只读核对为纯前端偏好与 Toast（zustand + localStorage），归前端所有。
