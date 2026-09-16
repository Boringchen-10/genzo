# Genzo UI Design v1.1.2 — Feature Matrix

版本：v1.1.2（v1.1 的定点修订；未新增页面、未扩大功能范围）  
日期：2026-09-14（**2026-09-16 更新：动画详情结构与官方排行榜前端接线完成**）

验证等级：
- **A** 已由 Open Design 核对（源码级，不含渲染）
- **B** 需开发 Agent 验证（浏览器 / 应用内运行）
- **C** 必须在真实 Tauri 窗口验证

| 功能 ID | 页面 / 组件 | 设计状态 | 后端状态 | 验证等级 |
|---|---|---|---|---|
| SHELL-001 | 全局框架 + 左侧窄导航 | 保留 v1.1 | MOCK_ONLY | A + B |
| SHELL-002 | Windows 自定义标题栏（覆盖式） | v1.1.1 修复连续性 | FUTURE（桌面壳） | A + B + **C** |
| HOME-001 | 首页（背景 / 书架 / 统计 / 收藏） | v1.1.1 浅色与标题栏修复 | EXISTING_VERIFIED | A + B |
| HOME-002 | 继续观看与播放进度 | 保留结构 | NEW_REQUIRED | B |
| LIBRARY-001 | 媒体库（来源 + 作品 + 筛选） | 保留 v1.1 | EXISTING_PARTIAL | A + B |
| LIBRARY-002 | 本地文件夹来源 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| LIBRARY-003 | WebDAV 来源 | v1.1.1 禁用 + Future + tooltip | FUTURE | A + B |
| LIBRARY-004 | 网盘来源 / 授权 | v1.1.1 禁用 + Future + tooltip | FUTURE | A + B |
| SCAN-001 | 扫描目录 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| SCAN-002 | 最终统计 + 错误列表 | v1.1.1 语义修正 | EXISTING_VERIFIED | A + B |
| SCAN-003 | 重新扫描此目录 | v1.1.1 命名与说明修正 | EXISTING_VERIFIED | A + B |
| SCAN-004 | 单个失败项重试 | 已移除可点假象 | NEW_REQUIRED | A |
| SCAN-005 | 实时百分比进度 | v1.1.1 已删除 | NEW_REQUIRED | A + B |
| SCAN-006 | 目录组统计 | v1.1.1 标注需新增后端，值 `—` | NEW_REQUIRED | A + B |
| INBOX-001 | 待整理 · 作品组聚合 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| INBOX-002 | 作品组下钻（季度/剧集/视频/字幕） | 保留 v1.1；作品详情内已接入「官方分集 → 多本地版本」与手动分集映射 | EXISTING_VERIFIED（`get_anime_work_structure` / `set_media_episode` + `media_episode_links`） | A + B |
| INBOX-003 | 漫画分层（作品 → 卷/话 → 图片） | 保留 v1.1 | EXISTING_PARTIAL / NEW_REQUIRED | A + B |
| INBOX-004 | 批量确认 / 批量重新识别（Future 入口） | 保留 v1.1（禁用 + tooltip） | NEW_REQUIRED | A + B |
| DETAIL-001 | 作品详情 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| DETAIL-002 | 官方分集 + 多个本地版本 | 详情页「章节与文件」改为两层：官方分集（集号 / 标题 / 原名 / 放送 / 时长 / 简介）→ 本地版本（文件名 / 媒体信息 / 大小 / 可用状态 / 打开 / 更多）；未匹配文件可手动关联分集 | EXISTING_VERIFIED（`get_anime_work_structure`、`set_media_episode`） | A + B |
| DETAIL-003 | 关联作品 / 季度 | 新增「关联作品」区：按 `relation` 展示，仅 `seasonNumber !== null` 显示「第 N 季」；`localWorkId` 可跳转，否则「未入库」 | EXISTING_VERIFIED（`AnimeWorkStructure.seasons`） | A + B |
| DETAIL-006 | 刷新元数据 | 「元数据识别」面板新增按钮；成功后重新 `getWork()` + 结构；刷新中禁用、失败保留旧内容 | EXISTING_VERIFIED（`refresh_work_metadata`） | A + B |
| DETAIL-007 | 制作人员与角色 | 由 `Future` 改为接入真实数据（头像缺失用首字占位），并显示 `warnings` | EXISTING_VERIFIED（`AnimeWorkStructure.staff/characters`） | A + B |
| DETAIL-008 | 视频缩略图 | 本地版本缩略图懒加载（`IntersectionObserver`，只请求可见项）；`null` 用中性文件占位 | EXISTING_PARTIAL（`get_media_thumbnail`；受 Windows Shell 编解码限制） | A + B |
| DETAIL-009 | 字幕与视频的持久化关联 | 不展示；契约未声明字幕映射表 | NEEDS_CONFIRMATION | A |
| META-001 | 元数据查看与编辑 | 保留 v1.1 | EXISTING_VERIFIED（字段集 PARTIAL） | A + B |
| MATCH-001 | 单文件识别 | 保留 v1.1（命令名更正） | EXISTING_VERIFIED（`recognize_media_file`） | A |
| MATCH-005 | 手动匹配弹窗 | v1.1.1 修复透明度与滚动 | EXISTING_VERIFIED | A + B |
| MATCH-006 | 匹配候选对比 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| PLAYER-001 | 外部播放器启动 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| PLAYER-002 | 播放器 / 阅读器选择 | 保留 v1.1 | EXISTING_PARTIAL | A + B |
| READER-001 | 外部阅读器打开 | 保留 v1.1 | **EXISTING_VERIFIED / EXISTING_PARTIAL** | A + B |
| READER-002 | 内置阅读器 | 未设计 | FUTURE | — |
| TOOLS-001 | 外部工具管理 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| TOOLS-002 | 一键下载 / 安装 | v1.1.1 禁用 + Future | FUTURE | A + B |
| SETTINGS-001 | 设置（外观 / 通用） | 保留 v1.1 | EXISTING_PARTIAL | A + B |
| SETTINGS-002 | 下载与备份 | v1.1.1 标记 Future + 控件禁用 | FUTURE | A + B |
| EXPLORE-001 | 探索 · 页面结构与本季番组列表 | 正式数据版本（分类 Tab + 筛选 + 海报网格；无「最高热度」横排；条目详情复用作品详情页版面 + 空值 / 缓存 / 数据源错误态） | EXISTING_VERIFIED（`get_explore_overview`） | A + B |
| EXPLORE-002 | 探索 · 番组日历（按年月选择本季） | 年月筛选可用；按星期的放送时间表仍禁用 + `Future` | EXISTING_PARTIAL（月度番组 EXISTING_VERIFIED；周表 NEW_REQUIRED） | A + B |
| EXPLORE-003 | 探索 · 网络评分 / 排名 / 人数 | 卡片与详情展示，明确标注「不是个人评分」 | EXISTING_VERIFIED（`ExploreSubject.score/rank/ratingCount/collectionCount`） | A + B |
| EXPLORE-004 | 探索 · 追番状态 | 条目详情（作品详情页版面）内选择状态（`WorkStatus`） | EXISTING_VERIFIED（`save_explore_subject`） | A + B |
| EXPLORE-005 | 探索 · 别名与番组索引 | 详情显示原文标题与别名；列表来自 bangumi-data 索引 | EXISTING_VERIFIED（`aliases` + bangumi-data） | A + B |
| EXPLORE-006 | 探索 · Bangumi 条目搜索 | 顶部搜索框（Enter 提交、可清除） | EXISTING_VERIFIED（`search_explore_subjects`） | A + B |
| EXPLORE-007 | 探索 · 漫画探索 | 禁用 + `Future` 徽标 + tooltip | NEW_REQUIRED（无漫画数据源） | A + B |
| EXPLORE-008 | 探索 · 按类型全量浏览（动画） | 禁用 + `Future` 徽标 + tooltip | NEW_REQUIRED（无全年 / 全量浏览查询） | A + B |
| EXPLORE-009 | 探索 · 「最高热度」横排 | 已删除（样式 / 标记 / 监听一并移除），列表直接进入海报网格 | 纯前端 | A |
| EXPLORE-010 | 探索 · 条目详情版面 | 复用作品详情页版面（`detail-page` / `detail-hero` / `detail-body`），不再是独立弹窗 | 纯前端 | A + B |
| EXPLORE-020 | 探索 · 动画排行 | 「推荐」页排行区：分页「加载更多」、loading / 错误 / 空 / `stale` 缓存标记、入库与收藏角标，可点开详情 | EXISTING_VERIFIED（`get_anime_ranking`，Bangumi `POST /v0/search/subjects`，缓存 12h） | A + B |
| EXPLORE-021 | 探索 · 注目动画（最近 30 日标记） | 保留 `Future` 说明，**不提供入口**，也不用排行榜或本季热度冒充 | **NEW_REQUIRED / NEEDS_CONFIRMATION**（无数据源） | A + B |
| A11Y-001 | 统一 Overlay Manager | v1.1.1 新增 | 纯前端 | A + B |
| A11Y-002 | 图标按钮 aria-label / tooltip | v1.1.1 补齐 | 纯前端 | A |
| THEME-002 | 浅色主题对比与背景可见性 | v1.1.1 修复 | 纯前端 | A + B |
| FUTURE-001 | WebDAV / 网盘 / 远程 / 阅读器 / 同步 / 分享 | 静态占位 | FUTURE | A + B |

> 提醒：以上除 EXISTING_VERIFIED / EXISTING_PARTIAL 外，均不代表后端已实现。等级 B、C 的项目**尚未**由本流程实际运行或截图验证。
>
> 探索页（EXPLORE-001 ~ 006）已由 Open Design 按 004 号契约接入 `GenzoDataProvider`；桌面壳仍需 Codex 在 `src/data/tauriProvider.ts` 补齐四个探索委托，否则界面显示「尚未接入」错误态（不伪造数据）。详见 `CONTRACT_CHANGELOG.md` 005。
>
> 动画详情与排行榜（DETAIL-002/003/006/007/008、INBOX-006、EXPLORE-020）已按 012 号契约接入前端（见 `CONTRACT_CHANGELOG.md` 013）。**桌面壳仍需 Codex 补齐五个委托**：`getAnimeWorkStructure`、`refreshWorkMetadata`、`setMediaEpisode`、`getMediaThumbnail`、`animeRanking`（`src/data/tauriProvider.ts`）；补齐前 `getAnimeDetailProvider()` / `getAnimeRankingProvider()` 返回 `null`，对应区域显示「尚未接入」。EXPLORE-021 与 DETAIL-009 仍为未完成 / 待确认项。
