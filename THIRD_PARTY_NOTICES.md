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
| anitomy-ng | 动画文件名结构解析（Anitomy 的纯 Rust 移植） | MPL-2.0 |
| tmdb-rs | TMDB 官方 API 的类型化 Rust 客户端 | MIT |
| async-trait | 异步元数据 Provider trait | Apache-2.0 OR MIT |
| lru | 进程内元数据搜索缓存 | MIT |
| image | 封面格式校验与缩略图生成 | Apache-2.0 OR MIT |
| windows | Windows Shell API 绑定 | Apache-2.0 OR MIT |
| tempfile | 测试临时目录 | Apache-2.0 OR MIT |

SQLite 本身属于公有领域（Public Domain）。

## Seanime

Genzo 的侧栏、首页媒体布局和主题实现基于 Seanime 的 GPLv3 界面结构进行移植与修改。Seanime 源码：<https://github.com/5rahim/seanime>，许可证为 GNU GPL v3.0。Genzo 不使用 Seanime 的名称、Logo、截图或其界面中展示的第三方动画素材。

`public/demo` 中的临时主题预览图片来自 Unsplash 图片服务，只能通过开发预览参数使用。正式应用界面不会加载这些图片；没有用户封面时使用 Genzo 自有的类型占位视觉。

本项目未捆绑 VLC、mpv、PotPlayer、MPC-BE 等外部程序。自动检测仅检查用户机器上的典型安装路径。

PotPlayer 进度适配使用其 Windows 消息协议及安装目录的 `CmdLine64.txt` 参数说明；接口常量核对自 [PotPlayerControl 的 InternalSimpleCmd.h](https://github.com/ld3l/PotPlayerControl/blob/main/InternalSimpleCmd.h)。适配器为独立 Rust 实现，未复制该项目的控制器实现、商标或素材，也未捆绑 PotPlayer。该接口在不同播放器版本中可能变化，连接或文件核对失败时保留旧进度。

## Kira 漫画目录接口参考

漫画探索适配参考 [caolib/kira](https://github.com/caolib/kira) 的 `lib/api/manga/manga_api.dart`、`lib/api/api_transport.dart` 与 `lib/models/comic.dart`，核对版本 `19a17c5`（2026-10-02）。Genzo 独立实现 Rust 请求 / SQLite 缓存和 React 界面，借鉴其目录分页、请求头及作品字段约定；不捆绑 / 启动 Kira，不移植 Flutter 界面、账号或章节内容代码，不复制商标、Logo 与第三方素材。

上游使用 MIT License，Copyright (c) 2026 孤独的Lonely；完整版权和许可见 [licenses/kira-MIT.txt](licenses/kira-MIT.txt)。第三方客户端的许可不等于作品数据 / 封面版权或接口官方授权；封面按用户操作缓存，接口兼容性可能随服务改变。本阶段只读取作品元数据。

## Bangumi

Genzo 通过 Bangumi 官方 API（<https://github.com/bangumi/api>）搜索动画条目并读取作品元数据，不抓取网页。作品数据及封面版权归各自权利人所有，Genzo 仅按用户操作在本地缓存。动画结构解析使用 MPL-2.0 的 `anitomy-ng`；中文目录预处理、目录回溯和加权候选评分为 Genzo 自有实现。实现未复制 Animeko 代码。

Genzo 的探索功能还使用 `bangumi-data`（<https://github.com/bangumi-data/bangumi-data>）提供的番组标题、译名、放送时间与 Bangumi 条目 ID 索引。该数据集采用 [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)（CC BY 4.0）许可；Genzo 通过项目文档公开的 `unpkg` 地址读取数据并保留来源标识，解析后仅缓存 Bangumi ID，不缓存或使用其中列出的在线播放站点标识。

发布包内置用户于 2026-09-15 提供的 `bangumi-data 0.3.132` 数据快照，用于离线标题索引、本季番组和放送时间表。Genzo 仅提取标题、译名、类型、日期和信息站点 ID；不将其中的在线播放站点作为媒体源。

## TMDB 与 AniList

Genzo 使用 `tmdb-rs` 访问 TMDB 官方 API。TMDB 仅在用户配置自己的 Read Access Token 后启用，用于补全经过标题与年份校验的海报和背景图；不提供媒体播放地址。TMDB API 使用受其服务条款约束，图片版权归各自权利人所有。

Genzo 使用 AniList 公共 GraphQL API 补全经过校验的国际评分、标签和视觉字段。Genzo 不要求 AniList 用户账号，不代表 AniList 官方客户端。豆瓣当前没有适合本地桌面应用稳定使用的授权公开 API，因此 Genzo 不抓取豆瓣网页，也不调用未公开移动端接口。

## 识别架构参考核对

v0.4 的 WebDAV XML 解析使用 `quick-xml 0.42`（MIT），路径解码使用 `percent-encoding 2`（MIT OR Apache-2.0），与项目 GPLv3 兼容。凭据通过既有 `windows` crate 调用 Windows Credential Manager；HTTP 传输复用 `reqwest`，没有引入或复制 Alist 的源码、商标或网盘专有接口。

- `Rapptz/anitomy-rs` 为 MPL-2.0，但没有适合本项目锁定的稳定 crates.io 发布；本项目改用同为 MPL-2.0、仍在维护的 `anitomy-ng 1.0.10`，没有复制其品牌资产。
- 用户提供的 `bangumi/api-client-rs` 地址当前不可用，因此保留已经通过真实 API 契约测试的 `reqwest` Bangumi 客户端，不假装使用不存在的 SDK。
- `jwalk 0.9.0` 已由维护者标记为 deprecated；现有 `walkdir` 扫描器已有重复扫描、缺失标记和目录重加测试，本轮不为依赖清单而替换稳定实现。
- Jellyfin Bangumi 插件与 Stump 仅用于核对候选加权、分层和缓存思路；本轮没有复制其代码。Genzo 的中文预处理、评分、聚合和迁移为独立实现。
