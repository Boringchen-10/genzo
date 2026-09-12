# Changelog

Genzo 的重要变更记录在此文件中。格式参考 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

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

[Unreleased]: https://github.com/Boringchen-10/genzo/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/Boringchen-10/genzo/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Boringchen-10/genzo/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Boringchen-10/genzo/releases/tag/v0.2.0
