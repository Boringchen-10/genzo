# Genzo UI Design v1.1.2 — Design Changelog

设计版本：**Genzo UI Design v1.1.2**（v1.1.1 的定点修订）  
日期：2026-09-14  
基线：**v1**、**v1.1** 与 **v1.1.1** 保持只读，未覆盖、未删除、未重命名

## v1.1.2 的修改（相对 v1.1.1）

| 功能 ID | 修改前 | 修改后 | 原因 | 页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| A11Y-003 | 打开作品详情时，Overlay Manager 把 `.sidebar` 一并设为 `inert`，左侧导航点不动，必须先“返回”才能切页 | 详情页按**整页**（而非模态弹窗）处理：当 `#detailPage` 位于最上层时**不对 `.sidebar` 施加 `inert`**，左侧导航保持可见可点（点击导航沿用既有逻辑：先关闭详情再切页）；其它模态弹窗仍会令整个背景（含侧栏）`inert` | 详情页内可直接切换页面，去掉别扭的“先返回”步骤 | 全局框架 · 作品详情 · 左侧导航 | 无 | 否 |
| A11Y-004 | 打开设置抽屉时，`.sidebar` 同样被设为 `inert`，左侧导航点不动 | 与 A11Y-003 同样处理：`#themeDrawer` 位于最上层时**不对 `.sidebar` 施加 `inert`**；点击导航会先关闭抽屉（`closeDrawer()`）再切页 | 设置打开时也能直接用左侧栏切页 | 全局框架 · 设置抽屉 · 左侧导航 | 无 | 否 |
| SHELL-004 | 标题栏在上一轮被改成 `rgba(var(--shade),.58)` + `backdrop-filter: blur(18px)`（浅色同值），在首页大图上读作一条半透明色带 | 标题栏恢复**完全透明**：`background: transparent`，去掉 `backdrop-filter` 与底部分隔线，标题栏与首页大图 / 页面背景直接融合 | 上一轮擅自改动了顶部的透明度，按要求还原 | 全局 · 标题栏 | 无 | 否 |

## v1.1.2 实现阶段修订：探索页正式接入 Bangumi 数据（2026-09-14）

后端已交付 Bangumi 探索契约（`CONTRACT_CHANGELOG.md` 004）。Open Design 在正式仓库 `H:\二次元阅读器` 的 `src/pages/ExplorePage.tsx` 上把探索页从设计占位改为真实取数；本表记录的是**实现期的界面修订**，不新增页面。

| 功能 ID | 修改前 | 修改后 | 原因 | 页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-001 | 探索页为「Prototype · Future」占位，使用本地 `samples` 假数据 | 改用 `getExploreOverview`：本季番组 + 最高热度（竖版海报网格），含加载 / 空 / 错误 / 缓存 / 数据源错误态 | 移除假数据，接入已交付后端 | 探索 | 无（只读 `ExploreOverview` / `ExploreSubject`） | 否 |
| EXPLORE-002 | 分类 Tab 中除「推荐」外全部禁用，原因不明 | 「推荐」「本季」可用（真实数据 + 年月筛选）；「动画」「漫画」保持禁用 + `Future` + tooltip 说明缺少的契约 | 不伪造未接入的能力 | 探索 | NEW_REQUIRED（全量浏览、漫画数据源） | 否 |
| EXPLORE-003 | 无网络评分展示 | 卡片与详情展示网络评分、排名、评分人数、收藏人数；缺失时显示「暂无网络评分」「暂无排名」；明确标注不是个人评分 | 网络评分不得与个人评分混淆 | 探索 · 条目详情 | 无 | 否 |
| EXPLORE-004 | 无加入媒体库能力 | 详情弹窗内选择追番状态 + 收藏开关 → `saveExploreSubject`；成功后刷新本地标记并可「打开作品」 | 让已接入能力真正可用 | 探索 · 条目详情 | 写入 `works` / `work_external_ids`（后端负责） | 否 |
| EXPLORE-006 | 搜索框禁用（`Future`） | 真实搜索（`searchExplore`，Enter 提交、可清除、无结果空状态、错误 Toast） | 后端已提供搜索命令 | 探索 | 无 | 否 |
| EXPLORE-009 | 无封面 / 破图时无占位 | 网络封面加载失败或缺失时回退 `MediaVisual` 自制占位封面 | 封面缺失属常态 | 探索 | 无 | 否 |
| EXPLORE-010 | 数据源异常无提示 | `stale=true` 显示低干扰缓存提示；`sources.available=false` 显示数据源错误并说明本地媒体库不受影响 | 明示真实状态，不假装成功 | 探索 | 无 | 否 |
| EXPLORE-011 | 探索页样式复用占位版（含假数据背景图渐变） | 新增 `src/explore.css`；沿用冻结令牌，无阴影 / 光晕 / 装饰渐变 | 真实封面为竖版海报 | 探索 | 无 | 否 |
| EXPLORE-012 | 「新番时间表」禁用但未说明原因 | 保持禁用，tooltip 说明需要新增后端「按星期分组的放送时间表」 | 契约未提供 | 探索 | NEW_REQUIRED | 否 |

## v1.1.2 补充修订：首页精选背景随作品更换（2026-09-14）

| 功能 ID | 修改前 | 修改后 | 原因 | 页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| HOME-005 | 首页精选大图固定为 `assets/reference-primary.png`；切换「切换到其他作品」只改 `background-position`（同一张图的不同裁切），观感上背景不随作品更换 | `featuredWorks` 每部作品新增 `tint`；`selectFeatured()` 把 `.hero-art` 背景改为 `linear-gradient(tint,tint), url("assets/reference-primary.png")` 并设 `background-blend-mode: color`，使同一张自制抽象位图按作品取色；缩略图 `hero-nav-thumb` 同步取色；初始化即调用 `selectFeatured(0)`，首屏与切换后一致 | 首页背景需随作品更换 | 首页 · 精选大图 · 切换到其他作品 | 无（纯原型；正式前端 `HomePage` 已按作品真实封面切换背景） | 否 |
| HOME-006 | 浅色主题下首页精选大图被**两层近乎不透明的白色遮罩**覆盖（`.hero-art::after` 的 `rgba(--shade, .98→.12)` 加上 `.hero::after` 的 `rgba(243,246,245,.86→0)`），背景图基本看不见 | 浅色主题只保留**一层**文字遮罩并提前淡出：`.hero-art::after` 改为 `rgba(243,246,245,.78→0)`（78% 处完全透明），`.hero::after` 降为 `rgba(243,246,245,.3→0)`（68% 处透明），`.hero-art` 透明度 `1` | 浅色过白导致背景图看不清 | 首页 · 精选大图 · 浅色主题 | 无 | 否 |
| HOME-007 | 正式前端首页横幅把作品封面（真实为 **2:3 竖版海报**，约 0.71）整屏 `cover` 铺满 552px 高的宽横幅，导致海报被极度放大裁切，比例失真 | 正式 React 前端（`HomePage.tsx` + `v1-1-1.css`）：封面改为右侧**保持自身比例的清晰海报**（`height:82%` + `width:auto` + `object-fit:contain`，≤1040px 隐藏），背后用同一封面的**模糊放大副本**作氛围填充；浅色遮罩同步减弱（`.8→0` @56%） | 背景图比例不对、浅色过白 | 首页 · 横幅 · 浅色主题（正式前端） | 无 | 否 |
| HOME-008 | 作品详情页顶部背景是**固定的** `assets/reference-secondary.png`——对每部作品都是同一张，点开详情时看着仍像「首页那张背景图」 | `openDetail()` 按当前作品取色：新增 `tintFor(title)`（精选作品用其 `tint`，其余按标题派生稳定、克制的色相），把 `.detail-backdrop` 背景改为 `linear-gradient(tint,tint), url("assets/reference-secondary.png")` + `background-blend-mode: color` | 详情页应显示当前作品的背景 | 作品详情 · 顶部背景 | 无（原型示例作品无真实封面，故以按作品取色的自制抽象位图代替；正式前端详情页已用 `--detail-artwork` 取作品真实封面） | 否 |

## 回退记录：探索页构图同步已撤销（2026-09-14）

曾按「以正式实现为准，同步原型 / handoff」把 v1.1.2 探索页同步为正式实现的构图（提交 `15005e0`）。复核后认为**原探索页更好**，本轮把 `prototype/index.html`、`design-export/index.html` 及该次同步涉及的文档条目**整体回退**到同步前（`15005e0` 的父提交）：探索页恢复为「大标题 + 数据源 note + 最高热度横向卡 rail + 筛选 + 推荐作品网格」。回退仅影响 v1.1.2 的探索页与其文档条目，其它页面与 v1 / v1.1 / v1.1.1 未动。

## 正式前端对齐：探索页改回旧版构图（2026-09-14）

按指示把正式 React 前端（`src/pages/ExplorePage.tsx` + `src/explore.css`）的探索页也改回上面回退后的旧版构图，原型与实现再次一致。数据仍走已交付的 Bangumi 契约，不引入假数据，也不改回「Prototype / 数据源待接入」的旧文案。

| 功能 ID | 修改前 | 修改后 | 原因 | 页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-013 | 标题区为「数据源徽标 + 大标题 + 本季/热度计数」的 intro 块 | 恢复旧版：大标题 + 说明文案 + 右侧数据源 note（季度 · 数据源 / 本季与热度计数 / 数据时间），去掉徽标 | 旧版构图更好 | 探索 · 标题区 | 无 | 否 |
| EXPLORE-014 | 热度与列表合为一个按 Tab 切换的海报网格（标题在「最高热度 / 本季番组」间切换） | 拆回旧版两段：先「最高热度」横向卡片 rail（取 trending 前 5），再「推荐作品」海报网格（随 Tab / 搜索切换） | 旧版构图更好 | 探索 · 列表区 | 无 | 否 |
| EXPLORE-015 | 「新番时间表」入口位于海报网格标题行 | 移到「最高热度」标题行；网格标题行仅保留搜索态的「清除搜索」 | 与旧版构图一致 | 探索 | NEW_REQUIRED（按星期分组的时间表） | 否 |

## 探索页：删除「最高热度」横排，条目详情改用作品详情页版面（2026-09-15）

按指示把探索页收敛成与作品详情页一致的阅读体验：**删除「最高热度」横向卡片区**；**点开探索条目不再用独立弹窗，而是打开作品详情页那种整页详情**（背景图 + 顶栏 + 封面 / 标题 hero + 网络数据 + 简介与标签 + 右侧条目信息）。

原型侧：探索卡片此前已通过 `openDetail(card, 'explore')` 打开 `#detailPage`（作品详情页），本次只删除热度区及其样式与监听。正式前端：从 `Modal` 弹窗改为整页 `detail-page` 版面。两份同步落地。

| 功能 ID | 修改前 | 修改后 | 原因 | 页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-016 | 探索页 Tab 下方有「最高热度」横向卡片区（5 张 heat card + 禁用的「新番时间表」） | 整段删除：移除 `.heat-section` / `.heat-rail` / `.heat-card*` 样式、`#exploreContent` 内的 heat 标记与 `.heat-card` 点击监听；列表直接进入「推荐作品」海报网格 | 该区块与列表重复，按要求舍弃 | 探索 · 列表区 | 无 | 否 |
| EXPLORE-017 | 点开探索条目弹出独立小弹窗（`.gnz-explore-detail-*`，`Modal width="large"`） | 改为**作品详情页版面**：整页 `detail-page / detail-backdrop / detail-inner / detail-topbar / detail-hero / detail-cover / detail-copy / detail-body / detail-main / detail-side`，含封面、原文标题、别名、网络评分 / 排名 / 人数统计、简介与标签、右侧「条目信息」栏，以及底部「加入媒体库 / 追番状态 / 收藏」；返回按钮回到探索列表 | 与作品详情页统一 | 探索 · 条目详情 | 无 | 否 |
| EXPLORE-018 | 正式前端 `src/explore.css` 的热区样式与旧弹窗样式 | 移除 heat 与旧弹窗规则（`.gnz-explore-detail-top/-cover/-copy/-about/-save`、`.gnz-explore-save-row`、`.gnz-explore-tag`），保留统计 / 提示 / 错误样式并新增详情页桥接规则（`.gnz-explore-detail-page`） | 与实现一致 | 前端样式 | 无 | 否 |

## 相对 v1.1 的修改（v1.1.1 已生效，仍然有效）

