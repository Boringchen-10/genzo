# Genzo UI Design v1 - Backend Capability Matrix

冻结日期：2026-09-14
校验方式：只读检查正式 Genzo 仓库 `H:\二次元阅读器`（React + TypeScript + Rust/Tauri + SQLite）。未修改正式仓库任何文件。

## 判定规则

- 只有正式仓库中存在明确 Command、函数、类型、字段或迁移证据时，才使用 `EXISTING_VERIFIED`。
- 部分字段或链路存在、但契约不完整时使用 `EXISTING_PARTIAL`。
- 正式仓库完全没有对应实现、但本设计需要后端补齐时使用 `NEW_REQUIRED`。
- 路线图规划的长期能力使用 `FUTURE`。
- 仅由 `index.html` 原型 JavaScript、fixture、Toast 驱动的使用 `MOCK_ONLY`。
- 无法从正式仓库确认的契约使用 `NEEDS_CONFIRMATION`，不猜测。

## 证据索引（正式仓库）

| 证据 | 路径 | 内容 |
|---|---|---|
| E1 | `src/api.ts` | `invoke()` 包装的全部命令名：list_works、get_work、update_work、list_library_roots、scan_library_root、list_external_tools、launch_media、get_dashboard、get_setting/set_setting、recognize_media_file、list_match_candidates、confirm_match_candidate、set_work_field_lock 等 |
| E2 | `src/types.ts` | `Work`、`WorkListItem`、`WorkDetail`、`MediaFile`、`LibraryRoot`、`ScanResult`、`ExternalTool`、`MatchCandidate`、`Dashboard`、`ThemeMode`、`MetadataStatus` |
| E3 | `src-tauri/src/lib.rs` | `invoke_handler` 注册的全部 Command 清单 |
| E4 | `src-tauri/src/commands.rs` | 每个 `#[tauri::command]` 实现（作品、目录根、扫描、外部工具、设置、识别） |
| E5 | `src-tauri/src/metadata.rs` | `candidates_for_media` / `candidates_for_work` / `recognize_media` / `recognize_batch` / `confirm_candidate` / `cancel_candidates` / `set_field_lock` |
| E6 | `src-tauri/src/bangumi.rs` | `BangumiProvider`，`API_ROOT = https://api.bgm.tv/v0`，`search` / `get_details` / `download_cover` |
| E7 | `src-tauri/src/scanner.rs` | 目录扫描任务实现 |
| E8 | `src-tauri/src/launcher.rs` | 外部程序启动与打开媒体目录 |
| E9 | `src-tauri/migrations/0001_initial.sql` | 表：works、library_roots、media_files、external_tools、tags、work_tags、scan_jobs、app_settings |
| E10 | `src-tauri/migrations/0002_metadata_matching.sql` | works.metadata_*、media_files.parsed_*、work_external_ids、metadata_cache、match_candidates、work_field_sources、work_field_locks |

## 能力矩阵

