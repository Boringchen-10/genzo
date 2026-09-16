# Genzo UI Design v1.1.2 — UI Handoff

版本：**Genzo UI Design v1.1.2**（v1.1.1 的定点修订）  
日期：2026-09-14  
目录：`…/projects/3c549762-06b7-488d-9932-b15a40d171a8/v1.1.2/`  
只读基线：**v1**、**v1.1**、**v1.1.1**（未覆盖、未删除）

> 本文件只描述 v1.1.2 的有效结论。历史版本全文见 `HISTORY.md`。
> “设计完成”不等于“功能已实现”；后端真实性以 `BACKEND_CAPABILITY_MATRIX.md` 为准。

## v1.1.2 修复内容

| 编号 | 问题 | 修复 |
|---|---|---|
| F-11 | 打开作品详情后，左侧导航被 Overlay Manager 设为 `inert`，无法点击切页，必须先点“返回” | 详情页按**整页**处理：`#detailPage` 位于最上层时**不再对 `.sidebar` 施加 `inert`**，左侧导航保持可见、可点（点击导航沿用既有逻辑：先关闭详情再切页）；其它模态弹窗仍保持整个背景 `inert` —— 由 `applyInert()` 按当前最上层弹层判定 |
| F-12 | 打开设置抽屉后，左侧导航被设为 `inert`，无法点击切页 | 与 F-11 同样处理：`#themeDrawer` 位于最上层时**不再对 `.sidebar` 施加 `inert`**；点击导航会先关闭抽屉（`closeDrawer()`）再切页，其它模态弹窗仍保持整个背景 `inert` |
| F-13 | 标题栏在上一轮被改成半透明色带（`rgba(var(--shade),.58)` + `backdrop-filter: blur(18px)`，浅色同值） | 标题栏恢复**完全透明**：`background: transparent`，去掉 `backdrop-filter` 与底部分隔线，与首页大图 / 页面背景直接融合 |
| F-14 | 首页精选大图固定为同一张 `reference-primary.png`；切换「切换到其他作品」只改变裁切位置，观感上背景不随作品更换（截图标注“首页的背景在程序里并没有根据作品更换”） | `featuredWorks` 每部作品新增 `tint`；`selectFeatured()` 把 `.hero-art` 背景改为 `linear-gradient(tint,tint), url("assets/reference-primary.png")` + `background-blend-mode: color`，同一张自制抽象位图按作品取色；`hero-nav-thumb` 同步取色；初始化调用 `selectFeatured(0)`，首屏与切换一致 |
| F-15 | 浅色主题过白：首页精选大图被两层近不透明的白色渐变覆盖，背景图基本看不清 | 浅色主题只留一层文字遮罩并提前淡出——`.hero-art::after` `rgba(243,246,245,.78→0)`（78% 处透明）、`.hero::after` `rgba(243,246,245,.3→0)`（68% 处透明），`.hero-art` 透明度 1；右侧背景图清晰可见，左侧文字对比度仍达标 |
| F-16 | 正式前端首页横幅把 2:3 竖版封面 `cover` 铺满 552px 宽横幅，海报被极度放大、比例失真；浅色遮罩 `rgb(243 246 245 / .91→.77)` 又把它洗白 | 正式 React 前端：封面改为右侧**保持自身比例的清晰海报**（`height:82%; width:auto; object-fit:contain`，≤1040px 隐藏），背后为同一封面的**模糊放大副本**（`blur(40px)`、`opacity:.85`）；浅色遮罩减弱为 `.8→0`（56% 处透明） |
| F-17 | 作品详情页顶部背景固定为 `reference-secondary.png`，对每部作品都一样，点开详情看着仍像「首页那张背景图」 | `openDetail()` 调 `tintFor(title)` 取得当前作品的取色，把 `.detail-backdrop` 背景改为 `linear-gradient(tint,tint), url("assets/reference-secondary.png")` + `background-blend-mode: color`，详情背景随作品变化；正式前端详情页用作品真实封面（`--detail-artwork`） |

| F-18 | 探索页 Tab 下方有「最高热度」横向卡片区，与下面的作品网格重复 | 整段删除（样式 + 标记 + 点击监听）；列表直接进入「推荐作品」海报网格 |
| F-19 | 点开探索条目弹出独立小弹窗，与作品详情页的版式不一致 | 条目详情改用**作品详情页版面**（整页）：背景图 `detail-backdrop`、顶栏「返回探索」、封面 / 大标题 hero、网络评分与排名统计、简介与标签、右侧「条目信息」栏，底部「加入媒体库 / 追番状态 / 收藏」；返回后回到探索列表 |