| 功能 ID | 修改前 | 修改后 | 原因 | 页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| SHELL-002 | 标题栏为独立纯色带；首页栏（`首页` 面包屑、搜索框、图标）压在标题栏之下被遮挡 | 标题栏为半透明表面（`.58` + `blur(18px)`）；首页大图仍从窗口 y=0 铺开、与标题栏融合，仅首页栏 `.topbar` 下移到标题栏之下（`top: var(--win-titlebar)`），不再被遮挡，也不把整页内容整体推下 | 标题栏与内容不重叠，同时保留大图与标题栏的连续 | 全局 · 首页 | 无（桌面壳负责行为） | 否 |
| SHELL-002 | 标题栏底线/描边、浅色下透明发灰；浅色标题栏底色 `rgba(255,255,255,.72)` 比页面背景更白，仍形成一条色带边界 | 移除底部分隔线；深色与浅色标题栏底色统一为 `rgba(var(--shade),.58)`（等于页面背景色），不再出现色带或分界线；关闭悬停危险色 | 视觉稳定性 | 全局 | 无 | 否 |
| LIBRARY-003 | WebDAV 来源可点、可进配置 | 禁用 + `Future` 徽标 + tooltip | 无正式后端，避免误导 | 媒体库 · 来源 | FUTURE | 否 |
| LIBRARY-004 | 网盘来源 / 授权可点，显示「已连接」等 | 禁用 + `Future` 徽标；远程行「已连接 / 已授权 / 已同步」→「尚未开放」；不计入来源与作品统计 | 禁止虚假状态 | 媒体库 · 来源 | FUTURE | 否 |
| TOOLS-002 | 工具页「一键下载」可用 | 下载按钮禁用 →「尚未开放」+ tooltip；副标题改 Future | 无下载后端 | 工具 | FUTURE | 否 |
| SETTINGS-002 | 「下载与备份」像当前可用，含当前语气文案 | 标签加 `· Future`；控件禁用；Future 说明；删除「新下载…保存到这里」文案 | 无备份后端 | 设置 | FUTURE | 否 |
| SCAN-005 | 「已完成 68%」等百分比 | 运行期只显示「正在扫描（无实时进度）」，任何 `%` / 「已完成 N」被拦截改写 | 后端只有最终统计 | 媒体库 · 扫描状态 | NEW_REQUIRED（实时事件） | 否 |
| SCAN-006 | 「目录组 12」 | 改「目录组（需新增后端）」，值 `—` | 无目录组统计 | 媒体库 · 扫描状态 | NEW_REQUIRED | 否 |
| SCAN-003 | 「重试失败项」 | 「重新扫描此目录」+ tooltip 说明整目录重扫 | 与实现语义一致 | 媒体库 · 扫描状态 | EXISTING_VERIFIED | 否 |
| MATCH-005 | 手动匹配弹窗透明重叠、高度不稳 | 不透明表面；`max-height: min(90vh, calc(100vh - 88px))`（≤700px 高时 `- 40px`）；内容独立滚动；头/底 sticky；长文本 `overflow-wrap:anywhere` | 1024×640 可读性 | 手动匹配弹窗 | 无 | 否 |
| A11Y-001 | 焦点陷阱仅覆盖部分弹层 | 统一 Overlay Manager 覆盖 10 个弹层；背景 `inert`；Tab 循环；Esc；焦点返回；嵌套只顶层响应 | 可访问性 | 全部弹层与抽屉 | 无 | 否 |
| A11Y-002 | 部分图标按钮缺名称 | 全部图标按钮补齐 `aria-label` 与 `title` | 可访问性 | 全局 | 无 | 否 |
| THEME-002 | 浅色主题整页白色渐变、洗白 | 移除整页渐变，改局部文字遮罩（宽 `min(760px,64%)`）；提升次要文字对比；背景保持可见 | 可读性与层次 | 首页、详情 | 无 | 否 |
| ASSET-001 | 参考图含其他界面文字与未授权动漫截图；角色图为截图裁切 | 全部替换为 Open Design 自制抽象几何占位图（2 背景 + 6 头像），文件名不变 | 许可证与视觉判断 | 素材 | 无 | 否 |
| DOC-001 | 文档后附 v1.1-draft / v1 全文，出现新旧矛盾结论 | 当前文档只保留 v1.1.1 结论；历史移入 `HISTORY.md` | 消除文档矛盾 | 全部文档 | 无 | 否 |
| DOC-002 | `UI_HANDOFF` 出现 `recognize_media` | 更正为 `recognize_media_file`（内部函数名单独说明） | 与真实命令一致 | 文档 | 无 | 否 |
| DOC-003 | `ASSET_SOURCES` 同时声称「实际引用位图」与「抽象 CSS 封面」 | 统一为「自制几何占位图」，逐项记录来源/许可/可发布/替代 | 文档与实际一致 | 文档 | 无 | 否 |
| DOC-004 | `SCREENSHOT_CHECKLIST` 预填 ✓ | 全部改为「待验 / 未验证」，并区分 A/B/C 验证等级 | 未检查不得标记通过 | 文档 | 无 | 否 |

## 保留（未删除、未缩减）

首页、探索、媒体库、收藏、工具、设置；作品详情；作品组形式的待整理；动画作品组 → 季度 → 剧集 → 视频 / 字幕下钻；漫画「作品 → 卷/话 → 图片」；批量确认 / 批量重新识别的 **Future 入口**；Bangumi 探索 MVP 页面结构（已实现阶段升级为正式数据版本，结构保留）；深浅主题；左侧窄导航；播放器 / 阅读器选择；元数据编辑；候选对比。

## 未执行项（受不可绕过的边界限制）

| 项 | 原因 | 替代 |
|---|---|---|
| 运行独立原型并生成 1024×640 / 1366×768 / 1920×1080 截图 | 执行边界禁止对生成物做渲染 / 预览 / 截图 | `SCREENSHOT_CHECKLIST.md` 人工验收清单（A/B/C 分级） |
| 运行时验证 Dialog / Drawer 的 Tab 循环、Esc、焦点返回 | 同上 | 源码级实现 + 转录为 B 级待验 |
| 200% 缩放模拟 | 同上 | B 级待验 |
| 运行正式 React 探索页并生成三尺寸截图 / 走查交互 | 执行边界禁止对生成物做渲染 / 预览 / 截图 | 源码级实现 + `SCREENSHOT_CHECKLIST.md` 人工验收清单（A/B 分级） |
| 真实 Tauri 标题栏行为 | 需桌面壳运行 | C 级待验，已在 `UI_HANDOFF.md` 列出所需 API |

## 机器可判定结果（已完成）

- `prototype/index.html` 与 `design-export/index.html` 的 **SHA-256 完全一致**：`FF0E03CE57B5AF672CDBF15ED2980B3AFDEBCF04A05105EF4E4B2936B490265F`
- 两套 `assets/` 的 8 个文件**内容一致**（逐文件 SHA-256 比对通过）。
- 全部本地素材引用（`assets/reference-*.png`、`assets/characters/character-1..6.png`）在两种目录结构中均可解析。
- 只读基线未变：v1 `index.html` = `8C4E26522149…`，v1.1 原型 = `1C2D3EDC37D3…`。
- 正式仓库实现（Open Design 分支 `design/explore-frontend`，基于 `bcc5f21`）：`pnpm run check`（`tsc -b`）通过、`pnpm run test` 16 项通过、`pnpm run build` 生产构建通过。

## 正式仓库