| ID | 页面 | 用户操作 | UI 展示数据 | UI 提交参数 | 能力状态 | 代码证据 | 持久化 | 状态覆盖 | 版本/优先级 | 后端需补充 | 依赖/备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HOME-001 | 主页 | 浏览书架、最近作品、收藏 | workId、title、type、coverPath、favorite、tags、mediaCount、missingCount | 无 | EXISTING_VERIFIED | E1 `listWorks`/`dashboard`、E4 `list_works`/`get_dashboard`、E9 `works`/`media_files` | 是 | loading/empty/error/disabled | v0.1 P0 | 无 | 首页视觉为 prototype，须复用真实 workId |
| HOME-002 | 主页 | 继续观看进度 | progress、resumeAt、episode | workId | NEW_REQUIRED | E9/E10 无播放进度字段，E4 无进度命令 | 否 | loading/empty/error | v0.3 P1 | 建议 `update_progress` 与进度表 | 依赖 DETAIL-002；对应 ROADMAP v0.3 观看记录 |
| EXPLORE-001 | 探索 | 浏览推荐 / 热门 | title、mediaType、coverUrl、summary、score、rank | mediaType、season、page | NEW_REQUIRED | 无发现页 Command，`src/pages` 无 Explore 页面；`ROADMAP.md` v0.2 仅元数据方向 | 缓存可选 | loading/empty/error/offline disabled | 未排期 | 建议 `list_discover_items` | 数据源许可与限流待决；ROADMAP v0.1–v0.6 未覆盖发现页 |
| EXPLORE-002 | 探索 | 本季日程 / 星期 | airDate、weekday、episode、status | season、year、weekday | NEW_REQUIRED | 无季度日程查询实现 | 缓存可选 | loading/empty/error/offline disabled | 未排期 | 建议 `get_season_schedule` | 时区与季度边界待确认；ROADMAP 未覆盖 |
| EXPLORE-003 | 探索 | 判断是否已入库 | externalId、workId?、localState | provider、externalId | EXISTING_PARTIAL | E10 `work_external_ids`、E5 `candidates_for_work`；缺批量映射契约 | 是（映射） | unknown/loading/error/no-local | v0.2 P1 | 建议批量 `match_library_status` | 不得把“未入库”做下载入口 |
| EXPLORE-004 | 探索 | 个性化推荐 | recommendationReason | profileId | FUTURE | `ROADMAP.md` v0.5 候选，无实现 | 需用户决定 | loading/empty/error | v0.5 P3 | 仅登记需求 | 对应 ROADMAP v0.5 个人资料包/推荐清单；本版不展示为可用 |
| EXPLORE-005 | 探索 | 状态演示 | prototypeState | state | MOCK_ONLY | 仅 `index.html` fixture | 否 | normal/loading/empty/error/disabled | 仅设计 | 无 | 明确 Prototype |
| EXPLORE-006 | 探索 | 关键词搜索 | query | query、mediaType、page | NEW_REQUIRED | 仓库搜索为本地库/识别（E5），无远程发现搜索 | 远程缓存可选 | loading/empty/error/offline disabled | 未排期 | 建议 `list_discover_items({ query })` | 当前仅筛选固定 fixture；ROADMAP 未覆盖 |
| LIBRARY-001 | 媒体库 | 类型 / 搜索 / 收藏筛选 | workId、title、type、favorite、tags、mediaCount | type、favorite | EXISTING_PARTIAL | E1/E4 `list_works` 返回含 tags/mediaCount；筛选参数目前由前端完成 | 是 | 全部状态 | v0.1 P0 | 建议 `list_works` 增加过滤参数 | 不修改现有 API |
| LIBRARY-002 | 媒体库 | 管理本地文件夹来源 | path、kind、enabled、lastScannedAt | path、kind、enabled | EXISTING_VERIFIED | E1/E4 `list/add/update/delete_library_root`、E9 `library_roots` | 是 | loading/empty/error/disabled | v0.1 P0 | 无 | 不读取/移动用户文件内容 |
| LIBRARY-003 | 媒体库 | 添加 WebDAV 来源 | server、root、user | server、root、user | FUTURE | E9 `library_roots.kind` 仅 auto/video/comic/novel/game/mixed，无 WebDAV 协议实现 | 否 | — | v0.4 P2 | 需 WebDAV 客户端与凭据存储 | 对应 ROADMAP v0.4 远程存储；原型标注 Prototype |
| LIBRARY-004 | 媒体库 | 添加网盘来源（阿里/百度/夸克/115） | provider、account、status | provider、auth | FUTURE | 无 provider / OAuth 实现 | 否 | — | v0.4 之后 P3 | 需各网盘开放平台授权 | ROADMAP 远程存储优先级末位；仅用户自有网盘，不做聚合 |
| LIBRARY-005 | 媒体库 | 校验 / 启停来源 | status、works、files、syncedAt | rootId | EXISTING_PARTIAL | E4 目录根命令 + E7 扫描；无独立“连接校验”命令 | 是（扫描） | 校验中/失败/停用 | v0.1 P1 | 建议连接检测与状态字段 | 网盘校验为 FUTURE |
| BOOKSHELF-001 | 书架 | 浏览漫画 / 轻小说 / 画集 / 小说并按类型 / 状态筛选 | workId、title、type、category、tags、status、favorite、mediaCount、coverPath、coverThumbnailPath | type、status（前端本地筛选） | EXISTING_VERIFIED | E1/E4 `list_works` 已返回 tags/category/type/status/mediaCount/favorite 与封面路径；四类细分为前端只读映射（正式前端 `src/bookshelf.ts`） | 读取已有 | loading/empty/error | v0.4 | 可选：稳定的阅读物子类只读字段，或 `list_works` 增加过滤参数 | 不新增命令 / 字段 / 迁移；视频 / 游戏 / 其他不入书架 |
| DETAIL-001 | 作品详情 | 打开详情 / 返回 / 继续 | workId、title、originalTitle、type、description、coverPath、status、favorite、rating、notes、tags | workId、mediaFileId | EXISTING_VERIFIED | E1 `getWork`、E4 `get_work`、E2 `WorkDetail` | 读取已有 | loading/empty/error/disabled | v0.1 P0 | 无 | 详情页须用真实字段 |
| DETAIL-002 | 作品详情 | 查看章节与本地文件 | fileName、parsedTitle、parsedSeason、parsedEpisode、size、missing | workId | EXISTING_PARTIAL | E9 `media_files`、E10 `parsed_*`；以文件为粒度，无独立章节聚合与进度 | 是 | missing 时禁用播放 | v0.2 P0 | 建议章节聚合视图与进度字段 | 依赖扫描结果 |
| DETAIL-003 | 作品详情 | 查看作者 / 连载 / 年份 | originalTitle、metadataYear、metadataStatus、provider、externalId、fetchedAt | workId | EXISTING_PARTIAL | E10 `metadata_*`、`metadata_cache`、`work_external_ids`；E6 `get_details` | 是（缓存） | loading/empty/error | v0.2 P1 | 建议 authors/artists/startDate/schedule | 许可与限流待决 |
| DETAIL-004 | 作品详情 | 提交我的评分 | rating（0–10） | rating | EXISTING_VERIFIED | E9 `works.rating REAL CHECK 0..10`、E4 `update_work` 校验、E1 `updateWork` | 是 | 提交中/失败/离线 | v0.1 P1 | 无（UI 星级需映射到 0–10） | 原型评分为前端 JS 状态 |
| DETAIL-005 | 作品详情 | 保存点评 / 备注 | notes | notes | EXISTING_VERIFIED | E9 `works.notes TEXT`、E4 `update_work`、E1 `updateWork` | 是 | 未保存/已保存/失败 | v0.1 P1 | 无（UI 未写回） | 原型仅为前端 JS 状态 |
| DETAIL-006 | 作品详情 | 重新 / 手动识别 | provider、title、year、confidence、coverUrl、matchReasons | mediaFileId、query、candidateId | EXISTING_VERIFIED | E5 `recognize_media`/`candidates_for_media`/`confirm_candidate`、E4 `recognize_media_file`/`list_match_candidates`/`confirm_match_candidate`、E10 `match_candidates` | 是 | 识别中/候选/已匹配/失败 | v0.2 P0 | 无 | 识别由后端完成，非 UI fixture |
| DETAIL-007 | 作品详情 | 查看制作人员与角色 | person、role、characterName、voiceActor、imageUrl | workId | NEW_REQUIRED | E2/E10 无 credits/character 类型或表；E6 详情未提供 credits | 可缓存 | loading/empty/error/无授权图像 | 未排期 | 建议 `get_work_credits` | 图像授权必须记录；ROADMAP v0.2 元数据未含 credits |
| SCAN-001 | 媒体库（扫描并入） | 扫描来源 / 查看进度 | discoveredCount、addedCount、updatedCount、missingCount、status | rootId | EXISTING_VERIFIED | E4 `scan_library_root`/`list_scan_jobs`、E7、E9 `scan_jobs` | 是 | running/completed/completed_with_errors/failed | v0.1 P0 | 无（无暂停语义，UI 不展示暂停） | 不触碰文件内容 |
| SCAN-002 | 媒体库（扫描并入） | 查看失败项 / 重试 | errors[] | jobId | EXISTING_VERIFIED | E9 `scan_jobs.errors_json`、E2 `ScanResult.errors` | 是 | error/retry | v0.1 P1 | 重试为再次调用扫描 | 长路径需截断展示 |
| MATCH-001 | 待整理 | 查看未分配媒体并整理 | UnassignedMediaGroup：key、title、folderPath、fileCount、representative | — | EXISTING_VERIFIED | E1 `listUnassignedGroups`、E4 `list_unassigned_media_groups`、E2 `UnassignedMediaGroup` | 读取已有 | loading/empty/error | v0.1 P1 | 无 | 有真实分组能力 |
| MATCH-002 | 手动识别 | 搜索并选择外部作品 | results[]、provider、externalId | query、mediaFileId | EXISTING_VERIFIED | E6 `BangumiProvider.search`、E5 `recognize_media(query)` | 是 | loading/empty/error/离线禁用 | v0.2 P0 | 限流与缓存策略 | 数据源许可待决 |
| MATCH-003 | 元数据编辑 | 锁定字段 | fieldLocks | workId、field、locked | EXISTING_VERIFIED | E4 `set_work_field_lock`、E10 `work_field_locks`/`work_field_sources` | 是 | locked/unlocked/error | v0.2 P1 | 无 | UI 无独立编辑表单 |
| PLAYER-001 | 播放器选择 | 选择工具并启动文件 | toolId、name、executablePath、supportedMediaTypes、isDefault | mediaFileId、toolId、useSystem | EXISTING_VERIFIED | E8 `launcher.rs`、E4 `launch_media`/`open_media_directory`、E9 `external_tools` | 设置持久化 | loading/error/no tool/disabled | v0.1 P1 | 无 | UI 不直接操作文件 |
| PLAYER-002 | 阅读器（漫画/小说） | 打开阅读器并记录页码 | readerId、pageCount、currentPage | mediaFileId、readerId | NEW_REQUIRED | 仓库无阅读器状态或页码字段 | 否 | loading/empty/error | v0.3（阅读记录）P2 | 建议 `open_reader`/`update_reading_progress` | 内置阅读器未排期（ROADMAP v0.1 明确不含） |
| TOOLS-001 | 工具 | 增删改 / 检测 / 测试 | toolId、name、executablePath、argumentsTemplate、isDefault | tool patch | EXISTING_VERIFIED | E4 external tool CRUD/detect/test、E9 `external_tools` | 是 | loading/empty/error/invalid path/disabled | v0.1 P1 | 无 | 路径校验由后端负责 |
| SETTINGS-001 | 设置 | 外观 / 目录 / 行为 | key/value、roots | settings patch | EXISTING_VERIFIED | E4 `get_setting`/`set_setting`、E9 `app_settings`、E2 `ThemeMode` | 是 | loading/error/invalid/disabled | v0.1 P1 | 无 | 主题即时预览仍为前端状态 |
| SETTINGS-002 | 设置 | 下载与备份目录、自动备份 | downloadPath、backupPath、autoBackup、keepCount | paths、toggles | NEW_REQUIRED | 无下载或备份命令/表 | 否 | — | v0.3 P2 | 建议 `set_download_dir`/`run_backup` | 对应 ROADMAP v0.3 数据导入导出；写盘需桌面壳权限 |
| SETTINGS-003 | 设置 | 配置数据源 | source、enabled、cachePolicy | source patch | NEEDS_CONFIRMATION | 未见数据源白名单命令；E10 仅有 metadata_cache | 是（缓存） | empty/error/disabled | v0.2（Bangumi）/后续 Provider | 需后端确认数据源策略 | 不承诺远程服务；Provider 顺序见 ROADMAP |
| THEME-001 | 设置 | 深/浅/跟随系统、强调色、模糊、圆角 | themeMode、accentHue、blur、radius | settings key/value | EXISTING_PARTIAL | E2 `ThemeMode`、E4 `set_setting` 可存任意键值；无主题字段契约 | 通用存储可用 | 即时预览/默认 | v0.1 P1 | 建议明确主题键与结构 | 原型仅前端即时效果 |
| APP-001 | 全局 | Toast / Dialog / Drawer | message、dialog state | — | MOCK_ONLY | 仅 `index.html` JS | 否 | open/close/focus/Esc | 仅设计 | 接入真实操作后复用 | 反馈不得伪装成功 |
| COMPLIANCE-001 | 全局 | 在线聚合 / 下载 / 分发媒体 | — | — | REJECTED | 产品规则：本地优先，禁止盗版聚合与分发 | 不适用 | disabled/rejected | 永不实现 | 无 | 保持合规边界 |

