# Genzo UI Design v1.1.2 — Feature Matrix

版本：v1.1.2（v1.1 的定点修订；未新增页面、未扩大功能范围）  
日期：2026-09-14

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
| INBOX-002 | 作品组下钻（季度/剧集/视频/字幕） | 保留 v1.1 | EXISTING_PARTIAL（逐集映射 NEW_REQUIRED） | A + B |
| INBOX-003 | 漫画分层（作品 → 卷/话 → 图片） | 保留 v1.1 | EXISTING_PARTIAL / NEW_REQUIRED | A + B |
| INBOX-004 | 批量确认 / 批量重新识别（Future 入口） | 保留 v1.1（禁用 + tooltip） | NEW_REQUIRED | A + B |
| DETAIL-001 | 作品详情 | 保留 v1.1 | EXISTING_VERIFIED | A + B |
| DETAIL-002 | 章节与本地文件 | 保留 v1.1 | EXISTING_PARTIAL | A + B |
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
| EXPLORE-001 | 探索 · 页面结构与本季 / 热度列表 | 正式数据版本（网格 + 空值 / 缓存 / 数据源错误态） | EXISTING_VERIFIED（`get_explore_overview`） | A + B |
| EXPLORE-002 | 探索 · 番组日历（按年月选择本季） | 年月筛选可用；按星期的放送时间表仍禁用 + `Future` | EXISTING_PARTIAL（月度番组 EXISTING_VERIFIED；周表 NEW_REQUIRED） | A + B |
| EXPLORE-003 | 探索 · 网络评分 / 排名 / 人数 | 卡片与详情展示，明确标注「不是个人评分」 | EXISTING_VERIFIED（`ExploreSubject.score/rank/ratingCount/collectionCount`） | A + B |
| EXPLORE-004 | 探索 · 追番状态 | 详情弹窗内选择状态（`WorkStatus`） | EXISTING_VERIFIED（`save_explore_subject`） | A + B |
| EXPLORE-005 | 探索 · 别名与番组索引 | 详情显示原文标题与别名；列表来自 bangumi-data 索引 | EXISTING_VERIFIED（`aliases` + bangumi-data） | A + B |
| EXPLORE-006 | 探索 · Bangumi 条目搜索 | 顶部搜索框（Enter 提交、可清除） | EXISTING_VERIFIED（`search_explore_subjects`） | A + B |
| EXPLORE-007 | 探索 · 漫画探索 | 禁用 + `Future` 徽标 + tooltip | NEW_REQUIRED（无漫画数据源） | A + B |
| EXPLORE-008 | 探索 · 按类型全量浏览（动画） | 禁用 + `Future` 徽标 + tooltip | NEW_REQUIRED（无全年 / 全量浏览查询） | A + B |
| A11Y-001 | 统一 Overlay Manager | v1.1.1 新增 | 纯前端 | A + B |
| A11Y-002 | 图标按钮 aria-label / tooltip | v1.1.1 补齐 | 纯前端 | A |
| THEME-002 | 浅色主题对比与背景可见性 | v1.1.1 修复 | 纯前端 | A + B |
| FUTURE-001 | WebDAV / 网盘 / 远程 / 阅读器 / 同步 / 分享 | 静态占位 | FUTURE | A + B |

> 提醒：以上除 EXISTING_VERIFIED / EXISTING_PARTIAL 外，均不代表后端已实现。等级 B、C 的项目**尚未**由本流程实际运行或截图验证。
>
> 探索页（EXPLORE-001 ~ 006）已由 Open Design 按 004 号契约接入 `GenzoDataProvider`；桌面壳仍需 Codex 在 `src/data/tauriProvider.ts` 补齐四个探索委托，否则界面显示「尚未接入」错误态（不伪造数据）。详见 `CONTRACT_CHANGELOG.md` 005。