## v1.1.1 修复内容

| 编号 | 问题 | 修复 |
|---|---|---|
| F-01 | 标题栏浮在内容之上，首页 `首页` 面包屑、搜索框与图标被标题栏遮挡 | 标题栏改为**半透明表面**（`rgba(var(--shade),.58)` + `backdrop-filter: blur(18px)`）；首页大图仍从窗口 y=0 铺开并与标题栏融合，仅把**首页栏 `.topbar` 下移到标题栏之下**（`top: var(--win-titlebar)`），不再有内容压在标题栏下，也不把整页内容整体推下 |
| F-02 | 标题栏外观 | **无底部分隔线**；深色与浅色同为 `rgba(var(--shade),.58)`（等于页面背景色，因此不形成色带或分界线）；标题与 Genzo 标识保持小巧；窗口按钮维持标准 Windows 位置；关闭按钮仅在悬停显示危险色 `#c42b1c` |
| F-03 | Future 功能出现虚假「已连接 / 已授权」 | WebDAV / 网盘来源类型与网盘授权入口禁用并标 `Future` + tooltip；远程来源行加 `Future` 徽标并把「已连接 / 已授权 / 已同步」改写为「尚未开放」；远程来源**不计入**来源与作品统计 |
| F-04 | 工具页「一键下载」 | 所有下载按钮禁用并改为「尚未开放」+ tooltip；副标题改为「Future：下载与安装需要新增后端」 |
| F-05 | 设置「下载与备份」像当前可用 | 该标签标记 `· Future`，面板内控件全部禁用，顶部加入 Future 说明；删除「新下载的剧集 / 漫画会保存到这里」等当前可用语气 |
| F-06 | 扫描伪造实时进度与目录组统计 | 扫描指标在运行期只显示「正在扫描（无实时进度）」；任何 `%` 或「已完成 N」被拦截改写；「目录组」改为「目录组（需新增后端）」且值为 `—`；无百分比进度条 |
| F-07 | 扫描重试命名 | 「重试失败项」→ **「重新扫描此目录」**，tooltip 明确「重新扫描整个目录；不是只重试失败项」 |
| F-08 | 手动匹配弹窗透明重叠 / 高度不稳 | 弹窗表面改为不透明（深色 `rgba(18,25,29,.985)` / 浅色 `rgba(255,255,255,.985)`），`max-height: min(90vh, calc(100vh - 88px))`，内容区独立滚动，标题与底部操作区 sticky，长标题 / 长文件名 `overflow-wrap: anywhere` |
| F-09 | 焦点陷阱只覆盖部分弹层 | 统一 **Overlay Manager**（见下），覆盖全部弹层并处理 inert / Tab 循环 / Esc / 焦点返回 |
| F-10 | 浅色主题整页洗白 | 移除整页白色渐变，改为**局部文字遮罩**（宽度 `min(760px,64%)`）；提升次要文字对比；背景图仍可辨认 |
| F-11 | 参考素材含其他界面文字与未授权动漫截图 | 全部替换为 **Open Design 自制抽象几何占位图**（2 张背景 + 6 张中性头像），文件名保持不变以免引用失效 |

## 统一 Overlay Manager

覆盖：`#matchDialog`、`#sourceDialog`、`#confirmDialog`、`#detailDialog`、`#themeDrawer`、播放器/阅读器 `#g11Player`、元数据编辑 `#g11Meta`、候选对比 `#g11Cand`、作品组 `#gnzInbox`、作品详情 `#detailPage`。

行为：
1. 打开后焦点进入该弹层第一个可交互控件。
2. 背景区域（首页 / 探索 / 媒体库 / 收藏 / 工具 / 侧栏 / 标题栏 / 氛围层）设置 `inert`。
3. `Tab` / `Shift+Tab` 在当前弹层内循环，隐藏弹层不进入 Tab 顺序。
4. `Esc` 关闭允许关闭的弹层；v1 自有弹层与详情页沿用其原生关闭逻辑（幂等）。
5. 关闭后焦点返回原触发按钮。
6. 嵌套弹层只由最上层接收键盘操作。
7. 图标按钮统一补齐 `aria-label` 与 `title`。

## Windows 自定义标题栏：正式实现要求

| 需求 | 说明 |
|---|---|
| `data-tauri-drag-region` | 标题栏空白区作为拖动区域；避免覆盖在按钮上 |
| 最小化 | 调用 Tauri window API |
| 最大化 / 还原 | 双击标题栏切换；按钮状态与窗口状态同步 |
| 关闭 | 标准位置；悬停使用 Windows 危险色 |
| 最大化状态同步 | 监听窗口 resize / maximized 事件更新按钮图标与可点击行为 |

