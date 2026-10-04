# 安卓兼容性初步审查：Windows v0.5.0 基线

审查日期：2026-10-04。只输出审查，不初始化 Android 工程、不修改功能、不承诺已通过交叉编译 / 真机验收。

## 固定基线

- Windows 正式源码：带注释标签 `v0.5.0`，提交 `81b41d1ddb076cad784a9eb909fc147b2f3db538`。
- [GitHub Release](https://github.com/Boringchen-10/genzo/releases/tag/v0.5.0)，安装器及 SHA-256 / 构建清单可公开下载。后续文档提交不移动标签。
- Windows 继续以媒体管理与外部工具调度为主。用户提出手机界面自行重编排、可能不调用外部应用；若安卓需要实际阅读 / 播放，应另外确定内置功能范围，不能把现有书架当成已完成阅读后端。
- 当前 `lib.rs` 有 `mobile_entry_point` 条件入口，但尚无 `src-tauri/gen/android`，本机仅安装 `x86_64-pc-windows-msvc` Rust target。没有执行 Android SDK / NDK 初始化或构建；入口声明不等于移动端已支持。

## 可复用模块

| 模块 | 代码位置 | 复用条件 |
| --- | --- | --- |
| 领域与 IPC 契约 | `src/types.ts`、`src/api.ts`、`src-tauri/src/models.rs` | 作品 / 文件 / 来源分离、个人评分、收藏、卷册状态与排序继续复用；系统能力不能用假成功替代。 |
| 前端状态与导航 | `store.ts`、`App.tsx`、`useSessionState.ts`、书架 / 收藏 / 探索页面 | 筛选和历史规则可复用；手机重编排视觉，系统返回、进程重建与触摸排序另测。 |
| 识别与匹配 | `anime_parser.rs`、`grouping.rs`、`bookshelf.rs`、`book_scrape.rs`、`film_tv.rs`、`tmdb_artwork.rs` | 标题 / 季集 / 卷号、候选评分、确认与锁定逻辑可复用；文件定位和访问从平台边界进入。 |
| 元数据与图片 | `bangumi.rs`、`metadata_aggregator.rs`、`providers/`、`comic_explore.rs`、`comic_cover_cache.rs` | 主源身份、缓存、过期回退、图片校验沿用；测试 Android 网络 / WebView / 资产 URL、内存和缓存配额。漫画目录仍只有作品资料。 |
| 数据库 | `db.rs`、`migration_compat.rs`、`migrations/0001..0024`、个人记录 / 纠错模块 | SQLx / SQLite 事务与迁移是复用目标，必须通过目标平台编译及存量样本升级。移动数据库放应用私有目录。 |
| 协议与档案解析 | `webdav.rs`、`remote_transfer.rs`、`book_metadata.rs` | WebDAV XML / Range / 缓存和 OPF / ComicInfo 解析可复用；本地文件句柄、凭据与后台生命周期需适配。 |

以上为代码审查判断，复用比例不能当成 Android 编译成功率。

## Windows 专用部分

| 部分 | 现有实现 / 风险 | 安卓适配点 |
| --- | --- | --- |
| 凭据 | `credentials.rs` 用 CredWrite / CredRead，非 Windows 分支明确报不支持。 | 原生 Keystore 保护加密密钥，凭据密文存私有目录；不照搬 Windows 凭据项、不把密码写成普通 SQLite 字段。 |
| 播放与启动 | `launcher.rs` 的 ShellExecuteW、桌面进程参数、`potplayer.rs` / `playback.rs` 的窗口与 IPC。 | 若用外部应用需 Intent + MIME + URI 授权；若内置播放需独立确定播放器 / 位置回报接口。PotPlayer 记录表可参考，Windows 采样不能复用。 |
| 视频缩略图 | `thumbnail.rs` 的 Windows Shell / COM；挂载盘提取策略依赖 Windows。 | 原生视频元数据 / 缩略图适配或明确占位；不为移动端自动下载远程视频。 |
| 路径 / 扫描 | `scanner.rs`、`media_mapping.rs` 等用 Path / read_dir、盘符、UNC、Windows 隐藏属性与挂载探测。 | 通过 SAF 文档 ID / URI 枚举并保留大小写，不把 `content://` 伪装成可直接打开的磁盘路径。 |
| 桌面窗口 | `window_style.rs` 的 DWM / Snap / Mica，`WindowTitleBar.tsx` 的自定义标题栏与窗口命令，配置最小 1024×640。 | 条件化桌面窗口能力；手机安全区、系统返回、键盘、方向变化和触摸交互由手机界面设计覆盖。 |
| 工具与安装 | Windows `.exe` 检测、游戏启动项、NSIS、WebView2 与系统 DLL。 | 不能复制为安卓启动 / 安装逻辑；独立 Android manifest、ABI、签名与 APK / AAB。只保留游戏资料不意味着可执行 Windows 游戏。 |

## 文件访问：首要适配点

桌面扫描根目录字符串并递归读 Path；安卓共享存储通常由 Storage Access Framework 返回文档 URI。应分别保留“来源 / 文档标识”和“当前授权 / 可读句柄”，由原生桥接提供目录枚举、流读取及失效提示。当前 Tauri dialog 官方文档明确 Android 不支持 folder picker，不能直接复用桌面 `open({directory: true})`。[Tauri Dialog](https://v2.tauri.app/plugin/dialog/)

用户选择目录树后，需要保存系统授予的持久 URI 权限，并验证重启、SD 卡、撤回授权和文件移动后的行为。Android 11+ 对可选根目录有额外限制；不要把申请全盘访问作为默认替代。`File::open(path)` 和 `ZipArchive<File>` 对内容 URI不能直接工作：先评估可 seek 文件描述符或受限临时缓存，再沿用现有 ZIP 解析。扫描不得顺便改写原文件。[Android 文档访问与持久授权](https://developer.android.com/training/data-storage/shared/documents-files)

Windows 盘符 / UNC 不可迁移为手机路径。未来导入个人数据应明确重新定位来源 / 文件；缓存路径也需重映射，不直接搬运 `covers` 的绝对路径。当前没有自动跨设备同步或完整导出向导。

## 凭据、播放与生命周期

Keystore 保护的是密钥，不是直接存储任意密码；建议原生加密 / 解密边界，并测试设备锁定、重装、备份恢复和密钥失效。现有 TMDB Token 存本机设置，移动端是否迁移至凭据存储需另行决定，不宣称现版本已加密全部设置。[Android Keystore](https://developer.android.com/privacy-and-security/keystore)

如果使用外部播放 / 阅读，只授予所需文件 URI 读取权限；如果按用户方向改为内置消费，需要分别确定漫画首批格式、EPUB 渲染或视频播放范围，以及位置 / 已读的保存时机。当前 Windows 书架只保存人工阅读状态，打开不代表已读，也不能自动获取外部阅读器页码。

远程 Range 转发目前是 Rust 内 `127.0.0.1` 临时服务，生命周期依赖 Genzo 进程；安卓切到外部应用、锁屏或系统回收后不能默认持续可用。检查服务存活、缓存保护、取消 / 续传、后台限制与短期地址；优先完成前台闭环，再决定是否需要后台服务。图片并发和原图解码也需在手机内存预算下验证。

Tauri 可由 Rust 共享逻辑调用 Kotlin 原生插件，应只在文件访问、凭据和播放等实际需要处建立边界，不为本轮审查引入空框架。[Tauri 移动插件](https://v2.tauri.app/develop/plugins/develop-mobile/)

## 数据基线与验证顺序

1. **固定源码与环境**：从 v0.5.0 创建后续安卓工作分支，记录 Node / pnpm / Rust / JDK / SDK / NDK / ABI；最小 Android arm64 包先证明启动、IPC 和应用目录可用。确认原生库 16 KB 页对齐，特别是 Rust / SQLite 等 `.so`。[Android 页大小兼容](https://developer.android.com/guide/practices/page-sizes)
2. **私有数据库**：空库、历史 v0.4.4 样本、0008 缺视图样本、早期 0016 已知变体均升级并重开；核对收藏、评分、笔记、观看 / 阅读状态、排序与原账本。历史 SQL 文件不修改，任何移动字段新增迁移。跨平台构建另核对 LF / CRLF 对迁移校验和的影响，当前兼容放行只针对已知 0016，不任意放行其他版本。
3. **最小文件闭环**：选择一个 EPUB / CBZ，再选择目录树；列出文件、读取内嵌封面、建立作品、退出 / 重启后重新打开，测试撤权和不存在的文档。原文件保持不变，权限失败不清库。
4. **离线资料与图片**：Bangumi / TMDB 可选设置、失败回退、封面重复下载和淘汰；手机 DPR、图片资产 URL 和内存峰值。漫画目录变动不得破坏已有个人资料。
5. **凭据 / 远程文件**：完成 Keystore 后再验 WebDAV 保存与重启连接、Range、缓存续传 / 离线打开、容量上限；不要仅凭临时连接成功宣布持久来源可用。
6. **阅读 / 播放范围**：依据另行确认的首批格式做一个可用流程，验证位置保存、暂停、退出、恢复和 URI 授权，避免一次声称支持全部桌面格式。
7. **手机交互 / 生命周期**：手机新布局、系统返回、触摸多选 / 排序、键盘、安全区、旋转、锁屏、进程回收及重开；再扩展设备 / API 级别和后台服务。
8. **发布与回归**：Android 独立签名 / 产物 / 设备验证；每次共享模型、SQL 或识别修改同时运行 Windows 回归，不移动 v0.5.0 标签。

手机首版范围、最低 API 级别和内部播放器 / 阅读器选择均尚未确认。以上顺序是建议，当前成果为审查文档。
