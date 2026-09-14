# Changelog

Genzo 的重要变更记录在此文件中。格式参考 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

## [0.3.0] - 2026-09-14

### Added

- 将 Open Design v1.1.1 纳入仓库并确认为正式界面规范和设计 Token 基线。
- 新增探索与收藏页面；探索中的网络能力保持禁用并明确标注 `Future`。
- 新增统一 Modal/Drawer 焦点管理，支持焦点陷阱、Esc 关闭和焦点返回。

### Changed

- 正式前端迁移到 v1.1.1 的窄侧栏、连续背景首页、作品切换条、书架、媒体库双 Tab 和设置 Drawer。
- 扫描目录整合到媒体库“媒体源”，待整理内容改为独立作品组视图，不再与作品列表上下竞争。
- 深浅主题改用中性灰绿 Token，标题栏在首页背景上使用半透明材质，并提供稳定不透明降级。

### Fixed

- 切换路由时主内容回到页面顶部，避免媒体库从旧滚动位置打开。
- 修复 1024 宽度探索页因长 tooltip 产生的内部横向滚动。
- 补充站点图标，消除 Tauri 调试端点的 `/favicon.ico` 404。

## [0.2.4] - 2026-09-14

### Changed

- 动漫批量识别改为按作品目录组执行，同一作品只生成一次 Bangumi 查询。
- 识别查询综合代表文件、作品目录、季度和年份；纯集数文件不再因缺少标题而直接失败。

### Added

- 持久化视频集数与外挂字幕关联，并在作品详情中显示集数和字幕数量。

### Fixed

- 首次扫描根目录中的散装视频会即时按解析标题拆组，不再等待识别后才分开。
- 首页“继续观看”卡片保持稳定宽度，宽屏通过增加列数利用空间。

## [0.2.3] - 2026-09-12

### Changed

- 待整理内容中的漫画多层目录先显示大类，可进入下一层查看具体目录。
- 视频目录中的字幕文件会与对应作品一起整理。

### Fixed

- `.ass`、`.ssa`、`.srt` 等字幕文件不再作为独立散文件显示。
- 多层漫画目录不再被错误聚合成一个超大文件夹。

## [0.2.2] - 2026-09-12

### Changed

- 首页作品背景改为连续渐隐，并限制媒体卡片尺寸，宽屏通过增加列数利用空间。
- 待整理内容支持按识别状态、标题和文件数量排序，默认优先展示等待确认与识别失败项目。

### Fixed

- 多层漫画合集按最深层图片目录拆分，独立漫画压缩包和文档不再被顶层合集目录合并。

## [0.2.1] - 2026-09-11

### Fixed

- 直接选择动漫文件夹扫描时，同一作品的多集文件会按解析标题聚合。
- 扫描大目录时，不同作品的散装视频和文档不再被错误合并识别。

## [0.2.0] - 2026-09-11

### Added

- Windows 优先的 Tauri 2、React、TypeScript、Rust 和 SQLite 本地媒体库基础架构。
- 本地目录扫描、作品整理、媒体库搜索筛选与外部工具启动流程。
- 动漫文件名离线解析、Bangumi 候选搜索、置信度分级、元数据缓存和用户字段锁定。
- 深浅主题、无边框窗口与常用 Windows 窗口尺寸的视觉和端到端检查。

### Changed

- 产品正式名称统一为 Genzo。
- 项目许可证统一为 GNU GPL v3.0 only。

[Unreleased]: https://github.com/Boringchen-10/genzo/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Boringchen-10/genzo/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/Boringchen-10/genzo/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Boringchen-10/genzo/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Boringchen-10/genzo/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Boringchen-10/genzo/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Boringchen-10/genzo/releases/tag/v0.2.0