在协作模型（见 `FRONTEND_OWNERSHIP.md`）下，Open Design 的 v1.1.2 探索页修订**直接写入正式仓库** `H:\二次元阅读器` 的 `src/`，分支 `design/explore-frontend`（基于后端提交 `bcc5f21`）。未改动 `src-tauri/`、Rust、SQLite 与迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`，未提交正式仓库默认分支。

## 正式前端对齐：首页「我的书架」（2026-09-15）

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| HOME-009 | 书架是横版图片卡（封面铺底、标题压在图上、卡片比例 1.28），分类是一排**不可点**的静态标签 | 改为本原型 v1.1.2 的海报卡：**2:3 竖版海报** + 左下类型角标 + 右上收藏星标，标题与「N 个文件 · 状态」位于海报下方；分类改为**可点筛选 chip**（全部 / 动漫 / 漫画 / 小说 / 游戏），选中即过滤书架 | 程序与设计不一致，且分类无法使用 | 首页 · 我的书架 | 无（复用既有 `list_works` / `get_dashboard`） | 否 |

- 改动文件：`src/pages/HomePage.tsx`、`src/v1-1-1.css`；提交 `a22b769`（分支 `codex/anime-metadata-v02`）。
- 数据源：优先 `list_works`（完整作品列表，供分类筛选），失败时回退 `get_dashboard.recentWorks`；两者均为已有契约，**未新增后端需求**。
- 设计原型里的「来源筛选」一行（全部来源 / 本地 / WebDAV / 网盘）本版**未加入**：`WorkListItem` 没有来源字段，且 WebDAV / 网盘按项目规则仍属 Future，加入即等于展示假状态。若需要该行，需后端先提供作品来源字段（登记为 NEW_REQUIRED）。
- 分类文案沿用应用既有词汇「动漫」（`mediaLabels.video`），未改成原型里的「动画」。
- 视觉验收：未渲染 / 未截图（写入即交付），三尺寸与深浅主题见 `SCREENSHOT_CHECKLIST.md`。

## 正式前端：探索「推荐」页与季度筛选解耦（2026-09-16）

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-010 | 「推荐」页取 `overview.trending`，而后端**只在当前季度**返回 Bangumi 每日放送（`explore.rs` `overview()` 第 143 / 212 行），因此把年份 / 月份筛到历史季度后「推荐」直接空白 | 「推荐」页改为**始终请求当前季度**（`exploreOverview(null, null)`）并与年份 / 季度筛选**解耦**；标题改为「本季热度 · 按 Bangumi 评分人数与收藏人数排序 · 不受年份 / 季度筛选影响」；年份 / 月份下拉在「推荐」页置为**禁用**并给出一行说明；空状态按热度榜自己的数据源提示 | 「推荐」依赖季度筛选会没有内容，属于数据流缺陷 | 探索页 · 推荐 | 无（复用既有 `exploreOverview`，不新增接口） | 否 |
| EXPLORE-020 | 无「动画排行」入口 | 以 `Future` 徽标保留结构 + 说明（需新增后端：全量动画评分 / 排名数据源） | 本地番组索引无评分子段，`discovery_list` 的 `score` / `popularity` 排序无依据，不能假造排名 | 探索页 · 推荐 | **NEW_REQUIRED**（见能力矩阵） | 数据源与许可待 Codex 确认 |
| EXPLORE-021 | 无「注目动画」入口 | 同上，保留结构 + 说明（需新增后端：Bangumi 最近 30 日标记聚合） | 现有网络源只有每日放送（当季）与 AniList 按 id 查详情，没有 30 日标记数据 | 探索页 · 推荐 | **NEW_REQUIRED**（见能力矩阵） | 数据源与许可待 Codex 确认 |

- 改动文件：`src/pages/ExplorePage.tsx`、`src/explore.css`；提交见交付报告（分支 `codex/anime-metadata-v02`）。
- 「本季」标签页保持原样：年份 / 季度筛选、标签筛选、番组索引列表。
- 未夸大能力：热度榜仍是「当季 · 按人数排序」，**不是** 30 日标记，也没有全量排行；两处缺口以 Future 形式如实标出。
- 视觉验收：未渲染 / 未截图（写入即交付），三尺寸与深浅主题见 `SCREENSHOT_CHECKLIST.md`。

## 正式前端：季节 / 年份筛选移入「本季」并改用四季（2026-09-16）

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-014 | 季节（月份）/ 年份两个下拉与「标签」同放在上方筛选面板；在「推荐」页里被置灰并附一行说明 | 两个下拉**移入「本季」列表内部**（标题之下、网格之上），只在「本季」出现；上方筛选面板只保留标签筛选（带自己的「重置标签」） | 季节 / 年份本来就只作用于「本季」，放在共享面板里既不属于「推荐」，又要靠禁用 + 说明解释 | 探索页 · 筛选面板 / 本季 | 无（仍用 `exploreOverview(year, month)`） | 否 |
| EXPLORE-015 | 下拉文案为「1 月新番 / 4 月新番 / 7 月新番 / 10 月新番」+「全部月份」 | 改为四季：**冬季（1 月）/ 春季（4 月）/ 夏季（7 月）/ 秋季（10 月）** +「全部季节」；季节标签同步为 `2026 年夏季新番` | 与动画播出档期（1 / 4 / 7 / 10 月）对应，更符合使用习惯 | 探索页 · 本季 · 季节标签 | 无 | 否 |
| EXPLORE-016 | 年份下拉只列「当前年 −6 ~ 当前年 +1」 | 年份下拉改为 **2000 年 ~ 明年，新的在前**（约 28 项） | 查历史番组时需要更远的年份 | 探索页 · 本季 | 无 | 否 |

- 改动文件：`src/pages/ExplorePage.tsx`、`src/explore.ts`（新增 `courSeason()`，`courLabel()` 改为 `2026 年夏季新番`）、`src/explore.css`（新增 `.gnz-season-filter`，删除已无用的 `.gnz-filter-selects` / `.gnz-filter-hint`）。
- 「推荐」页不受影响：热度榜仍始终取当前季节，与季节 / 年份无关。
- 视觉验收：未渲染 / 未截图（写入即交付），三尺寸与深浅主题见 `SCREENSHOT_CHECKLIST.md`。

## 设计稿同步：v1.1.2 原型的探索筛选改为「四季 + 本季专有」（2026-09-16）

上一轮只改了正式前端，**交接原型（`prototype/index.html` / `design-export/index.html`）没有跟着改**，所以在预览里看到的仍是旧面板设计。本轮把设计稿对齐到前端实现：

| 功能 ID | 修改前（原型） | 修改后（原型） | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-017 | 「筛选」面板里同时放**动漫标签 + 年份 + 月份**（两个下拉），对「推荐 / 本季 / 动画 / 漫画」四个标签页都生效 | 面板**只留动漫标签**（含自己的「重置标签」）；季节 + 年份下拉**移进「本季」**，仅在选中「本季」时出现，**靠右**放在列表标题之下、作品网格之上，并带「重置」 | 季节 / 年份本来就只服务于「本季」；放在共享面板里既不属于「推荐」，也要靠解释说明 | 探索页 · 筛选面板 / 本季 | 无 | 否 |
| EXPLORE-018 | 月份下拉列 **1–12 月**（12 项） | 改为 **四季**：冬季（1 月）/ 春季（4 月）/ 夏季（7 月）/ 秋季（10 月）+ 全部季节；探索页右侧数据源 note 也改为随当前日期计算的 `2026 年夏季新番 · Prototype` | 与动画播出档期（1 / 4 / 7 / 10 月）对应，并与正式前端文案一致 | 探索页 · 本季 | 无 | 否 |
| EXPLORE-019 | 年份下拉只列示例数据里出现过的年份（2024–2026） | 年份下拉改为 **2000 年 ~ 明年，新的在前**（约 28 项） | 与正式前端一致，便于查看历史番组 | 探索页 · 本季 | 无 | 否 |

- 改动文件：`design/open-design/v1.1.2/prototype/index.html`、`design-export/index.html`（四份副本逐字节一致，SHA-256 `A000E0C1989FADE07AE903B3CEF51D8BC84EC10A20ACB67875C294E4180A4069`）；配套微调 `src/explore.css`（`.gnz-season-filter` 加 `justify-content: flex-end`，与设计稿同样靠右）。
- 已知差异（刻意保留，不改）：原型示例数据没有完整的季度索引，所以原型里「全部季节」= 不按月过滤；正式前端「全部」会由后端规范化到**当前季度**。原型仍全程标注 `Prototype` / 示例数据。
- 视觉验收：未渲染 / 未截图（写入即交付），三尺寸与深浅主题见 `SCREENSHOT_CHECKLIST.md`。

## 正式前端：接入动画详情结构与官方排行榜（2026-09-16）

接入 Codex 的契约 012（`get_anime_work_structure` / `refresh_work_metadata` / `set_media_episode` / `get_media_thumbnail` / `get_anime_ranking`）。**保持 v1.1.2 已确认的详情页与探索页版式，不重新设计。**

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| DETAIL-002 | 「章节与文件」把 `mediaFiles` 平铺成互相重复的卡片，无法表达「一个官方分集有多个本地压制版本」 | 改为**官方分集 → 本地多版本**两层：每个官方分集显示集号、标题（无标题时回退「第 N 集」）、原名、放送、时长、简介，其下逐一列出本地版本（文件名、媒体信息、大小、可用状态、打开 / 更多操作） | 012 的分集语义以官方分集为基准，多个压制版本可关联同一分集，不能按集数去重 | 作品详情 · 章节与文件 | 已实现（`AnimeWorkStructure`） | 否 |
| DETAIL-003 | 详情页没有关联作品 / 季度信息 | 新增**关联作品**区：显示 `relation`，**只有 `seasonNumber !== null` 才显示「第 N 季」**，剧场版 / OVA / 续集按 `relation` 如实标注；`localWorkId` 存在时可跳转本地作品，为空显示「未入库」 | 012 明确 `seasons` 来自 Bangumi **关联条目**，不保证每项都是季度 | 作品详情 · 关联作品 | 已实现 | 否 |
| DETAIL-006 | 元数据识别面板只有「重新识别」（走候选确认），没有刷新入口 | 新增**刷新元数据**按钮：调 `refreshWorkMetadata`，成功后**重新** `getWork()` + `getAnimeWorkStructure()`；刷新中禁用防重复点击，成功 / 失败均有提示，**失败保留旧内容** | 012 的刷新绕过 30 天缓存并回填简介与图片，但只返回 `AnimeWorkStructure`，简介与标签必须重读 `getWork` | 作品详情 · 元数据识别 | 已实现 | 否 |
| DETAIL-007 | 「制作人员与角色」显示 `Future` + 「元数据模型尚未包含」 | 接入真实 `staff` / `characters`（头像缺失时显示首字占位，不使用来源不明素材），并显示 012 返回的 `warnings` | 012 已完成制作人员与角色 | 作品详情 · 制作人员与角色 | 已实现 | 否 |
| DETAIL-008 | 详情页没有视频缩略图 | 本地版本左侧缩略图：用 `IntersectionObserver` **只对可见项按需**调 `getMediaThumbnail`，每个文件最多一次；返回 `null` 时显示中性文件占位 | 012 声明 Windows Shell 无法为所有 MKV 生成帧图；**不得用作品海报冒充视频帧** | 作品详情 · 本地版本 | 已实现（PARTIAL，受系统编解码限制） | 否 |
| DETAIL-009 | 无此项 | 字幕与视频的持久化关联：012 只声明了视频 / 集数持久化，**未声明字幕映射表**，故不按旧原型 `subtitleLinks` 假定已实现 | 避免把未确认能力写成已实现 | 作品详情 | 待确认 | 是 |
| INBOX-006 | 逐集手动映射为 NEW_REQUIRED，界面无入口 | 「未匹配文件」区可按文件选择官方分集并「关联」，调 `setMediaEpisode`；已映射文件可「解除分集关联」（传 `null`）；成功后重新读取结构 | 012 已实现 `media_episode_links`（`parsed` 自动 + `manual` 覆盖） | 作品详情 · 章节与文件 | 已实现 | 否 |
| EXPLORE-020 | 「动画排行」是 `Future` 说明，文案写「Bangumi 无批量排行接口」 | 接入真实排行榜：分页「加载更多」、loading / 错误 / 空 / `stale` 缓存标记、入库与收藏角标，可点开条目详情 | 012 已用 Bangumi 官方 `POST /v0/search/subjects` 实现排行；此前的「无接口」结论已被证伪 | 探索页 · 推荐 | 已实现 | 否 |
| EXPLORE-021 | 与 EXPLORE-020 合并在一个 `Future` 说明里 | **单独保留 `Future`**：「注目动画 · 最近 30 日标记」仍无数据源，**不提供入口**，也**不用排行榜或本季热度冒充** | 现有数据源（Bangumi 每日放送 / AniList 按 id 查详情）都没有 30 日标记数据 | 探索页 · 推荐 | **NEW_REQUIRED / NEEDS_CONFIRMATION** | 数据源与许可待确认 |

- 改动文件：`src/data/provider.ts`、`src/data/index.ts`、`src/data/mockProvider.ts`、`src/pages/WorkDetailPage.tsx`、`src/pages/ExplorePage.tsx`、`src/v1-1-1.css`、`src/explore.css`、`design/open-design/v1.1.2/BACKEND_CAPABILITY_MATRIX.md`、`CONTRACT_CHANGELOG.md` 013。
- Mock 行为：`mockProvider.ts` 实现同样五个方法，分集 / 关联作品 / 制作人员全部显式标注「示例」；`getMediaThumbnail` **一律返回 `null`**（不伪造视频帧）；`refreshWorkMetadata` 只在内存里追加一个示例刷新标记，**不模拟持久化成功**；排行榜提供 16 条示例条目以验证分页与空状态。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 视觉验收：未渲染 / 未截图（写入即交付），三尺寸与深浅主题见 `SCREENSHOT_CHECKLIST.md`。

## 正式前端：离线状态与网络图片回退（2026-09-16）

背景：Codex 已提交 `631b8f9 feat(data): connect anime detail provider`，在 `src/data/tauriProvider.ts` 补齐五个委托（仅 +5 行）。此后桌面壳内的动画详情与排行能力**已真实可用**，「尚未接入」状态只在方法缺失时出现。本轮补齐规格中要求但此前缺失的两类状态。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 / 组件 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| FE-DETAIL-005 | 关联作品封面与制作人员 / 角色头像只在 `imageUrl` 为空时用首字占位；**URL 存在但加载失败时显示浏览器破图图标** | 新增 `SafeImage`（`src/components/common.tsx`）：缺失**或加载失败**（`onError`）都回退首字占位，与探索卡片的 `ExploreCover` 回退策略一致 | 规格要求「图片缺失或加载失败时使用稳定占位，不显示破图图标」 | 作品详情 · 关联作品 / 制作人员与角色 | 无（纯渲染） | 否 |
| FE-DETAIL-004 | 没有任何离线状态；网络断开时只能看到笼统的加载失败 | 新增 `useOffline()`（`navigator.onLine` + `online`/`offline` 事件），详情页提示「网络已断开：刷新元数据与视频缩略图可能失败，本地文件仍可打开」，探索页提示「离线时可能只显示本地缓存或加载失败，不影响本地媒体库」 | 规格要求覆盖 Offline 状态，且离线只做**低干扰提示**，不阻断本地媒体库 | 作品详情 · 元数据识别 / 探索页 | 无（纯前端信号） | 否 |
| — | 页面内「需 Codex 在 tauriProvider.ts 中补齐委托」「尚未接入」等**已过时**的用户可见文案 | 改为中性的「当前运行环境未提供该能力」 | `tauriProvider.ts` 已由 Codex 接线，旧文案会把已完成的能力说成未完成，属文档/界面与现实不一致 | 作品详情 · 章节与文件 / 元数据识别；探索页 · 动画排行 | 无 | 否 |

- 改动文件：`src/components/common.tsx`、`src/pages/WorkDetailPage.tsx`、`src/pages/ExplorePage.tsx`、`CONTRACT_CHANGELOG.md` 014、本文件、`BACKEND_CAPABILITY_MATRIX.md`、`SCREENSHOT_CHECKLIST.md`。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），离线提示与图片回退的观感见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：「制作人员与角色」折叠为两行并优先展示主要角色（2026-09-17）

背景：真实作品的 Bangumi 制作人员可达两百余位（本项目实测 222 位制作人员 · 34 位角色）。原实现按「制作人员 → 角色」顺序把卡片全部平铺，整块区域非常长，且前两行全是制作人员。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| DETAIL-007 | 制作人员与角色卡片**全部平铺**，无折叠 | 默认只显示**两行**（按实际栅格行高测量后 `max-height` 裁切，非固定高度），底部渐隐 + **「展开全部 / 收起」** 按钮；内容不足三行时不显示按钮 | 数百张卡片平铺会淹没详情页其它信息 | 作品详情 · 制作人员与角色 | 无（纯渲染） | 否 |
| DETAIL-007 | 卡片顺序固定为**全部制作人员 → 全部角色**，折叠后两行看不到任何角色 | 顺序改为**主要角色（`role` 含「主角 / 主要」）→ 制作人员 → 其余角色**，使折叠态的两行同时包含主要角色与主要制作人员 | 用户要求两行内看到「最主要的角色和制作人员」；按原标题顺序时 222 位制作人员会挤掉全部角色 | 作品详情 · 制作人员与角色 | 无（复用 `staff` / `characters` 原有返回顺序，仅前端重排） | 否 |

- 改动文件：`src/pages/WorkDetailPage.tsx`（`creditsOpen` / `creditsClipped` / `creditsCollapsedHeight` 状态 + 行高测量副作用 + `orderedCredits` 排序）、`src/v1-1-1.css`（`.credits-body` / `.credits-fade` / `.credits-toggle` / `.credits-toggle-icon`）。
- 行高测量：取 `.credit-card` 各行的 `getBoundingClientRect().top`，用第三行顶部减去行间距作为两行高度；`ResizeObserver` + `resize` 重新测量，窗口缩放 / 高 DPI 下自愈。
- 展开态与折叠态使用同一份卡片列表，不做数据裁剪；`aria-expanded` 标记按钮状态，按钮可键盘访问。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），折叠两行的高度与渐隐观感见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：「关联作品」改为从左到右的卡片网格（2026-09-17）

背景：关联作品（`AnimeWorkStructure.seasons`，实测单部作品 7+ 条关联条目）原为**竖向行列表**——每条占一整行（48px 封面 + 一行标题 + 一行关系 + 状态），七条即占满一屏，垂直空间浪费明显。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| DETAIL-010 | 关联作品为**竖向行列表**（`.related-row`：横向 48px 封面 + 文字 + 状态，每条独占一行） | 改为**从左到右的响应式卡片网格**（`repeat(auto-fill, minmax(124px, 1fr))`）：2:3 竖版封面在上，标题 / 「关系 · 第 N 季」/ 状态在下；同一行自动排多张，向下换行 | 用户反馈关联作品占位过多，希望改为从左到右排列 | 作品详情 · 关联作品 | 无（纯渲染，复用 `seasons` 现有字段） | 否 |
| DETAIL-010 | 已入库项渲染为行内按钮「打开本地作品」；未入库为「未入库」文字 | `localWorkId` 存在时**整张卡片即为 `Link`** 跳转本地作品（`aria-label` 说明），状态文案改为「本地已入库」；未入库 / 当前作品仍为静态卡片，状态分别为「未入库」「当前作品」 | 卡片化后行内按钮会破坏网格节奏，整卡可点更符合卡片语义 | 作品详情 · 关联作品 | 无 | 否 |

- 改动文件：`src/pages/WorkDetailPage.tsx`（`related-list` 渲染改为 `related-card` / `related-link` 结构，`Link` 包裹整卡）、`src/v1-1-1.css`（`.related-list` / `.related-card` / `.related-link` / `.related-cover` / `.related-copy` / `.related-state` 重写，删除 `.related-row`）。
- 语义保持：仍按 `relation` 展示，仅 `seasonNumber !== null` 才写「第 N 季」，剧场版 / OVA 等如实标注；`localWorkId` 为空不显示为已入库。
- 长标题与长关系文案：标题与副行均单行 `ellipsis` 截断，`title` 属性保留完整文本。
- 键盘可达：`a.related-link` 有 `:focus-visible` 焦点环；静态卡片无焦点。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），卡片列数、封面比例与换行后的观感见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：集数卡片改为「快照为主 + 详情收纳」（2026-09-17）

背景：官方分集卡片（`.official-episode`）此前把 `episode.description` 直接铺在卡片里。实测单集简介可达 200+ 字，卡片被文字撑满且高度参差，集数快照（文件缩略图 64px）几乎看不见 —— 用户反馈「太臃肿」，希望快照占大头、集数名在快照下方、文件信息以小字置于卡片最下方，并把简介收进「集数详情」。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| DETAIL-011 | 卡片无快照区，仅文件行内有 64px 缩略图 | 卡片顶部新增 **16:9 集数快照**（`.episode-snapshot`），取该集第一个本地视频的帧缩略图；无本地文件时用 `MediaVisual` 中性占位（**继续禁止用作品海报冒充视频帧**）；右下角角标显示「本地 N 个版本 / 无本地文件」 | 用户要求「集数快照占大头」 | 作品详情 · 章节与文件 | 无（复用 `getMediaThumbnail`，懒加载与「每文件仅请求一次」逻辑不变） | 否 |
| DETAIL-011 | 集数标题在卡片首行，右侧为「本地 N 个版本」计数 | 标题移至**快照下方**（`.official-episode-head`），右侧改为「集数详情」入口（`MoreHorizontal`，`aria-label` / `data-tooltip` = 集数详情）；版本计数改为快照角标 | 用户要求「集数名字放到快照下方」 | 作品详情 · 章节与文件 | 无 | 否 |
| DETAIL-011 | `episode.description` 直接铺在卡片内；`originalTitle` 单独一行 | 卡片内**不再渲染简介**；简介、原名、放送日期、时长、本地版本数收进「集数详情」面板（`.episode-detail`，最大高度 `min(360px, 100vh - 160px)`，内容区独立滚动）；无简介时显示「这一集还没有简介。」 | 用户要求把详情收进「集数详情（目前的三个点那里）」 | 作品详情 · 章节与文件 | 无（`description` / `originalTitle` / `airDate` / `duration` 字段未变） | 否 |
| DETAIL-011 | 每个文件行内含 文件名 / 媒体信息 / 状态 / 打开 / 「更多操作」菜单（工具、系统默认程序、打开目录、解除分集关联、解除作品关联） | 卡片最下方改为**小字文件信息**（`.episode-file-info`）：文件名 11px、媒体信息与大小 10px、状态 10px，仅保留主操作「打开」；工具 / 系统默认程序 / 打开所在目录 / 解除分集关联 / 解除作品关联移至「集数详情 → 文件操作」，按文件分组 | 用户要求「文件信息放到集数最下方（小字）」；次要操作收入详情面板，避免卡片出现两处入口 | 作品详情 · 章节与文件 | 无 | 否 |

- 改动文件：`src/pages/WorkDetailPage.tsx`（`LocalFileThumb` 增加可选 `className`；分集卡片重排为 快照 → 标题 +「集数详情」→ 供放送信息 → 底部小字文件信息）、`src/v1-1-1.css`（新增 `.episode-snapshot*` / `.episode-file-*` / `.episode-detail*`；移除 `.official-episode-desc` / `.official-episode-original` / `.official-episode-count` / `.local-version-list` / `.local-version` / `.local-version-state`；`.local-file-thumb` 与 `.local-version-copy` 保留，供「未匹配文件」区块使用）。
- 等高对齐：卡片用 `grid-template-rows: auto auto auto minmax(0,1fr)` + 文件信息 `align-self: end`，同一行内不同高度的卡片，文件信息都贴卡片底部。
- 长文本处理：快照角标 `white-space: nowrap`；文件名与媒体信息单行 `ellipsis` 并保留 `title`（完整路径 / 完整媒体信息）；简介在详情面板内**完整换行显示**，不截断。
- 可访问性：三个入口均为图标按钮，`aria-label` + `data-tooltip` 齐备；`<details>` 原生键盘可达；空状态文案明确。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），快照比例、等高对齐与详情面板在 1024×640 下的表现见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：「未匹配文件」标记失效记录并禁止关联（2026-09-17）

背景：用户发现某作品的「未匹配文件」里列出的 12 个文件与**已匹配到分集的 12 集完全同名**。只读查询真实库 `%APPDATA%\com.genzo.desktop\genzo.db` 确认是**后端数据问题**：该作品 `media_files` 有 24 行但只有 12 个文件 —— 12 行为旧路径（`G:\影音\…`，`missing = 1`、`library_root_id = NULL`、无 `media_episode_links`）的孤儿记录，另 12 行是文件夹移动后重扫新建并已匹配的孪生行。前端此前**原样渲染** `AnimeWorkStructure.unmatchedFiles`，且对 `missing` 行不显示任何状态、照常提供「关联」入口。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| DETAIL-012 | `missing = 1` 的未匹配行与正常行外观完全一致，仍提供「关联到分集」下拉与「关联」按钮 | 这类行加 `is-stale`（虚线描边、标题降为 `--muted`），右侧显示 **「路径已失效」** 徽标 + tooltip（说明路径不存在、无法关联），并**移除关联控件** | 路径不存在的记录不可映射；原实现会把不存在的文件写进 `media_episode_links`，产生「本地 2 个版本（其中一个缺失）」的幻影数据 | 作品详情 · 未匹配文件 | 无（沿用 `MediaFile.missing`；真正的清理需求已交给 Codex，见 `CODEX_TASK_unmatched-stale-rows.md`） | 否 |
| DETAIL-012 | 区块标题只显示总数 | 标题右侧在存在失效记录时追加 **「· N 个记录已失效」** | 让用户一眼看出「这些不是待整理的文件，而是失效记录」 | 作品详情 · 未匹配文件 | 无 | 否 |

- 改动文件：`src/pages/WorkDetailPage.tsx`（新增 `unmatchedStaleCount`；未匹配行按 `file.missing` 分支渲染）、`src/v1-1-1.css`（`.unmatched-row.is-stale`、`.unmatched-state`）。
- 边界说明：**只改前端表现与可操作性，不删任何数据**。根因（孤儿行、跨根扫描不去重、`content_fingerprint` 未落库）属于后端，已写成 `CODEX_TASK_unmatched-stale-rows.md` 交 Codex，未自行修改 Rust/SQLite。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），失效行样式见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：海报顶端淡入页面底色，与标题栏渐变融合（2026-09-17）

背景：自定义标题栏（`.window-titlebar`）是独立的一行、底色为 `var(--bg)`；首页大图 / 详情页背景（`.seanime-banner` / `.detail-backdrop`）从它**下方**才开始，所以标题栏与海报之间是一条**硬边**——用户反馈「我想实现顶部框可以和海报背景图渐变融合」。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| SHELL-005 | 海报顶端直接以画面开始，与上方标题栏形成一条硬边 | 海报的顶层遮罩（`.gnz-home .seanime-banner::after`、`.detail-backdrop::after`）新增 **`linear-gradient(180deg, var(--bg) 0, transparent var(--poster-fade))`**：海报顶端由页面底色淡出，标题栏 → 海报连成一条连续渐变（深浅主题各自取色） | 用户要求标题栏与海报背景**渐变融合** | 首页 / 作品详情（两处共用同一处理） | 无（纯 CSS 遮罩层，不改任何数据或布局） | 否 |

- 新 token：`--poster-fade: 120px`（`v1-1-1.css` `:root`），与 `--win-titlebar` 并列，集中管理融合高度；两处引用同一变量，避免散落硬编码。
- **未改布局**：标题栏仍是独立一行、首页与详情内容仍在标题栏**下方**（沿用 `51f9a49` 的结论，不再做「海报上顶到 y=0 / 标题栏浮层」的方案——那版曾引起重叠问题）。融合通过遮罩渐变实现，因此不会出现内容被遮挡或错位。
- 渐变从 `var(--bg)` 起、`--poster-fade` 处完全透明，而标题栏底色同为 `var(--bg)`，故 y=标题栏下沿处零对比，视觉上是一条连续过渡。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），融合高度与深浅主题观感见 `SCREENSHOT_CHECKLIST.md` 待验行。
- **待用户确认（备选方案）**：当前实现是「海报在标题栏下方淡入」。若用户想要的是**海报画面直接延伸到标题栏后方**（原型 v1.1.2 的做法：标题栏透明浮在图上），那是另一种改法，需要让首页内容上移 `--win-titlebar` 并给侧栏补 `padding-top`——该方案此前一轮曾因顶部重叠被回退，**需用户明确要求后再做**。

## 正式前端：模糊设置接管海报背景，横版横幅按比例完整铺开（2026-09-17）

背景：用户反馈「设置里面的模糊效果并没有实现，我不能控制背景的清晰度；并且海报的比例还是有些问题，希望比较不错地展示海报，而不是海报的简单一部分」。只读核对确认两点都是**前端实现问题**，与后端数据无关：

- 设置里的「玻璃模糊」（`glassBlur`，0–48px）只被用在 `backdrop-filter`（侧栏、浮层、抽屉、详情返回按钮），**完全没作用在海报背景上**；海报背景的模糊是 CSS 里写死的 `blur(44px)`（无横图）/ `blur(6px)`（有横图）/ `blur(40px)`（首页无横图）。
- 海报背景一律 `background-size: cover`：Bangumi 横幅实测多为 **1900×400（约 4.75:1）**，竖版封面则是 2:3，两者用 `cover` 铺进 460/552px 高的宽横幅都会**按高度或宽度单向放大并裁掉一头**——竖版封面在宽横幅里会被放大到只剩中间一小条（用户看到的「简单一部分」）。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| SHELL-006 | 海报背景的模糊是写死的 `40/44px`（有横图时 `6px`），设置里的模糊滑块对它**完全没有影响** | 新增 token **`--poster-blur: var(--ui-blur)`**，海报环境层改用 `blur(var(--poster-blur))`；设置项标签由「玻璃模糊」改为 **「玻璃与背景模糊」** 并更新说明（拖到 0 背景完全清晰） | 用户要求能用设置控制背景清晰度 | 首页 / 作品详情 / 探索条目详情 / 设置抽屉 | 无（沿用既有 `glassBlur` 状态，未新增字段或持久化） | 否 |
| SHELL-006 | 海报背景是**单层 `cover`**：横版横幅被裁掉一头，竖版封面被放大成不可辨认的一条 | 改为**两层**：环境层（`cover` + 全量模糊）负责填满与色调，前景层 **`.seanime-banner-hero` / `.detail-backdrop-hero` 用 `contain` 按图片自身比例完整铺开**（不裁切、不变形），只做 `--poster-blur × .25` 的轻微柔化。仅在有真实横版横幅（`bannerPath` / `bannerUrl`）时显示前景层；竖版封面降级时保持单层环境色 | 用户要求「比较不错地展示海报，而不是海报的简单一部分」 | 首页横幅 / 作品详情顶部 / 探索条目详情顶部 | 无 | 否 |
| SHELL-006 | 详情页文字只靠上/下渐变遮罩；海报变清晰后左侧标题对比度有风险 | `.detail-backdrop::after` 增加**左侧文字遮罩**（普通 66%→透明 @52%，有横图时 52%→透明 @48%），与原有顶部淡出、底部渐变叠加 | 保证标题 / 封面 / 简介在海报上仍可读（≥4.5:1） | 作品详情 / 探索条目详情 | 无 | 否 |

- 改动文件：`src/v1-1-1.css`（`--poster-blur` 与两层海报规则、详情左侧遮罩、注释同步）、`src/components/SettingsPanel.tsx`（标签与说明）、`src/pages/HomePage.tsx` / `src/pages/WorkDetailPage.tsx` / `src/pages/ExplorePage.tsx`（新增前景层元素 `.seanime-banner-hero` / `.detail-backdrop-hero`）。
- 前景层用**同一个图片变量**（`--banner-image` / `--detail-artwork`），不引入第二张图，也不伪造素材。
- **未改布局**：横幅高度、内容位置、`--poster-fade` 融合逻辑均不变；两层都是绝对定位的装饰层。
- **数据侧边界（不是本次职责）**：若某个作品的 `works.banner_path`（或探索条目的 `bannerUrl`）为 **NULL**，前端只能退回竖版封面作环境色——那属于后端聚合没有匹配到横图，需 Codex 处理，前端不会凭空生成横版图。实测本机 4 部作品中 3 部已有 `banner_path`（1900×400 横幅文件存在），1 部为 NULL。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），横幅完整度、背景清晰度与左侧文字对比度见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：修复「简介 / 标签 → 查看详情」首次加载不出现（2026-09-17）

背景：用户反馈「作品详情页的标签简介的点击查看详情消失了，但是自己评分后又会出现」。只读核对 `src/pages/WorkDetailPage.tsx` 的 `aboutClipped` 测量副作用后确认是**前端测量时机 + 测量方式**的问题，与后端数据无关。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| DETAIL-013 | 简介用 `display: -webkit-box` + `-webkit-line-clamp: 3` 裁剪 —— 该布局下首次测量可能量不出「其实已经溢出」，`aboutClipped` 停在 `false`，「查看详情」不出现 | 改为**普通块 + `max-height: calc(3 * 1.7em)` + `overflow: hidden`**（仍裁到 3 行、按行高整数倍取，不露半行）；普通块的 `scrollHeight > clientHeight` 是可靠的溢出判据 | 让裁切与判据都稳定 | 作品详情 · 简介与标签 | 无（纯 CSS） | 否 |
| DETAIL-013 | 测量副作用依赖 `[work?.description, work?.tags]`，且**只在挂载那一刻测一次**；只有等评分等操作把 `work` 换成新对象（tags 数组引用变化）才重测 —— 所以「评分后才出现」 | 依赖改为 **`[work]`**（作品对象变化即重测）；并在**下一帧、`document.fonts.ready`、120ms 落定、window `load`/`resize`、以及 `.detail-about` 与两个子元素自身的 `ResizeObserver` 回调**上各补测一次；卸载后置 `disposed` 防抖 | 消除「首次布局尚未稳定」的竞态 | 作品详情 · 简介与标签 | 无 | 否 |

- 改动文件：`src/v1-1-1.css`（`.detail-about .detail-description` 的裁切方式）、`src/pages/WorkDetailPage.tsx`（测量副作用重写）。
- 视觉不变：仍是 3 行裁剪 + 「查看详情」入口 + 弹窗内完整展示；弹窗内 `.about-detail .detail-description` 的 `max-height: none; overflow: visible` 覆盖依旧生效。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），首次加载是否出现「查看详情」见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：排行榜改为自适应多列（2026-09-17）

背景：用户反馈「排行榜占位还是太大啦，我希望可以仅占一点」。核对截图确认问题在**列宽**而非行高 —— `.gnz-ranking-list` 是单列网格，`.gnz-ranking-row` 又是 `width: 100%`，而 `.page` 在 v1.1.1 起取消了最大宽度（`.page { max-width: none }` 覆盖了 `styles.css` 里 `.workspace-page { max-width: 1900px }`）。窗口越宽，行越宽：截图（2386px 宽）里每行约 2200px，而行内容（序号 40px + 海报 48px + 间距 + 标题/评分/放送）只占左侧约 450px，右侧整条留空 —— 既拉长了区块高度，又留下一个巨大的空框。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-022 | `.gnz-ranking-list` 单列、行宽 100%，宽窗口下右侧大片留空 | 改为 **`grid-template-columns: repeat(auto-fill, minmax(440px, 1fr))`** 自适应多列：宽窗口横向铺开多列，列表高度随之收缩；窄窗口（≤约 1000px）仍为单列 | 用户要求排行「仅占一点」；单列全宽既空又高 | 探索 · 推荐（动画排行） | 无（纯 CSS） | 否 |

- 改动文件：`src/explore.css`（`.gnz-ranking-list` 一行；`gap` 6px → 8px 以区分列间距）。
- 行内布局未改：序号 / 海报 / 标题 / 评分 / 放送 / 入库·收藏·缓存角标不变；`@media (max-width: 760px)` 的窄屏行内折行规则仍生效。
- 响应式：`auto-fill`（非 `auto-fit`）保证条目少时列宽不被拉大；1024×640 下内容宽约 850px，仍是单列，不受影响。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），列数与行高观感见 `SCREENSHOT_CHECKLIST.md` 待验行。
- 假设：把「占位太大」理解为**单列全宽留下的空框 + 过高的区块**，因此用多列同时收窄行宽、压低高度。若用户想要的是「一条窄的单列列表、右侧留白」，那只需把该行换成 `max-width` 限制，一行即可改回。

## 正式前端：移除海报背景的重复叠层（2026-09-17）

背景：用户反馈「首页海报出现了叠层错误，详情页的海报右侧也有叠层」，并附两张截图（首页 2462×618、详情页右侧 58×552 竖切）。核对截图与源码确认：**同一张海报被画了两遍、且缩放不同**，两层交界处就是用户看到的接缝。

- 首页横幅：`.seanime-banner-image`（环境层，`cover` + 全量模糊）**与** `.seanime-banner-hero`（前景层，`contain` + 1/4 模糊）同时存在。横幅实测多为 1900×400（约 4.75:1），在 2462×531 的框里 `contain` 按高度铺开后上下各留约 17px，与下面 `cover` 的放大副本相接 —— 就是首页那条**横向接缝**。
- 详情页背景：`.detail-backdrop::before`（`cover`）与 `.detail-backdrop-hero`（`contain`）同理；在 2462×460 的框里 `contain` 按高度铺开、左右各留约 138px，于是**页面右侧出现一道竖直接缝**（用户截图那条窄竖切），左侧留白处也各有一道。
- 两层用的是**同一张图**（`--banner-image` / `--detail-artwork`），所以不是「两种素材」而是同一素材的两种缩放，观感上就是「叠层 / 重影」。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| SHELL-007 | 海报背景 = 环境层（`cover`，全量模糊）+ 前景层（`contain`，1/4 模糊），两层的缩放不同，交界处出现横向（首页）/ 竖向（详情页右侧）接缝 | 改为**单层**：删除 `.seanime-banner-hero` / `.detail-backdrop-hero` 两个元素与全部相关 CSS；保留的一层用 `background-size: cover; background-repeat: no-repeat`，模糊量仍为 `--poster-blur`（设置里的「玻璃与背景模糊」，0 = 完全清晰） | 用户要求消除叠层；同一素材两种缩放必然露出接缝 | 首页横幅 / 作品详情顶部 / 探索条目详情顶部 | 无（纯 CSS + 删除装饰元素，无数据变化） | 否 |
| SHELL-007 | 有真实横版横幅时，环境层用 `inset: -6% / -3%`（局部放大），模糊调 0 时画面会比容器多裁一圈 | 有横幅时该层改为 **`inset: calc(-1 * var(--poster-blur) - 4px)`**（出血量 = 模糊半径 + 4px），`opacity .8 → .92`、`brightness .86 → .92`，让「模糊 = 0」时看到的是接近完整的清晰横幅、且模糊边缘不会露出底色 | 让设置的「清晰度」滑块真正可用、画面不因固定放大而多裁 | 首页横幅 / 作品详情顶部 / 探索条目详情顶部 | 无 | 否 |

- 改动文件：`src/v1-1-1.css`（首页横幅与详情背景的单层化、`cover/no-repeat`、注释同步）、`src/pages/HomePage.tsx` / `src/pages/WorkDetailPage.tsx` / `src/pages/ExplorePage.tsx`（各删除一个 `*-hero` 装饰元素）。
- **未改布局**：横幅高度（552 / 531 / 460px）、内容位置、`--poster-fade` 融合渐变、文字遮罩（`::after` 三层渐变）全部不变；被删的是绝对定位的装饰层。
- 关于裁剪量：横幅为 1900×400（4.75:1）时，单层 `cover` 在用户窗口（2462×531，约 4.64:1）只裁约 2% 宽度，观感上接近完整横幅；只有竖版封面（2:3）被 `cover` 铺进宽横幅才仍会明显裁剪 —— 该场景保持**重模糊单层**处理（不是叠层），不会出现接缝。
- 设计原型（`design/open-design/v1.1.2/prototype/index.html`）本来就是单层海报（`.hero-art` / `.detail-backdrop` 各一层），不存在此问题，因此**未改原型**，两边现在一致。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉验收：未渲染 / 未截图（写入即交付），接缝是否消失、模糊滑块是否生效见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：媒体库以作品为主，媒体源与扫描记录移入独立界面（2026-09-18）

背景：用户反馈「可以把下方的移到上方；媒体源和扫描记录放到媒体库新开的界面里面」。只读核对 `src/pages/LibraryPage.tsx`：`activeSection === "library"` 时先渲染 `<ScanPage embedded />`（媒体源列表 + 扫描记录表），再渲染工具栏与作品网格 —— 作品被压到页面最底部，首屏**看不到任何作品**；而「媒体源 / 扫描记录」与「媒体库」这一语义本身也重复。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| LIBRARY-002 | 媒体库标签页顺序为 媒体源 → 扫描记录 → 工具栏 → 范围筛选 → 作品网格/列表 | 改为**作品优先**：标签页 → 工具栏 → 范围筛选 → 作品网格/列表（`<ScanPage embedded />` 从标签页移除） | 用户要求「把下方的移到上方」；作品是媒体库的主要内容，应在首屏可见 | 媒体库 | 无 | 否 |
| LIBRARY-003 | 媒体源与扫描记录内嵌在媒体库标签页顶部，与「媒体库」语义重叠 | 移入**独立界面** `/library/sources`：页头「媒体源与扫描」+「返回媒体库」链接 + 媒体源分区（含类型筛选、来源列表、扫描/校验）+ 扫描记录表；入口为媒体库页头新增的 **「媒体源与扫描」** 按钮（次要按钮，位于「新建作品」左侧） | 用户要求「媒体源和扫描记录放到媒体库新开的界面里面」 | 媒体库 · 媒体源与扫描 | 无（复用 `listRoots` / `listScanJobs` / `addRoot` / `updateRoot` / `deleteRoot` / `scanRoot`，无新增接口） | 否 |
| LIBRARY-003 | `ScanPage` 带 `embedded` 参数：`false` 时渲染自己的页头「扫描目录 / 添加目录」；`/scan` 路由为独立页面 | `ScanPage` **只保留内嵌形态**（移除 `embedded` 参数与其独立页头分支），页面外壳由 `/library/sources` 提供；`/scan` 路由移除，`HomePage` 两处 `/scan` 链接改为 `/library/sources` | 避免出现「媒体源」的第二个入口（用户此前已要求消除扫描页与媒体库的重合） | 媒体库 · 媒体源与扫描 / 首页 | 无 | 否 |
| LIBRARY-003 | 弹窗文案「添加扫描目录」/「删除扫描目录配置？」 | 统一为 **「添加媒体源」/「删除媒体源配置？」**（描述文案不变，仍明确「只删除 Genzo 中的记录，磁盘文件不会被删除/移动/修改」） | 与新的「媒体源」命名保持一致，避免同一个对象两套叫法 | 媒体库 · 媒体源与扫描 | 无 | 否 |

- 改动文件：`src/pages/LibraryPage.tsx`（移除 `ScanPage` 引用与 `<ScanPage embedded />`；页头新增「媒体源与扫描」按钮 `navigate("/library/sources")`）、`src/pages/LibrarySourcesPage.tsx`（新增：返回链接 + `PageHeader` + `<ScanPage />`）、`src/pages/ScanPage.tsx`（移除 `embedded` 参数与独立页头分支，固定渲染 `scan-page scan-embedded`；弹窗文案改为媒体源）、`src/pages/HomePage.tsx`（两处 `/scan` → `/library/sources`）、`src/App.tsx`（新增 `library/sources` 路由，移除 `scan` 路由）、`src/v1-1-1.css`（新增 `.sources-back`、`.page-library-sources` 间距；`.gnz-library-tabs` `margin-bottom` 28px → 4px，因工具栏现在紧接标签页）。
- 状态覆盖：媒体源分区原有的加载 / 错误 / 空（「尚未添加扫描目录」）/ 扫描中 / 扫描结果与错误列表；新页面在 1024×640 下靠 `.page` 常规留白与 `.page-actions` 换行规则自适应，无新增固定高度。
- 未新增任何后端接口或字段；`WebDAV` / `网盘` 仍为 `Future` 禁用 + tooltip 不变。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功（1630 modules）。
- 视觉验收：未渲染 / 未截图（写入即交付），首屏作品可见性与新页面观感见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：媒体源改为媒体库的中间标签页（2026-09-18）

背景：上一版把媒体源与扫描放进独立页面 `/library/sources`（由页头「媒体源与扫描」按钮进入）。用户反馈「这个媒体源我觉得放到 媒体库和待整理中间比较好」，并以截图指出媒体库标签行的位置 —— 即媒体源应与媒体库、待整理**同级**，成为三者中间的标签页，而不是另一个页面。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| LIBRARY-004 | 媒体源为**独立页面** `/library/sources`，入口是媒体库页头的「媒体源与扫描」按钮 | 改为媒体库的**第三个标签页**，顺序为 **媒体库 / 媒体源 / 待整理**；`activeSection` 增加 `"sources"`，并支持 `?tab=sources` 深链（`HomePage` 两处「添加媒体源」改指 `/library?tab=sources`） | 用户要求媒体源放在媒体库与待整理之间；同级标签比跨页跳转更连贯 | 媒体库 · 媒体源 | 无（复用同一 `ScanPage`） | 否 |
| LIBRARY-004 | `LibrarySourcesPage.tsx`（返回链接 + `PageHeader` + `<ScanPage />`）与其路由 | **删除**该页面与 `library/sources` 路由，并删除只为它存在的 `.sources-back` / `.page-library-sources` 样式 | 标签页已承载同一内容，保留独立页会出现第二个媒体源入口（与此前「消除扫描页重合」的决定一致） | 媒体库 · 媒体源 / 首页 | 无 | 否 |
| LIBRARY-004 | 媒体库标签页的工具栏（搜索 / 类型 / 标签 / 排序 / 收藏 / 视图）与范围筛选、待整理说明行在**所有标签**下渲染 | **仅在有作品或待整理内容时渲染**：`媒体源` 标签下隐藏工具栏与范围筛选/说明行（媒体源分区自带「扫描全部 / 添加来源」操作） | 搜索与作品筛选对媒体源不适用，避免出现「控件在、点了没用」的误导 | 媒体库 · 媒体源 | 无 | 否 |

- 改动文件：`src/pages/LibraryPage.tsx`（`activeSection` 增加 `"sources"` + 中间标签按钮 + `?tab=sources` 解析 + `<ScanPage />` 分支 + 工具栏条件渲染）、`src/pages/HomePage.tsx`（两处 `/library/sources` → `/library?tab=sources`）、`src/App.tsx`（移除 `library/sources` 路由与导入）、`src/v1-1-1.css`（删除 `.sources-back` 与 `.page-library-sources`）、删除 `src/pages/LibrarySourcesPage.tsx`。
- 保留：媒体源分区的内容与状态（类型筛选 `全部 / 本地 / WebDAV(Future) / 网盘(Future)`、来源行、扫描/删除、上次扫描统计与错误、**扫描记录**表）不变；`ScanPage` 仍是唯一实现。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功（1629 modules）。
- 过程说明：本条修正落盘时，曾用 PowerShell 文本命令替换 `HomePage.tsx` 的链接，导致该文件编码被破坏（GBK 误读 + BOM）；已 `git restore` 该文件并用编辑器重做替换，最终 `git diff` 仅含两处链接变更。
- 视觉验收：未渲染 / 未截图（写入即交付），标签顺序与媒体源标签下的观感见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：修复图标按钮 tooltip 被列表容器裁掉（2026-09-18）

背景：用户反馈「工具页面的按钮详情字体会被挡着」，并附上「测试启动」提示文字的截图（文字上缘被切）。只读核对后确认是**纯 CSS 裁切**问题，与数据无关。

- `styles.css:166` 给 `.tool-list` / `.root-list` / `.file-table` 等列表容器设了 `overflow: hidden`（本意是把行的背景与分隔线裁进 7px 圆角）。图标按钮的 tooltip 是 `[data-tooltip]::after`（`bottom: calc(100% + 7px)`、`z-index: 100`、`white-space: nowrap`），**开在按钮正上方**。
- 于是第一行按钮的 tooltip 上缘超出容器顶边约 12px → **被裁掉**（用户截图里「测试启动」上缘被切）；最右侧「删除工具」的 tooltip 超出容器右缘 → 同样被裁。
- 这些列表的行都是**透明背景**（`.root-row, .tool-row { background: transparent }`，无 hover 底色），并不需要靠 `overflow: hidden` 裁任何东西 —— 圆角只作用于容器的 1px 描边，而最后一行已 `border-bottom: 0`。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| TOOLS-001 | 工具行内的「测试启动 / 编辑工具 / 删除工具」图标按钮 tooltip 被 `.tool-list` 的 `overflow: hidden` 裁切（首行上缘、最右列右缘） | 新增作用域规则 **`.tools-page .tool-list { overflow: visible }`**，tooltip 可正常越出容器 | 用户反馈提示文字被挡 | 工具管理 | 无（纯 CSS） | 否 |
| TOOLS-001 | 同一根因也影响「媒体源」来源行的「删除目录配置」与作品详情分集卡片内的图标按钮 tooltip | 同一条规则同时覆盖 **`.scan-embedded .root-list`** 与 **`.detail-page .file-table`**（同为透明行、同一 `overflow: hidden`、同一 tooltip 机制） | 三处是同一个缺陷，一并修掉，避免下次再报同一问题 | 媒体库 · 媒体源 / 作品详情 · 章节与文件 | 无 | 否 |

- 改动文件：`src/v1-1-1.css`（新增 3 个选择器的 `overflow: visible` 与说明注释，+8 行）。
- 未改 `.work-list` / `.unassigned-table` / `.history-table`：这些容器内没有图标按钮 tooltip，且行的 hover 底色仍需要圆角裁切。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功（1629 modules）。
- 视觉验收：未渲染 / 未截图（写入即交付），tooltip 是否完整可读见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：待整理只显示来自媒体源的作品组（2026-09-18）

背景：用户反馈「待整理界面实在是太乱了，先把之前的加入的历史记录都清除，然后仅会显示在媒体源中加入的目录」。只读查询真实库确认「乱」的来源是**不属于任何媒体源的历史记录**。

**只读证据（`%APPDATA%\com.genzo.desktop\genzo.db`，read-only）**

| 项 | 值 |
|---|---|
| `library_roots`（当前媒体源） | 1 条：`G:\影音\动漫` |
| `media_files` 中 `work_id IS NULL` | **25,611** 行 |
| ├ `library_root_id IS NULL`（旧目录遗留，路径形如 `G:\影音\…`） | **25,574** 行 |
| ├ `library_root_id` 指向已删除的 root | **10** 行 |
| └ 属于当前媒体源 | **27** 行（3 个顶层目录：亲吻姐姐 24 / 古见 1 / 辉夜大小姐 2） |

即：待整理里 **99.9% 的内容来自已移除的目录**，只有 27 个文件属于现在添加的媒体源。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| LIBRARY-005 | 待整理列表直接使用 `listUnassignedGroups()` 的全量结果（后端 SQL 为 `WHERE work_id IS NULL`，不按媒体源过滤），历史记录全部铺开：253 个作品组 / 25,611 个文件 | 只显示**来自「媒体源」中已添加目录**的作品组（`group.representative.libraryRootId` 必须存在于 `listRoots()` 的 id 集合）；列表说明条追加「已隐藏 N 个不属于任何媒体源的历史作品组（M 个文件）…把该目录重新添加为媒体源后即可再次显示」 | 用户要求「仅会显示在媒体源中加入的目录」 | 媒体库 · 待整理 | 新增读取 `listRoots()`（已有接口，无契约变更）；**不删任何数据** | 否 |
| LIBRARY-005 | 标签页角标与「批量识别动漫」的可用性判断基于全量 `unassignedGroups` | 同样改为基于过滤后的集合，避免出现「角标 253 但列表只有 3 条」和「对不可见的历史组批量识别」 | 计数与操作必须与可见列表一致 | 媒体库 · 待整理 | 无 | 否 |

- 改动文件：`src/pages/LibraryPage.tsx`（`roots` 状态 + `load()` 并行读取 `listRoots()`、新增 `scopedUnassigned` / `hiddenGroups` / `hiddenFiles` 派生、`filteredUnassigned` 与标签角标、批量识别判断改用该集合、说明条文案）、`src/v1-1-1.css`（新增 `.gnz-inbox-hidden`）。
- **前端不删除任何记录**：把 `G:\影音` 重新添加为媒体源后，历史组会恢复显示 —— 这是刻意的可恢复语义。
- **真正“清除”这些记录属于后端**：已写成交接单 `CODEX_TASK_purge-orphan-media-records.md`（建议 `purge_orphan_media_records()`：只删无 root / 指向已删 root 且无 work、episode、subtitle 关联的行，绝不触碰磁盘文件）。前端「清理历史记录」按钮等该命令落地后再加。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功（1629 modules）。
- 视觉验收：未渲染 / 未截图（写入即交付），过滤后的列表与说明条观感见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：季节 / 年份筛选与本季番组标题同行并靠右（2026-09-18）

背景：用户反馈「将季节年份的选择对其本季番组 然后放到右侧」。改前「本季」标签页的季节 / 年份 / 重置独占一行，位于「本季番组」标题**下方**，标题与控件分成两行。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-023 | 「本季」的季节 / 年份 / 重置位于「本季番组」标题行**下方**，独占一行、靠右 | 移入标题行右侧（与「本季番组」同一行、靠右）；标题行 `flex-wrap: wrap`，窄窗口时筛选组整体换到下一行并以 `margin-left: auto` 仍贴右 | 用户要求与「本季番组」对齐并放到右侧 | 探索 · 本季 | 无（纯前端布局） | 否 |
| EXPLORE-023 | v1.1.2 原型里 `#seasonFilter` 位于 `.discover-head` 之下，独占一行 | 移入 `.discover-head` 内新增的 `.discover-head-right` 组（计数 + 季节 / 年份）；筛选隐藏时计数仍在最右，与改动前一致 | 设计稿与正式前端保持同一构图 | 探索（原型） | 无 | 否 |

