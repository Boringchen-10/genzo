# Genzo Android 首版 — 设计 Token

> 本文件是 Android 触屏端的 Token 规范。桌面端 Token 见根目录 `DESIGN_TOKENS.md`；移动端延续其品牌与语义，只调整尺寸档与交互尺寸。
> 对应实现文件：`android/index.html`（canonical）中的 `:root` 与 `[data-theme="light"]`。

## 1. 颜色

深色为默认主题；浅色主题跟随系统或手动切换。

| Token | 深色（默认） | 浅色（跟随系统） | 用途 |
|---|---|---|---|
| `--bg` | `#090d0f` | `#f3f6f5` | 页面背景 |
| `--bg-raised` | `#0f1518` | `#e7edeb` | raised 区域 |
| `--surface` | `rgba(17,24,27,.72)` | `rgba(255,255,255,.78)` | 玻璃表面 |
| `--surface-strong` | `rgba(18,25,29,.92)` | `rgba(255,255,255,.94)` | 弹层 / 抽屉 / 底栏 |
| `--surface-soft` | `rgba(var(--tint),.055)` | `rgba(8,20,18,.055)` | 轻表面 |
| `--line` | `rgba(var(--tint),.105)` | `rgba(8,20,18,.14)` | 默认边框 |
| `--line-strong` | `rgba(var(--tint),.18)` | `rgba(8,20,18,.26)` | 强边框 |
| `--text` | `#f4f7f6` | `#16201e` | 主文字 |
| `--muted` | `#a8b0af` | `#53625e` | 次文字 |
| `--quiet` | `#77817f` | `#71807b` | 辅助文字 |
| `--accent` | `#75d2ad` | `#197a5b` | 强调 / 选中 / 进度 |
| `--accent-ink` | `#07120e` | `#07120e` | 强调色上的文字 |
| `--danger` | `#ff8e8e` | `#b64242` | 错误 / 危险 |
| `--warn` | `#e9c46a` | `#9a7508` | 待确认 / 扫描告警 |
| `--tint` / `--shade` | `255,255,255` / `9,13,15` | `8,20,18` / `243,246,245` | 透明度基底 |

对比度：正文 `--text` 对 `--bg` ≥ 12:1；`--muted` 对 `--bg` ≥ 7:1；`--accent` 用于强调与进度，文字用途时配合 `--accent-ink`。状态不依赖颜色，均配文字或图标。

## 2. 字体

Android 不保证 `Bahnschrift`，显示字体改为可用的窄体无衬线栈，保留"窄体标题 + 安静正文"的性格。

| 层级 | 字体栈 | 字号 / 行高 | 字重 |
|---|---|---|---|
| Display（首页焦点、详情标题） | `"Roboto Condensed","Bahnschrift SemiCondensed","Noto Sans SC",system-ui,sans-serif` | `clamp(30px,8.5vw,52px)` / 1.05 | 700 |
| Page heading（页面标题） | 同上 | 22px / 1.2 | 700 |
| Section heading | 正文栈 | 18px / 1.3 | 700 |
| Body | `"Roboto","Segoe UI Variable Text","Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif` | 16px / 1.65 | 400 |
| Label | 正文栈 | 13–14px / 1.35 | 600–700 |
| Caption / meta | 正文栈 | 11–12px / 1.4 | 400 |
| Numeric（时间 / 集数 / 进度） | 正文栈，`font-variant-numeric:tabular-nums` | 随层级 | 500–600 |

不加载任何外部字体或 CDN。

## 3. 间距

- 基数 4px；移动档位：`4 / 8 / 12 / 16 / 20 / 24 / 32`。
- 页面水平内边距：`16px`（`--pad`）。
- 卡片网格间距：`12px`；列表行垂直间距：`10px`。
- 顶栏高度 `56px`（`--topbar-h`）；底部导航高度 `56px`（`--tabbar-h`）。
- 安全区：`--phone-safe-top:52px`、`--phone-safe-bottom:28px`（由手机壳提供）；底部导航另加 `--phone-safe-bottom` 内边距。

## 4. 圆角与阴影

| Token | 值 | 用途 |
|---|---|---|
| `--radius` | `8px` | 卡片 / 按钮 / 输入默认 |
| `--radius-sm` | `4px` | 标签 / chip / 徽标 |
| `--sheet-radius` | `16px` | 底部抽屉 / 弹层 |
| `--shadow` | `0 20px 60px rgba(0,0,0,.34)` | 弹层 / 焦点卡 |
| 高光 | `inset 0 1px rgba(var(--tint),.08-.10)` | 玻璃表面 |

## 5. 动效

- 默认时长 `220ms`；范围 `150–300ms`；大过渡 ≤ 400ms。
- 缓动 `cubic-bezier(.2,.8,.2,1)`；退出更快，ease-in。
- 入场 ease-out、出场 ease-in；列表项错峰 `30–50ms`。
- 仅动画 `transform`、`opacity`、颜色、边框；`prefers-reduced-motion:reduce` 时关闭非必要动画与错峰。

## 6. 触控与可达性

- 触控目标最小 `44×44px`（`.od-touch` / `--tap:44px`）；相邻目标间距 ≥ 8px。
- 可见焦点：`outline:2px solid var(--accent); outline-offset:3px`（键盘 / 遥控）。
- 交互元素带可访问名称；图标按钮使用 `aria-label`。
- 图片有意义时给 `alt`；纯装饰背景加 `aria-hidden`。
- 长文本统一用 `od-truncate`（列表）/ `od-clamp-2`（卡片），详情页完整展示。

## 7. 图标

- 内联 SVG 线性图标，描边约 `1.8px`，圆角端点，与桌面端同一家族。
- 导航 `22px`、工具按钮 `20–22px`、行内 `16–18px`。
- 不使用 emoji 作为功能图标。

## 8. 层级（z-index）

| 层 | z-index |
|---|---|
| 内容 / 卡片 | 1–10 |
| 手机壳系统栏、灵动孔、手势条 | 15–20（shell 固定） |
| 底部导航 | 14 |
| Toast | 60 |
| 底部抽屉 / 弹层 | 80–90 |
| 播放器覆盖层 | 100–120 |

## 9. 与桌面端的差异（须记录）

- 显示字体由 `Bahnschrift SemiCondensed` 换为窄体无衬线栈（Android 无该字体）。
- 侧栏 → 底部导航；顶部栏高度 72px → 56px；水平内边距改为 16px 固定档。
- 悬停态（hover）改为 `@media (hover:hover)` 限定，触屏以按下态为主。
- 焦点改为键盘 / 遥控可达；新增安全区与手势导航留白。
- 颜色、强调色、圆角默认值、动效曲线数值与桌面端保持一致。
