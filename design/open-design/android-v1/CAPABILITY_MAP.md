# Genzo Android 首版 — 能力映射与接口对照

> 能力状态的唯一事实来源是根目录 `BACKEND_CAPABILITY_MATRIX.md`；本文件把它投影到 Android 移动端 UI，标明首版是否呈现、如何呈现、状态如何表达。
> 状态含义：`EXISTING_VERIFIED` 已实现 / `EXISTING_PARTIAL` 部分 / `NEW_REQUIRED` 待补齐 / `MOCK_ONLY` 仅原型 / `FUTURE` 规划 / `NEEDS_CONFIRMATION` 待确认 / `REJECTED` 永不做。

## 1. 首版页面 ↔ 能力

| 能力 ID | 状态 | 移动端页面 / 元素 | 原型表达 |
|---|---|---|---|
| HOME-001 | EXISTING_VERIFIED | 首页、媒体库、收藏 | 焦点作品、最近添加、作品网格 |
| HOME-002 | NEW_REQUIRED | 首页「继续观看」、详情进度条 | 进度为示例值，接入前不持久化 |
| EXPLORE-001 | NEW_REQUIRED | 探索（Future） | 仅预留入口，标注 Future |
| EXPLORE-002 | NEW_REQUIRED | 探索（Future） | 未提供入口 |
| EXPLORE-003 | EXISTING_PARTIAL | 探索（Future） | 未提供入口 |
| EXPLORE-004 | FUTURE | 探索（Future） | 未提供入口 |
| EXPLORE-005 | MOCK_ONLY | 探索（Future） | 未提供入口 |
| EXPLORE-006 | NEW_REQUIRED | 探索（Future） | 未提供入口 |
| LIBRARY-001 | EXISTING_PARTIAL | 媒体库筛选 / 搜索 | 前端筛选；服务端筛选待确认 |
| LIBRARY-002 | EXISTING_VERIFIED | 来源管理「本地目录」、添加来源 | 启用/停用/校验/扫描/删除 |
| LIBRARY-003 | FUTURE | 来源管理「WebDAV」 | 仅配置外壳 + 鉴权失败态，标 Future |
| LIBRARY-004 | FUTURE | 来源管理「网盘」 | 仅配置外壳 + 授权拒绝态，标 Future |
| LIBRARY-005 | EXISTING_PARTIAL | 来源管理校验 / 启停 | 校验为示例，无独立连接检测契约 |
| BOOKSHELF-001 | EXISTING_VERIFIED | 书架（Future 预留） | 仅预留入口 |
| DETAIL-001 | EXISTING_VERIFIED | 作品详情 | 封面、简介、标签、信息 |
| DETAIL-002 | EXISTING_PARTIAL | 详情分集、播放器 | 文件级分集；无独立章节聚合与进度 |
| DETAIL-003 | EXISTING_PARTIAL | 详情作品信息 | 作者/连载/年份为示例 |
| DETAIL-004 | EXISTING_VERIFIED | 详情评分 | 网络评分为示例；读者评分可映射 0–10 |
| DETAIL-005 | EXISTING_VERIFIED | 详情点评 | 原型为前端状态 |
| DETAIL-006 | EXISTING_VERIFIED | 详情元数据识别 + 手动选择 | 重新识别 / 候选 / 确认 |
| DETAIL-007 | NEW_REQUIRED | 详情制作人员与角色 | 图像标「授权待确认」 |
| SCAN-001 | EXISTING_VERIFIED | 来源管理扫描状态 | 进度 / 指标；无暂停语义 |
| SCAN-002 | EXISTING_VERIFIED | 扫描失败项 | 截断展示 + 重试 |
| MATCH-001 | EXISTING_VERIFIED | 待整理分组 | 分组 + 文件数 + 待整理徽标 |
| MATCH-002 | EXISTING_VERIFIED | 手动选择候选 | 搜索 + 候选 + 置信度（示例） |
| MATCH-003 | EXISTING_VERIFIED | 字段锁定 | 详情识别面板内表达 |
| PLAYER-001 | EXISTING_VERIFIED | 播放器 / 外部工具 | 播放器 + 外部工具替代路径 |
| PLAYER-002 | NEW_REQUIRED | 阅读器 | 书架内标 Future |
| TOOLS-001 | EXISTING_VERIFIED | 我的 → 播放不支持替代 | 外部工具打开（原型示例） |
| SETTINGS-001 | EXISTING_VERIFIED | 我的 / 设置 | 主题、目录、来源 |
| SETTINGS-002 | NEW_REQUIRED | 我的（下载与备份） | 首版未设入口，标 Future |
| SETTINGS-003 | NEEDS_CONFIRMATION | 我的（数据源） | 未承诺远程服务 |
| THEME-001 | EXISTING_PARTIAL | 我的 → 外观 | 深/浅/跟随系统；强调色固定 |
| APP-001 | MOCK_ONLY | 全局 Toast / Dialog / 抽屉 | 接入真实操作后复用 |
| COMPLIANCE-001 | REJECTED | — | 不提供聚合/下载/分发入口 |

## 2. 状态表达规范（移动端）

- **本地 / 远程**：来源行 kind 与徽标（本地目录 / WebDAV / 网盘）。
- **在线 / 离线**：离线状态为空态 + 「缓存可用」说明；远程来源不可用。
- **已匹配 / 待确认**：详情元数据面板「已匹配」徽标；待整理候选需确认。
- **扫描 / 刮削**：扫描状态面板（进行中 / 完成但有失败 / 重试）；刮削候选在待整理。
- **已有 / 无本地 / 不支持**：剧集卡徽标；无本地禁用播放；编码不支持给替代路径。

## 3. 接入待决问题（沿用桌面端清单）

1. 观看进度与章节聚合主键（文件级 / 剧集级）。
2. `list_works` 是否增加服务端筛选参数。
3. 角色图像缓存与授权记录方式。
4. 探索数据源（Bangumi 之外）许可与限流（Future）。
5. 阅读器页码模型（Future）。
6. 下载与备份写盘范围与权限（Future）。
7. 原生播放器事件契约命名与生命周期（见 `UI_HANDOFF.md`）。

## 4. 设计演示数据声明

原型中所有作品、评分、排行、来源、扫描指标、候选与时间为**固定示例数据**；原型不发起网络请求、不读写用户文件；角色图像为本地设计参考素材，来源与授权未确认，不得随产品发布。未实现能力在界面或文档中标记 `Future` / 「未实现」，操作反馈统一带「（示例）」，不伪装成功。