## 版本映射（依据 `H:\二次元阅读器\ROADMAP.md`）

- v0.1：本地扫描、媒体库、手动编辑、外部工具启动（不含网盘 / WebDAV / 内置阅读器 / 云同步）。
- v0.2：本地作品识别与元数据匹配（动画文件名解析、Bangumi 匹配确认、元数据缓存、字段锁定）。
- v0.3：观看 / 阅读 / 游玩记录与数据导入导出。
- v0.4：WebDAV、网络目录、远程播放与本地缓存。
- v0.5：个人资料包、推荐清单、快照分享。
- v0.6：清单订阅与跨设备同步。
- 探索发现页、制作人员 credits 未被路线图覆盖，故标为「未排期」，不作为承诺能力。

## 统计

共 35 项。

- EXISTING_VERIFIED：15 项（BOOKSHELF-001、HOME-001、LIBRARY-002、DETAIL-001/004/005/006、SCAN-001/002、MATCH-001/002/003、PLAYER-001、TOOLS-001、SETTINGS-001）
- EXISTING_PARTIAL：6 项（EXPLORE-003、LIBRARY-001/005、DETAIL-002/003、THEME-001）
- NEW_REQUIRED：7 项（HOME-002、EXPLORE-001/002/006、DETAIL-007、PLAYER-002、SETTINGS-002）
- MOCK_ONLY：2 项（EXPLORE-005、APP-001）
- FUTURE：3 项（EXPLORE-004、LIBRARY-003/004）
- NEEDS_CONFIRMATION：1 项（SETTINGS-003）
- REJECTED：1 项（COMPLIANCE-001）

## 需要用户或开发 Agent 确认

1. 探索数据源（Bangumi 之外是否引入其他服务）及许可证、限流、缓存策略。
2. 章节聚合视图与观看进度的主键与持久化边界（文件级 / 剧集级）。
3. 制作人员、角色图像的来源、缓存与授权记录方式。
4. `list_works` 是否扩展服务端筛选参数，或继续前端筛选。
5. 阅读器（漫画 / 小说）页码模型与版式范围。
6. 下载与备份功能的写盘范围与桌面壳权限模型。
