# Genzo

Genzo 是一个 Windows 优先、轻量化、本地优先的 ACGN 统一媒体库。v0.2 用于扫描和整理用户自己的本地动漫、漫画、小说、游戏及其他文件，并为动漫提供可确认的 Bangumi 元数据匹配。

本项目不提供盗版资源搜索或内置播放器。v0.4 支持访问、播放及缓存用户自行配置且有权访问的 WebDAV 文件。删除作品或本地扫描目录配置只会修改 SQLite 记录，不会删除、移动或修改原始媒体文件。

## v0.4 远程存储（开发版本）

进入 **媒体库 → 媒体源 → 添加 WebDAV**，填写服务地址、账号和应用密码，测试连接后选择目录并扫描。扫描结果出现在“待整理”，继续使用现有识别、匹配与作品详情流程。

- Alist 可填写其 WebDAV 服务地址（例如 `http://127.0.0.1:5244/dav/`，以实际配置为准），目录相对于该地址填写。这不需要 RaiDrive，也不是直接登录夸克。
- 已通过 RaiDrive、rclone 或 Windows 映射的目录，仍用“添加目录”，勾选“系统挂载目录”；已有来源也可切换此选项。
- 已配置的 mpv、VLC、PotPlayer 或 MPC 系列播放器，在服务器支持 Range 时通过本机转发直接播放。系统默认打开或其他工具先缓存；直接播放出现播放器兼容问题时，可手动点击“缓存”后再打开。
- “缓存”用于临时文件；“保留离线”把文件下载至应用数据目录的 `remote-cache` 并排除自动清理。媒体源页显示传输大小、重试、打开缓存目录和清理操作。两者均计入容量上限（默认 20 GiB）。
- 自动清理优先删除最久未使用的临时缓存；最近交给播放器的缓存保护 12 小时，避免使用中被删除。应用重启后解除这段临时保护。没有足够可清理空间时提示调整容量。
- 网络中断后可重试。服务提供可靠 ETag 或 Last-Modified 且支持 Range/If-Range 时续传，否则重新下载。远程暂时不可用不会清空媒体库，完整缓存可离线打开。
- 密码保存在 Windows 凭据管理器，不出现在数据库和播放器参数中。停用 WebDAV 来源保留索引和缓存；凭据失效时可通过“更新凭据”重新验证保存。

首版使用标准 WebDAV 的 Basic 认证与 UTF-8 XML 目录响应，建议 HTTPS。目录浏览不自动跟随重定向，需要填写最终服务地址。原生 SMB、各网盘专有登录、远程游戏执行、跨设备同步不在本版范围。外挂字幕可扫描关联，当前远程播放不自动转发外挂字幕，可下载后由播放器手动加载。

验证使用隔离的本机 WebDAV 服务与临时数据库，覆盖扫描、断线、Range 转发、缓存回退、续传、容量保护及三种 Windows 窗口尺寸；真实 Alist/网盘服务兼容性仍需用用户配置验收。当前代码版本号已准备为 0.4.0，尚未创建正式发布标签。

## v0.2 功能

- 多扫描目录、目录类型、启停、重复扫描、错误记录与缺失标记。
- 待整理内容按扫描根目录下的作品文件夹聚合，嵌套季目录不会展开成大量独立行；每次最多渲染 100 项。
- 删除目录配置后重新添加同一路径会复用已有媒体记录，不重复导入，也不会触发路径唯一约束错误。
- 作品和本地文件分离，支持手动创建、编辑、标签、状态、收藏、评分、备注和本地封面缓存。
- 海报网格与列表视图，支持标题搜索、类型/收藏/标签筛选及排序。
- 外部工具检测与自定义配置，支持 `{file}`、`{folder}`、`{title}` 参数模板。
- 默认工具、临时指定工具、Windows 默认程序和游戏启动项。
- 浅色、深色及跟随系统主题。
- 作品文件夹级动漫识别：优先从代表文件提取标题，纯集数文件回退到上层作品目录，并按作品组请求 Bangumi。
- 视频集数与外挂字幕关联，支持视频和字幕分别存放在同一作品目录的不同子目录。
- 可解释置信度：80% 以上且无歧义才自动匹配，60% 至 80% 等待确认，低于 60% 保持未匹配。
- 内置 `bangumi-data 0.3.132` 中/日/英标题索引、全年动画分页和周一至周日放送时间表。
- Bangumi 主源锚定；TMDB 可补全高清海报/背景图，AniList 可补全国际评分和标签，补源均须通过 85% 标题与年份校验。
- 搜索与聚合采用 100 项内存 LRU + SQLite 持久缓存；保存作品时同步缓存 Bangumi 分集标题。

联网元数据不可用时，扫描、手动整理、媒体库浏览和外部工具启动仍可正常工作。v0.2 只支持动漫元数据；漫画、小说和游戏 Provider 留待后续版本。豆瓣因没有适合本应用的稳定授权公开 API，目前明确显示为不可用，不抓取网页。

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

Rust 测试覆盖文件分类、自然排序、参数模板、迁移约束、重复扫描去重、文件缺失标记、作品目录查询、动漫文件名解析、字幕映射、候选评分、Bangumi 数据映射和字段锁定。

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

Bangumi 搜索结果缓存 7 天，作品详情与多源聚合缓存 30 天。封面只接受 Bangumi、TMDB 与 AniList 的受信任 HTTPS 图片域名，解码验证后写入本地缓存，并生成缩略图；API 失败不会阻断本地扫描。

TMDB 是可选补源，需要 Read Access Token。当前设置界面尚未由 Open Design 接入该字段时，可在启动 Genzo 的终端中临时设置环境变量：

```powershell
$env:TMDB_READ_TOKEN='你的 TMDB Read Access Token'
pnpm tauri dev
```

也可以通过既有 `set_setting` 契约保存键 `metadata.tmdb_read_token`。Token 不随媒体库数据发送给 Bangumi、AniList 或豆瓣。

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