> **必须在真实 Tauri 窗口中验证**：拖动、双击最大化、Snap Layout 命中区、窗口缩放、DPI 变化、多显示器行为。HTML 原型**不声称**已通过上述系统级验证。

## 验证等级（本交付）

| 等级 | 含义 | 适用范围 |
|---|---|---|
| A. 已由 Open Design 核对（源码级） | 写入时的源码级检查，不含渲染 | 断点存在性、栅格/截断声明、inert/Tab 逻辑、文本改写、SHA-256 与 assets 一致性 |
| B. 需开发 Agent 验证 | 需在浏览器 / 应用中运行确认 | 视觉对比、遮挡、滚动、焦点实际行为、浅色对比、1024×640 布局 |
| C. 必须在真实 Tauri 窗口验证 | 系统级行为 | 标题栏拖动、Snap Layout、最大化同步、DPI、缩放 |

## 页面与组件（保留自 v1.1）

首页、探索、媒体库、收藏、工具、设置抽屉；作品详情；作品组形式的待整理；动画作品组 → 季度 → 剧集 → 视频 / 字幕下钻；漫画「作品 → 卷/话 → 图片」；批量确认 / 批量重新识别（Future 入口）；Bangumi 探索（已接入正式数据，见 `DESIGN_CHANGELOG.md` 实现阶段修订）；深浅主题；左侧窄导航；播放器 / 阅读器选择；元数据编辑；候选对比。

## 作品详情：官方分集结构与元数据刷新（2026-09-16 接入）

数据来源：`getAnimeWorkStructure` / `refreshWorkMetadata` / `setMediaEpisode` / `getMediaThumbnail`（`GenzoDataProvider` 的可选方法，前端通过 `getAnimeDetailProvider()` 访问；`src/data/tauriProvider.ts` 的委托由 Codex 补齐）。

| 区域 | 交互 | 数据 / 约束 |
|---|---|---|
| 章节与文件 | 官方分集卡片网格；每张卡下逐一列出本地版本 | `episodes[].localFiles[]`。**同一分集可有多个压制版本**，不按集数去重；无标题的集显示「第 N 集」，不虚构标题 |
| 本地版本 | 打开 / 更多（其它工具、系统默认程序、打开所在目录、解除分集关联、解除作品关联） | `MediaFile.missing` 为真时禁用「打开」并显示「文件缺失」 |
| 本地版本缩略图 | 进入可见范围才请求一次（`IntersectionObserver`） | `getMediaThumbnail` 返回 `null` 是合法结果（部分 MKV/HEVC 无法提取），显示中性文件占位，**不用作品海报冒充视频帧**；缩略图失败不阻断打开 / 定位 |
| 未匹配文件 | 选择官方分集 → 「关联」；已映射 → 「解除分集关联」 | `setMediaEpisode(mediaFileId, episodeExternalId)`，`null` 表示解除；成功后重新读取结构，失败显示真实错误 |
| 关联作品 | 显示 `relation`；`localWorkId` 存在时可跳转 | 来自 Bangumi **关联条目**，不保证都是季度：仅 `seasonNumber !== null` 显示「第 N 季」，剧场版 / OVA / 续集按 `relation` 标注，`localWorkId` 为空显示「未入库」 |
| 元数据识别 · 刷新元数据 | 点击后禁用防重复；成功后重新 `getWork()` + 结构 | `refreshWorkMetadata` **只返回动画结构**；简介与标签必须重读 `getWork`；失败提示并**保留旧内容** |
| 制作人员与角色 | 头像缺失时首字占位 | `staff` / `characters`；条目的 `warnings` 原样展示 |
| 网络评分 | 显示「暂无 · 未提供」并注明「来自 Bangumi，不会写入你的个人评分」 | 个人评分仍是独立的本地字段 |

探索页「推荐」新增**动画排行**区（`animeRanking`，分页「加载更多」，含 loading / 错误 / 空 / `stale` 缓存标记与入库 / 收藏角标）。「注目动画 · 最近 30 日标记」保持 `Future` 且**无入口**。

> 未接入时（Codex 尚未补齐 `src/data/tauriProvider.ts` 的委托）：`getAnimeDetailProvider()` / `getAnimeRankingProvider()` 返回 `null`，对应区域显示「尚未接入」，**不伪造数据**。