- 改动文件（正式前端）：`src/pages/ExplorePage.tsx`（`gnz-season-filter` 从 `<section>` 的独立一行移入 `.section-heading` 的右侧槽位，与「清除搜索」按钮互斥，仍只在 `tab === "seasonal" && searchTerm === null` 时渲染）、`src/explore.css`（`.gnz-season-filter` 去掉 `margin: 0 0 18px`；新增 `.gnz-explore-trending .section-heading { flex-wrap: wrap; gap: 10px 18px }` 与 `.gnz-explore-trending .gnz-season-filter { margin-left: auto }`）。
- 改动文件（设计稿）：`design/open-design/v1.1.2/prototype/index.html`（`#seasonFilter` 移入新增的 `.discover-head-right`；新增 `.discover-head { flex-wrap: wrap }`、`.discover-head-right { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:flex-end; gap:12px 16px; margin-left:auto }`；`.season-filter` 的 `margin: 0 0 16px` 改为 `0`），并同步 `design-export/index.html` 与 Open Design 项目内 `v1.1.2/` 两份副本。
- 语义未变：季节 / 年份仍只作用于「本季」（`全部季节` / `全部年份` 时按当前日期所在季节取值）；`aria-label="本季的季节与年份筛选"` 保留；「推荐」页不显示该控件。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功（1629 modules）。
- 视觉验收：未渲染 / 未截图（写入即交付），标题行对齐与窄窗口换行见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：待整理改为按媒体源文件夹层级浏览（2026-09-18）

