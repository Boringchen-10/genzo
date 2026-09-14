# Genzo UI Design v1.1.1 — Design Tokens

版本：v1.1.1（继承 v1 主题，仅补 v1.1.1 修订值）  
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
| 标题栏底色 | 深色 `rgba(var(--shade),.58)`；浅色 `rgba(255,255,255,.72)` | 半透明覆盖，**不使用**完整矩形描边 |
| 标题栏模糊 | `backdrop-filter: blur(18px)` | 与首页背景连续 |
| 标题栏分隔线 | `1px solid rgba(var(--tint),.07)` | 极弱底部线 |
| 关闭按钮悬停 | `background:#c42b1c; color:#fff` | Windows 危险色 |
| 弹窗表面 | 深色 `rgba(18,25,29,.985)`；浅色 `rgba(255,255,255,.985)` | 防止透明重叠、保证文字可读 |
| 弹窗遮罩 | `rgba(3,6,8,.66)` + `blur(5px)` | 背景仅保留低对比轮廓 |
| 弹窗高度 | `max-height: min(90vh, calc(100vh - 88px))`；`≤700px` 高时 `calc(100vh - 40px)` | 适配 1024×640，内容区独立滚动 |
| 浅色首页文字遮罩 | 宽 `min(760px,64%)`，`rgba(243,246,245,.86) → 0` | 局部保护文字，不漂白整张背景 |
| 焦点环 | `outline: 2px solid var(--accent); outline-offset: 2px` | 键盘可见性 |
| Future 徽标 | `1px solid var(--line-strong)`，字号 10.5px，`opacity` 由所在控件 `.gnz-future` 控制 | 标记未实现能力 |

## 字体与图标

- 标题：`Bahnschrift SemiCondensed`；正文：`Segoe UI Variable Text` / `Microsoft YaHei UI`；系统字体，无 Web Font / CDN。
- 图标：内联 SVG 线性图标，线宽 1.8px，统一圆角端点。

## 动效

默认 220ms，允许 150–300ms，`cubic-bezier(.2,.8,.2,1)`；仅动画 `transform` / `opacity` / 颜色 / 边框；支持 `prefers-reduced-motion`。
