# Genzo

Genzo 是一个 Windows 优先、轻量化、本地优先的 ACGN 统一媒体库。v0.2 用于扫描和整理用户自己的本地动漫、漫画、小说、游戏及其他文件，并为动漫提供可确认的 Bangumi 元数据匹配。

本项目不提供媒体下载、串流、盗版资源搜索或内置播放器。删除作品或扫描目录配置只会修改 SQLite 记录，不会删除、移动或修改本地媒体文件。

## v0.2 功能

- 多扫描目录、目录类型、启停、重复扫描、错误记录与缺失标记。
- 待整理内容按扫描根目录下的作品文件夹聚合，嵌套季目录不会展开成大量独立行；每次最多渲染 100 项。
- 删除目录配置后重新添加同一路径会复用已有媒体记录，不重复导入，也不会触发路径唯一约束错误。
- 作品和本地文件分离，支持手动创建、编辑、标签、状态、收藏、评分、备注和本地封面缓存。
- 海报网格与列表视图，支持标题搜索、类型/收藏/标签筛选及排序。
- 外部工具检测与自定义配置，支持 `{file}`、`{folder}`、`{title}` 参数模板。
- 默认工具、临时指定工具、Windows 默认程序和游戏启动项。
- 浅色、深色及跟随系统主题。
- 动漫文件名离线解析、标题标准化及 Bangumi 官方 API 候选搜索。
- 可解释置信度：90% 以上且无歧义才自动匹配，65% 至 90% 等待确认，低于 65% 保持未匹配。
- 搜索与详情 SQLite 缓存、Bangumi 外部 ID、候选取消/重搜和用户字段锁定。

联网元数据不可用时，扫描、手动整理、媒体库浏览和外部工具启动仍可正常工作。v0.2 只支持动漫元数据；电影、漫画、小说和游戏 Provider 留待后续版本。

界面使用“动漫”作为视频类媒体名称；数据库和 Tauri command 中继续使用稳定的兼容键 `video`，不会因此迁移或覆盖已有数据。

## 技术栈

Tauri 2、React、TypeScript、Vite、Rust、SQLite、SQLx、Zustand、React Router、Tailwind CSS 和 Lucide。

前端不直接访问数据库或文件系统。数据库、扫描、封面缓存及进程启动均由 Tauri commands 完成；目录选择使用 Tauri 官方对话框插件。

## 开发环境

- Windows 10 或 Windows 11
- Node.js 22 或更高版本
- pnpm 11
- Rust stable MSVC 工具链
- Visual Studio 2022 Build Tools，包含“使用 C++ 的桌面开发”和 Windows SDK
- Microsoft Edge WebView2 Runtime

安装依赖并启动：

```powershell
pnpm install
pnpm tauri dev
```

本仓库不会启动独立 HTTP 后端。开发时 Vite 仅为 WebView 提供前端热更新；应用数据和所有系统操作仍在本地 Tauri 进程内。

## 检查与测试

```powershell
pnpm check
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Rust 测试覆盖文件分类、自然排序、参数模板、迁移约束、重复扫描去重、文件缺失标记、动漫文件名解析、候选评分、Bangumi 数据映射和字段锁定。

生产页面视觉检查（需要先运行 `pnpm preview --host 127.0.0.1 --port 4175`）：

```powershell
node scripts/capture-theme-preview.mjs
```

视觉脚本使用隔离的 API mock，不读写正式数据库，覆盖首页、媒体库、详情、扫描目录、工具管理和设置页，并检查 1024×640、1366×768、1920×1080 及浅色/深色主题。

视觉与端到端测试使用隔离的应用标识和测试数据库。在一个终端启动测试版本，在另一个终端运行脚本：

```powershell
pnpm dev:e2e
pnpm test:e2e
```

脚本会在被忽略的 `.e2e-media` 中创建专用样本，并将截图写入 `artifacts/screenshots`。它验证 1366×768、1920×1080 和最低 1024×640 布局，不会访问用户的媒体目录。

## 构建

生成 Windows 可执行文件但不打包安装器：

```powershell
pnpm tauri build --no-bundle
```

产物位于 `src-tauri/target/release/genzo.exe`。v0.2 暂不包含自动更新或第三方工具安装器。

## 本地数据

默认数据目录：`%APPDATA%\com.genzo.desktop`

- 数据库：`genzo.db`
- 封面缓存：`covers\`
- WebView 运行数据由 WebView2 存放在对应本地应用数据目录

SQLite 采用迁移和 WAL 模式。初始化或迁移失败会中止启动并返回明确错误，不会静默重建数据库。

Bangumi 搜索结果缓存 7 天，作品详情缓存 30 天。封面仅接受 `https://lain.bgm.tv` 或 `https://bgm.tv`，下载到本地封面缓存；API 超时为 12 秒。

## 目录结构

```text
src/                         React 前端
src-tauri/src/               Rust commands、扫描、数据库和启动逻辑
src-tauri/migrations/        SQLite 迁移
src-tauri/capabilities/      Tauri 权限
src-tauri/icons/             原创应用图标及平台尺寸
scripts/e2e-visual.mjs       隔离端到端与视觉检查
```

第三方依赖及许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。产品范围和长期决策分别以 `PROJECT_CONTEXT.md` 与 `ROADMAP.md` 为准。

Genzo 采用 GNU GPL v3.0，完整条款见 [LICENSE](LICENSE)。

## 版本管理

项目使用 Git、Conventional Commits 和 Semantic Versioning 管理变更。功能更新与 Bug 修复在验证后形成独立提交；正式发布同步更新前端、Tauri 和 Rust 包版本，维护 [CHANGELOG.md](CHANGELOG.md)，并创建 `vX.Y.Z` 标签。

完整提交与发布流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