背景：用户反馈「后续会有很多文件会特别杂，希望变成一个大文件夹（媒体源中添加的文件夹），可以点击查看分文件夹，直到看到文件」。改前「待整理」是一张平铺的作品组表格，进入后直接列出所有作品组，没有文件夹层级。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| INBOX-005 | 「待整理」= 平铺的作品组表格（`目录或文件 / 类型 / 内容 / 识别状态 / 操作`），漫画另有一套 `comicContainers` 大类下钻 | 改为**按媒体源文件夹层级浏览**：根层级列出媒体源文件夹 → 点进子文件夹 → 逐级下钻 → 到达文件夹内的**文件行**；新增面包屑（`媒体源 › G:\影音 › 动漫 › …`），点击任一级返回 | 用户要求文件夹层级浏览，避免大库下平铺列表过杂 | 媒体库 · 待整理 | 新增读取 `listUnassignedMedia()`（已有命令）；**未改后端** | 否 |
| INBOX-005 | 作品组操作（识别 / 查看候选 / 手动整理）只出现在表格行上 | 文件夹本身对应一个作品组时，该级顶部显示作品组条（标题 + 类型 + 文件数 + 状态）并保留同样的操作；文件行提供**打开 / 所在目录**（缺失文件禁用） | 保持既有整理流程不丢失 | 媒体库 · 待整理 | 无 | 否 |
| INBOX-006 | 待整理只显示作品组聚合，看不到单个文件 | 文件行显示：文件名、`类型 · 大小`、识别状态（未匹配 / 文件缺失）；路径与文件名超出以 `ellipsis` 截断 + `title` 保留全文 | 「直到看到文件」 | 媒体库 · 待整理 | 无 | 否 |

