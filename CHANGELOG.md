# Changelog

Genzo 的重要变更记录在此文件中。格式参考 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

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

[Unreleased]: https://github.com/Boringchen-10/genzo/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/Boringchen-10/genzo/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Boringchen-10/genzo/releases/tag/v0.2.0
