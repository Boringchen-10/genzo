# 第三方依赖与许可证

Genzo v0.2 使用以下直接依赖。具体传递依赖及锁定版本以 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock` 为准。

## 前端与构建工具

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM | 用户界面 | MIT |
| React Router DOM | 页面路由 | MIT |
| Zustand | 前端状态 | MIT |
| Lucide React | 界面图标 | ISC |
| Tauri JavaScript API / Dialog Plugin | 桌面桥接与原生对话框 | Apache-2.0 OR MIT |
| Vite / React Plugin | 开发与前端构建 | MIT |
| TypeScript | 类型检查 | Apache-2.0 |
| Tailwind CSS | CSS 基础层 | MIT |
| PostCSS / Autoprefixer | CSS 处理 | MIT |
| Vitest | 前端测试 | MIT |
| Playwright Core | 本地 WebView 视觉验收 | Apache-2.0 |

## Rust 后端

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| Tauri / Tauri Build / Dialog Plugin | 桌面运行时与构建 | Apache-2.0 OR MIT |
| SQLx | SQLite 异步访问与迁移 | Apache-2.0 OR MIT |
| Tokio | 异步运行时 | MIT |
| Serde / serde_json | 数据序列化 | Apache-2.0 OR MIT |
| uuid | 本地记录标识 | Apache-2.0 OR MIT |
| chrono | 时间处理 | Apache-2.0 OR MIT |
| walkdir | 目录遍历 | Unlicense OR MIT |
| natord | 文件名自然排序 | MIT |
| dunce | Windows 路径规范化 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| thiserror | 错误类型 | Apache-2.0 OR MIT |
| regex | 动漫文件名规则解析 | Apache-2.0 OR MIT |
| strsim | 标题相似度评分 | MIT |
| reqwest | Bangumi 官方 API HTTPS 请求 | Apache-2.0 OR MIT |
| windows | Windows Shell API 绑定 | Apache-2.0 OR MIT |
| tempfile | 测试临时目录 | Apache-2.0 OR MIT |

SQLite 本身属于公有领域（Public Domain）。

## Seanime

Genzo 的侧栏、首页媒体布局和主题实现基于 Seanime 的 GPLv3 界面结构进行移植与修改。Seanime 源码：<https://github.com/5rahim/seanime>，许可证为 GNU GPL v3.0。Genzo 不使用 Seanime 的名称、Logo、截图或其界面中展示的第三方动画素材。

`public/demo` 中的临时主题预览图片来自 Unsplash 图片服务，只能通过开发预览参数使用。正式应用界面不会加载这些图片；没有用户封面时使用 Genzo 自有的类型占位视觉。

本项目未捆绑 VLC、mpv、PotPlayer、MPC-BE 等外部程序。自动检测仅检查用户机器上的典型安装路径。

## Bangumi

Genzo 通过 Bangumi 官方 API（<https://github.com/bangumi/api>）搜索动画条目并读取作品元数据，不抓取网页。作品数据及封面版权归各自权利人所有，Genzo 仅按用户操作在本地缓存。实现未复制 Animeko 代码，也未移植 Anitomy 或 Seanime 的识别代码；文件名解析和评分为本项目独立 Rust 实现。

Genzo 的探索功能还使用 `bangumi-data`（<https://github.com/bangumi-data/bangumi-data>）提供的番组标题、译名、放送时间与 Bangumi 条目 ID 索引。该数据集采用 [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)（CC BY 4.0）许可；Genzo 通过项目文档公开的 `unpkg` 地址读取数据并保留来源标识，解析后仅缓存 Bangumi ID，不缓存或使用其中列出的在线播放站点标识。