- 改动文件：`src/pages/LibraryPage.tsx`（新增 `inboxPath` / `inboxMedia` 状态、路径工具函数、`inboxBreadcrumb` / `inboxLevel` / `inboxGroupHere` 派生、`openInboxFile` / `revealInboxFile`，渲染改为面包屑 + 文件夹 / 文件行）、`src/v1-1-1.css`（新增 `.inbox-crumbs` / `.inbox-group-row` / `.inbox-tree` / `.inbox-folder` / `.inbox-file` / `.inbox-actions` / `.inbox-empty` 与 ≤1100px 折行规则）。
- 数据：文件级数据只在进入「待整理」时取一次（`listUnassignedMedia()`），并继续按 `libraryRootId ∈ 已添加媒体源` 过滤——历史孤儿文件不会出现在树里。
- 性能缺口（已登记 **INBOX-007 / NEW_REQUIRED**）：`list_unassigned_media` 目前无过滤、无分页（后端 `WHERE work_id IS NULL`），大库下会传输全部未整理记录；需要后端提供按媒体源 / 路径过滤与分页的查询。
- 排序下拉（按识别状态 / 标题 / 文件数量）保留，作用于当前层级。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功（1629 modules）。
- 视觉验收：未渲染 / 未截图（写入即交付），文件夹 / 文件行与面包屑见 `SCREENSHOT_CHECKLIST.md` 待验行。

