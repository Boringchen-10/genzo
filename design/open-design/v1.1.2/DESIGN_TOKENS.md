# Genzo UI Design v1.1.2 — Design Tokens

版本：v1.1.2（继承 v1 主题，仅补 v1.1.1 修订值）  
日期：2026-09-14

## 主题变量

| Token | 深色 | 浅色 |
|---|---|---|
| `--bg` | `#090d0f` | `#f3f6f5` |
| `--bg-raised` | `#0f1518` | `#e7edeb` |
| `--surface` | `rgba(17,24,27,.72)` | `rgba(255,255,255,.78)` |
| `--surface-strong` | `rgba(18,25,29,.92)` | `rgba(255,255,255,.94)` |
| `--line` | `rgba(255,255,255,.105)` | `rgba(8,20,18,.14)` |
| `--line-strong` | `rgba(255,255,255,.18)` | `rgba(8,20,18,.26)` |
| `--text` | `#f4f7f6` | `#16201e` |
| `--muted` | `#a8b0af` | `#42524e` |
| `--quiet` | `#77817f` | `#5c6a66` |
| `--accent` | `#75d2ad` | `#197a5b` |
| `--danger` | `#ff8e8e` | `#b64242` |
| `--tint` (RGB) | `255,255,255` | `8,20,18` |
| `--shade` (RGB) | `9,13,15` | `243,246,245` |

圆角上限 8px；状态徽标 4px 或 999px 胶囊。

## v1.1.1 新增 / 修订

| 项 | 值 | 用途 |
|---|---|---|
| `--win-titlebar` | `40px` | Windows 自定义标题栏高度；侧栏 / 内页 `top` 同步 |
| 标题栏底色 | 深色与浅色均为 `rgba(var(--shade),.58)`（等于页面背景色） | 与页面背景同色，不形成色带或分界线；**不使用**完整矩形描边 |
| 标题栏模糊 | `backdrop-filter: blur(18px)` | 与页面背景自然衔接 |
| 标题栏分隔线 | 无 | 标题栏不加底部线 |
| 首页栏偏移 | `.topbar { top: var(--win-titlebar) }` | 首页面包屑 / 搜索 / 图标位于标题栏之下；首页大图仍从 y=0 铺开并与标题栏融合 |
| 关闭按钮悬停 | `background:#c42b1c; color:#fff` | Windows 危险色 |
| 弹窗表面 | 深色 `rgba(18,25,29,.985)`；浅色 `rgba(255,255,255,.985)` | 防止透明重叠、保证文字可读 |
| 弹窗遮罩 | `rgba(3,6,8,.66)` + `blur(5px)` | 背景仅保留低对比轮廓 |
| 弹窗高度 | `max-height: min(90vh, calc(100vh - 88px))`；`≤700px` 高时 `calc(100vh - 40px)` | 适配 1024×640，内容区独立滚动 |
| 浅色首页文字遮罩 | 宽 `min(760px,64%)`，`rgba(243,246,245,.86) → 0` | 局部保护文字，不漂白整张背景 |
| 焦点环 | `outline: 2px solid var(--accent); outline-offset: 2px` | 键盘可见性 |
| Future 徽标 | `1px solid var(--line-strong)`，字号 10.5px，`opacity` 由所在控件 `.gnz-future` 控制 | 标记未实现能力 |

## 正式前端新增：顶部栏 / 侧栏透明度（2026-09-22）

| 项 | 值 | 用途 |
|---|---|---|
| `--topbar-opacity` | `0`（默认，无单位 `0–1`；由设置里的「顶部栏透明度」滑块 0–100% 写入） | 标题栏与侧栏的背景不透明度；`0` = 完全透明、融入首页海报背景 |
| 标题栏底色 | `rgba(var(--shade), var(--topbar-opacity))` | 由该 token 单一控制；**不再**在首页显示海报裁剪条 |
| 侧栏底色 | `rgba(var(--shade), var(--topbar-opacity))` | 与标题栏同源；悬停 / 聚焦时 `+ .05`（上限 1） |
| 侧栏右边框 | `rgba(var(--tint), calc(var(--topbar-opacity) * .14))` | 透明度为 0 时边框一并隐去，完全融入背景 |
| 侧栏 / 标题栏模糊 | `blur(calc(var(--ui-blur) * var(--topbar-opacity)))` | 透明度为 0 时无模糊；调高后模糊随 `--ui-blur` 同步 |

> 注：本节取代上文 v1.1.1 表格中「标题栏底色 `rgba(var(--shade),.58)` + blur(18px)」的旧值——该值经 `SHELL-004` 已改为透明，本轮进一步改为可调 token（默认 `0`）。

## 正式前端新增：海报底部渐变融合与侧栏品牌移除（2026-09-22）

| 项 | 值 | 用途 |
|---|---|---|
| `--poster-fade-bottom` | `108px` | 海报底端淡出到页面底色：`linear-gradient(0deg, var(--bg) 0, transparent var(--poster-fade-bottom))`；与顶部 `--poster-fade`（`120px`）对称，略小于顶部以免淡化标题区 |
| 海报底部硬线 | 移除 `.gnz-home .seanime-banner` 的 `border-bottom` | 由底部渐变取代 1px 硬边 |
| 侧栏品牌标志 | 移除 `.brand`（`G` 方块 + `Genzo` / `MEDIA LIBRARY` 文本）；`.nav-list` 自侧栏顶部起排 | 侧栏只保留一级导航，导航整体上提 |

## 正式前端新增：移除海报侧边暗角（2026-09-22）

| 项 | 值 | 用途 |
|---|---|---|
| 海报侧边暗角层 | **移除** `.gnz-home .seanime-banner::after` 中的 `linear-gradient(90deg, …)` 层（深色 `rgb(5 10 11 / .84) → 透明`，浅色 `rgb(243 246 245 / .8) → 透明`，含 `.app-frame.is-home-route` 变体） | 海报左半幅保持原图亮度，不再整块压暗 |
| 保留的 `::after` 层 | 顶端淡出 `linear-gradient(180deg, var(--bg) 0, transparent var(--poster-fade))` + 底端淡出 `linear-gradient(0deg, var(--bg) 0, transparent var(--poster-fade-bottom))` + 底部压暗 `linear-gradient(0deg, rgb(5 10 11 / .54), transparent 46%)`（浅色 `rgb(243 246 245 / .2)`） | 顶部 / 底部与页面底色渐变融合；保证左下标题与右下海报栏的对比度 |

## 字体与图标

- 标题：`Bahnschrift SemiCondensed`；正文：`Segoe UI Variable Text` / `Microsoft YaHei UI`；系统字体，无 Web Font / CDN。
- 图标：内联 SVG 线性图标，线宽 1.8px，统一圆角端点。

## 动效

默认 220ms，允许 150–300ms，`cubic-bezier(.2,.8,.2,1)`；仅动画 `transform` / `opacity` / 颜色 / 边框；支持 `prefers-reduced-motion`。