## 正式前端：探索封面懒加载 / 缓存复查，详情页分集结构不再阻塞首屏（2026-09-18）

背景：后端已把探索全年列表改成本地 bangumi-data，并后台预取封面与元数据；作品详情普通读取也已改为优先本地缓存。前端需要在「封面还没缓存好」和「详情扩展元数据较慢」时仍然先出内容，且不能整页 Loading、不能无限轮询。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-024 | `ExploreCover` 用 `<img loading="lazy">`，封面地址一到就交给浏览器请求 | 改为 `IntersectionObserver` 驱动：只有卡片进入（或距视口 320px 内）才把 `coverUrl` 赋给 `src`；离开 / 卸载即 `disconnect()`。**卡片尺寸与网格布局不变** | 不为整页 / 全年作品一次性创建大量图片请求 | 探索 | 无 | 否 |
| EXPLORE-025 | 后端后台缓存完封面后，列表不会自己更新，必须手动刷新才看到封面 | 列表存在**缺失封面或远程封面**时，**短间隔 2.5s、最多 3 次**静默重读当前探索数据（stale-while-revalidate）：不设置 `loading`，不整页闪烁、不回到顶部，分类 Tab / 年份 / 季节 / 标签 / 搜索与滚动位置全部保持；切换筛选时重置复查预算；卸载时清除定时器 | 后台缓存完成后封面应自动出现，但不能无限轮询 | 探索 | 依赖后端在缓存完成后让 `coverUrl` 从 `null` 变为本地地址（已有行为） | 否 |
| EXPLORE-025 | 封面加载失败只回退占位图 | 失败时回退占位图，并**顺带安排一次有限次数的缓存复查**（远程地址失败 → 本地缓存可能已完成） | 远程封面失败后能自愈 | 探索 | 无 | 否 |
| DETAIL-014 | `load()` 把 `getAnimeWorkStructure()` 与 `getWork()` 一起 `await`，结构未返回前整页显示「正在读取作品详情」 | 拆成两段：`getWork()` + `listTools()` 一返回就结束首屏 `loading`；结构用独立的 `structureLoading` 加载，区块内显示「正在读取分集结构与制作人员…（本地内容已可查看）」 | 详情页不应因角色 / 制作人员 / 关联作品 / 扩展元数据而长时间停留在整页 Loading | 作品详情 | 无 | 否 |
| DETAIL-014 | 没有缓存时该区块只回落到本地文件列表，没有说明 | 结构为空且无错误时显示「尚未缓存官方分集与制作人员。点击右上角「刷新元数据」联网更新后即可看到。」 | 明确「未缓存」而不是看起来像没有数据 | 作品详情 | 无 | 否 |

- 改动文件：`src/pages/ExplorePage.tsx`（`ExploreCover` 改 IntersectionObserver 懒加载 + `onNeedsCover`；新增 `COVER_REFRESH_MAX` / `COVER_REFRESH_DELAY`、`needsCoverCache` / `scheduleCoverRefresh`、复查预算与定时器清理）、`src/pages/WorkDetailPage.tsx`（`load()` 拆分、新增 `structureLoading`、结构区块的加载 / 未缓存提示）。
- 保持不变：卡片尺寸、网格列数、间距、配色、字体与信息架构**未改动**；「刷新元数据」仍调用 `refreshWorkMetadata()`，成功后重新 `getWork()` + `getAnimeWorkStructure()`，失败保留原内容只做局部提示。
- 缩略图：仍沿用 `getMediaThumbnail()` + `IntersectionObserver` 只请求可见项；`null` 时用中性文件占位，**不用作品海报冒充视频帧**（未改动）。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` 16/16 通过；`pnpm build`（`tsc -b && vite build`）成功（1629 modules）。
- 视觉 / 运行期验收：**未渲染、未截图**（写入即交付），首次出内容、滚动加载、缓存完成后自动补封面、离开页面不再更新等行为见 `SCREENSHOT_CHECKLIST.md` 的 B 级待验行，需开发侧在本机跑。

## 正式前端：探索标签区改为 3 行裁切 + 编辑序排序（2026-09-18）

背景：真实库的 `ExploreOverview.availableTags` 有上百个标签，筛选面板一次性铺开成十几行，过于繁杂；且后端按**字母序**去重（`src-tauri/src/explore.rs` 的 `available_tags.sort()`），热门类型埋在中间。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| EXPLORE-024 | 「动漫标签」把全部标签一次铺开（上百个 → 十几行），面板被撑得很长 | 默认只显示 **3 行**，超出时右侧出现 **「展开全部（N 个）／收起」**（带 `aria-expanded`）；裁切高度按**第 3 行的实际底边**测量后写进 inline `max-height`，不写死行高 —— 长标签换行、系统字体缩放、窗口缩放都能自适应；不足 3 行时不显示入口 | 标签过多导致面板繁杂 | 探索 · 筛选面板 | 无（纯前端） | 否 |
| EXPLORE-025 | 标签顺序＝后端返回顺序（`available_tags.sort()` 字母序），热门与冷门混在一起 | 显示顺序改为**编辑序（热门 → 冷门）**：`TAG_PRIORITY` 收录常见 ACGN 类型（恋爱 / 喜剧 / 动作 / 热血 / 奇幻 / 冒险 / 科幻 / 悬疑 / 日常 / 治愈 …），并同时收录中文 / 日文 / 英文写法；未收录的标签**保持后端原序**（稳定排序） | 用户要求「从热门到冷门」并给出示例顺序 | 探索 · 筛选面板 | 这是**编辑排序，不是后端统计值**；真正的按热度需要后端提供计数（登记 `EXPLORE-026`） | 否 |

- 改动文件：`src/pages/ExplorePage.tsx`（`TAG_PRIORITY` / `orderTags`；`tagsRef` + `tagsOverflow` / `tagsClampHeight` / `tagsExpanded`；`measureTags` + `ResizeObserver` / `resize` 监听；筛选面板标记改为「标签行 + 裁切容器 + 展开入口」）、`src/explore.css`（`.gnz-filter-field-head`、`.gnz-filter-more`、`.gnz-filter-chips.is-clamped`）。
- 三个列表（推荐 / 本季 / 搜索结果）的标签区同时生效；切换分类或搜索时**自动回到收起态**，不把上一个列表的展开状态带过去。
- 组件卸载时 `disconnect()` 观察器并移除 `resize` 监听。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` **18/18** 通过；`pnpm build`（`tsc -b && vite build`）成功。
- 视觉 / 运行期验收：**未渲染、未截图**（写入即交付）。3 行裁切高度、展开 / 收起与缩放后的重算见 `SCREENSHOT_CHECKLIST.md` 的 B 级待验行。

## 正式前端：分集卡片只展示「最正确」的一个本地版本（2026-09-22）

背景：一集可能关联多个本地版本（1080p / 4K / 不同字幕组 / 不同编码，含 NCED / NCOP 等），旧实现把 `episode.localFiles` **全部平铺**到卡片外层的文件信息区，卡片被撑得很高、重复且嘈杂。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| DETAIL-015 | 分集卡片外层把该集**全部** `localFiles` 逐条列出（文件名 + 媒体信息 + 大小 + 状态 + 打开按钮），一集 3 个版本就 3 行 | 卡片外层只显示**一个**「最正确」的版本；`pickPrimaryFile()` 的择优顺序：**未缺失 → 分辨率更高 → 已解析媒体信息 → 文件更大**。多于一个版本时在文件信息区末尾补一行小字「另有 N 个版本，点右上角「⋯」切换」 | 卡片应聚焦最正确版本，避免多版本平铺 | 作品详情 · 章节与文件 · 分集卡片 | 无（纯前端） | 否 |
| DETAIL-016 | 「⋯」集数详情面板标题为「文件操作」，仅按文件列出操作按钮，无法指定卡片展示哪个版本 | 面板改为「本地版本（N）」：每个版本一行，**点行内选择区即把该版本设为卡片版本**（`aria-pressed`，当前版本标「卡片展示中」，其余标「设为卡片版本」），下方仍保留该版本原有的全部操作（使用工具 / 系统默认程序 / 打开所在目录 / 识别到其他作品 / 解除分集关联 / 解除作品关联） | 多版本改由「⋯」面板切换 | 作品详情 · 集数详情面板 | 无（纯前端） | 否 |
| DETAIL-017 | 卡片与快照的版本选择之间没有联动 | 卡片外层文件信息与快照缩略图都优先取当前选中的版本；选中的版本若已有 `thumbnailPath` 则用作快照，否则沿用既有的「有缩略图 → 未缺失 → 第一个」回退链。切集 / 换作品时选择自然失效并回到默认择优版本 | 选中版本应与卡片展示一致 | 作品详情 · 分集卡片 · 快照 | 无（纯前端） | 否 |

- 改动文件：`src/pages/WorkDetailPage.tsx`（新增 `mediaResolutionScore()` / `pickPrimaryFile()`、`versionChoice` 状态；分集卡片文件信息区只渲染 `primaryFile`；「集数详情」面板改为可选择的「本地版本」列表）、`src/v1-1-1.css`（`.episode-version-more`；`.episode-detail-file` / `.is-active`、`.episode-version-select` / `-name` / `-tag` / `-state`；移除旧的 `.episode-detail-file strong` 规则）。
- **语义不变**：同一分集的多个本地版本**绝不去重、不合并、不删除**；只是默认只展示最优的一个，其余版本在面板里完整保留、可独立操作。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 设计原型 `design/open-design/v1.1.2/prototype/index.html` 未同步：其示例分集结构与正式前端的 Provider `localFiles` 结构不同，本改动为正式前端专属。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` **20/20** 通过；`pnpm build`（`tsc -b && vite build`）成功（1634 modules）。
- 视觉 / 运行期验收：**未渲染、未截图**（写入即交付）。卡片只显示一个版本、多版本在「⋯」面板切换、选中后卡片与快照同步，见 `SCREENSHOT_CHECKLIST.md` 的 B 级待验行。

## 正式前端：顶部栏 / 侧栏完全透明，新增「顶部栏透明度」设置（2026-09-22）

背景：用户给出「动漫共和国」首页截图作参考——首页海报整幅铺满窗口，顶部栏与左侧导航完全透明、直接融入海报背景。改前正式前端只有标题栏在**首页**会显示海报顶部的横向裁剪条（`styles.css` 的 `.has-window-backdrop .is-home-route .window-titlebar` 用 `linear-gradient` + `--genzo-backdrop`，与下方横幅缩放不同，交界处出现接缝），而**侧栏**是不透明的 `color-mix(bg 86%)`；此外首页海报只位于 `.main-content`（标题栏下方、侧栏右侧），无法落到顶部栏与侧栏之后。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| SHELL-008 | 首页标题栏显示海报顶部的横向裁剪条（与横幅不同缩放，出现接缝）；侧栏为 86% 不透明底色 | 标题栏与侧栏**默认完全透明**，填充只由新 token `--topbar-opacity`（默认 `0`）控制；两者同源，无模糊、无分隔线（透明度为 0 时侧栏右边框也隐去） | 参照「动漫共和国」：顶部栏与侧栏融入海报背景 | 全局框架 · 标题栏 · 左侧导航 | 无（纯前端） | 否 |
| SHELL-009 | 首页海报只铺在标题栏下方、侧栏右侧 | 首页主内容**铺满整个窗口**（`grid-column: 1 / -1; grid-row: 1 / -1`），横幅海报自然延伸到顶部栏与侧栏之后；顶部工具条与主标题让开标题栏 / 侧栏；书架与「切换到其他作品」保持不透明底色，滚动时盖住海报 | 海报需落在顶部栏 / 侧栏之后，透明才有意义 | 首页 | 无 | 否 |
| SHELL-010 | 设置里没有顶部栏 / 侧栏透明度控件 | 设置「主题」面板新增 **「顶部栏透明度」** 滑块（`0–100%`，默认 `0`）：0 完全透明融入背景，调高更易读；数值写入 `--topbar-opacity`，同时作用于标题栏与侧栏 | 用户要求可在设置里调节 | 设置 · 主题 | 无 | 否 |

- 改动文件：`src/store.ts`（新增 `topbarOpacity` 偏好，默认 `0`；`setTopbarOpacity`；`resetAppearance` 一并复位）、`src/components/AppShell.tsx`（读取偏好并写入 `--topbar-opacity = clamp(0, 1, 值 / 100)`）、`src/components/SettingsPanel.tsx`（新增滑块 `#topbarRange` 与说明）、`src/v1-1-1.css`（`:root` 新增 `--topbar-opacity: 0`；`.window-titlebar` / `.sidebar` 背景改用 `rgba(var(--shade), var(--topbar-opacity))`，侧栏边框与背景模糊同步联动；首页沉浸式规则）。
- **非首页不变**：其它路由下顶层框架背后就是 `--bg`，`rgba(shade, 0)` 与改前的 `var(--bg)` 视觉一致；只有首页因海报铺满而体现透明。
- 透明度为 `0` 时，标题栏 / 侧栏**无模糊、无描边**（`backdrop-filter: blur(calc(var(--ui-blur) * var(--topbar-opacity)))`、`border-right-color: rgba(var(--tint), calc(var(--topbar-opacity) * .14))`），完全融入海报；调高后模糊与描边同步回来。
- 可访问性：标题栏 / 侧栏文字色仍用 `var(--text)` / `var(--muted)`；海报左侧本就带 `::after` 的横向暗角遮罩，导航文字对比度不依赖顶层框架底色；海报过亮时可在设置里调高透明度。
- 与原型的关系：`design/open-design/v1.1.2/prototype/index.html` 的标题栏已是透明，但侧栏为 `rgba(var(--shade), .72)`（半透明）——本轮按用户新参考改为**默认 0（完全透明）**并新增可调 token，原型**未同步**（原型是静态演示，不承载偏好设置）。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` **20/20** 通过；`pnpm build`（`tsc -b && vite build`）成功（1634 modules）。
- 视觉 / 运行期验收：**未渲染、未截图**（写入即交付）。首页海报是否落到顶部栏 / 侧栏之后、拖动「顶部栏透明度」是否即时生效、深色 / 浅色下的文字对比度，见 `SCREENSHOT_CHECKLIST.md` 的 B / C 级待验行。

## 正式前端：海报底部渐变融合，移除侧栏顶部品牌标志（2026-09-22）

背景：用户反馈两点——① 首页海报底部与下方内容之间是一条硬边（`.gnz-home .seanime-banner` 的 `border-bottom: 1px solid var(--line)`，且 `::after` 只有顶端淡出与底部压暗、没有向页面底色过渡）；② 侧栏顶部那块「G」品牌标志已不再需要，希望移除并把导航整体上提。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| SHELL-011 | 首页海报底部为硬边：横幅带 `border-bottom: 1px solid var(--line)`；`::after` 只有顶部淡出（`--poster-fade`）与底部压暗，没有向页面底色的过渡 | 新增 token `--poster-fade-bottom: 108px`；海报 `::after` 增加一层 `linear-gradient(0deg, var(--bg) 0, transparent var(--poster-fade-bottom))`，底端淡出到页面底色；移除 `border-bottom` 硬线（深色 / 浅色与首页沉浸式两组规则均已覆盖） | 海报与下方内容之间不应出现硬边 | 首页 · 横幅海报 | 无 | 否 |
| SHELL-012 | 侧栏顶部为品牌标志（`.brand`：`G` 方块 + `Genzo` / `MEDIA LIBRARY` 文本），占 49px 高 + 24px 下边距 | 移除 `.brand` 结构（`AppShell.tsx`），导航自侧栏顶部起排；清理 `.brand` / `.brand-mark` 的失效样式（`v1-1-1.css`、`styles.css`） | 用户要求移除侧栏顶部标志并把其余内容上提 | 全局框架 · 左侧导航 | 无 | 否 |

- 改动文件：`src/components/AppShell.tsx`（删除 `.brand` 标记）、`src/v1-1-1.css`（新增 `--poster-fade-bottom`；`::after` 增加底部淡出层共 4 处规则；移除 `.seanime-banner` 的 `border-bottom`；移除 `.brand` 覆盖样式）、`src/styles.css`（移除已无引用的 `.brand` / `.brand-mark` 基础样式）。
- 顶部 `--poster-fade`（120px）行为不变；底部 `--poster-fade-bottom`（108px）刻意略小于顶部，避免淡化标题与操作按钮所在区域。
- 标题与按钮位于 `.seanime-banner-title`（`bottom: 60px`，`z-index: 4`），仍在 `::after`（`z-index: 2`）之上，可读性不受影响。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` **20/20** 通过；`pnpm build`（`tsc -b && vite build`）成功（1634 modules）。
- 视觉 / 运行期验收：**未渲染、未截图**（写入即交付）。海报底边是否已无硬边、侧栏导航是否已上提，见 `SCREENSHOT_CHECKLIST.md` 的 B 级待验行。
- 设计原型 `design/open-design/v1.1.2/prototype/index.html` 未同步（原型为静态演示，其侧栏与海报底部结构不同）。

## 正式前端：首页工具条移入标题栏窗口按钮左侧（2026-09-22）

背景：用户要求把首页顶部工具条（作品数 + 媒体库 / 刷新 / 设置）从海报上挪走，挂到自定义 Windows 标题栏里、紧挨最小化 / 最大化 / 关闭三个窗口按钮的**左侧**。工具条仍属于首页功能（媒体库 / 刷新 / 设置按钮的数据依赖首页已加载的 state），因此不改动按钮行为，只改承载位置。

| 功能 ID | 修改前 | 修改后 | 修改原因 | 涉及页面 | 后端影响 | 需确认 |
|---|---|---|---|---|---|---|
| SHELL-013 | 首页工具条 `.seanime-home-toolbar` 以绝对定位贴在海报右上（`top: var(--win-titlebar)` / `right: 44px`），与海报抢同一块空间，且随窗口宽度需要多档媒体查询微调 `right` | `WindowTitleBar.tsx` 在 `.window-controls` 之前新增插槽 `<div class="window-tools" id="window-titlebar-tools">`；`HomePage.tsx` 用 `createPortal` 把 `.seanime-home-toolbar` 渲染进该插槽；样式改为标题栏内的紧凑横排（`position: static`，按钮 28×28、图标 16px、作品数胶囊 `display` 隐藏于 ≤900px），移除原绝对定位与各断点的 `right` 覆盖 | 用户要求把工具条移到标题栏、窗口按钮左侧 | 首页 · 主标题栏 | 无 | 否 |

- 改动文件：`src/components/WindowTitleBar.tsx`（新增 `.window-tools` 插槽；拖动区域排除选择器由 `.window-controls` 扩为 `.window-controls, .window-tools`，避免在工具条上按下按钮时误触窗口拖动 / 双击最大化）、`src/pages/HomePage.tsx`（引入 `useLayoutEffect` / `createPortal`；`toolsHost` state + 布局期 effect 读取 `#window-titlebar-tools`；抽出 `homeToolbar` 变量并 portal 渲染；图标尺寸 19 → 16）、`src/v1-1-1.css`（新增 `.window-tools` 及子元素规则；移除 `.seanime-home-toolbar` 的绝对定位、`top` / `right` 与首页两处断点覆盖）。
- 工具条元素本身不再属于首页内容流：`.gnz-home .seanime-home-toolbar` 旧定位规则全部删除，`HomePage` 仅在插槽存在时 portal 渲染（`toolsHost ? createPortal(...) : null`），无插槽时首页与先前一致。
- 未修改 `src-tauri/`、Rust、SQLite、迁移、`src/api.ts`、`src/types.ts`、`src/data/tauriProvider.ts`、`package.json`。
- 校验：`pnpm check`（`tsc -b`）退出码 0；`pnpm test` **20/20** 通过；`pnpm build`（`tsc -b && vite build`）成功（1634 modules）。
- 视觉 / 运行期验收：**未渲染、未截图**（写入即交付）。工具条是否落在窗口按钮左侧、窗口拖动 / 双击最大化的命中区是否仍正确，见 `SCREENSHOT_CHECKLIST.md` 的 B / C 级待验行。
- 设计原型 `design/open-design/v1.1.2/prototype/index.html` 未同步（原型为静态演示，无自定义标题栏窗口按钮区）。
