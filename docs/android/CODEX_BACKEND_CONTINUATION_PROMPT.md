# Genzo 安卓后端接口续作 Prompt

请从现有 Genzo 安卓独立工作树继续实现剩余的后端接口和端到端验证。你看不到此前对话，以下是当前有效决策与交接事实；先核对仓库，再开始修改。不要只回复计划，按可验证的小阶段实际完成工作。

## 项目与工作区

- 项目：`H:\二次元阅读器`，产品 Genzo。Windows 已发布基线为 `v0.5.0`；安卓在其基础上独立开发，技术栈 Tauri 2、React / TypeScript、Rust、SQLite、Kotlin。
- 安卓工作树：`H:\二次元阅读器\.tmp\android-first`，分支 `codex/android-first`。交接核对时 HEAD 为 `bbe6afa`（OpenDesign 最近一轮个人设置页面），工作区干净；安卓后端主体提交 `3b754ca` 已接入播放、WebDAV 与后端事件，实时日历缓存提交 `140022f` 在其历史中。后续 OpenDesign 已继续提交多轮页面更新，因此以上仅作核对起点，须以当前代码和 Git 状态为准。
- 主工作目录 `H:\二次元阅读器` 的 `main` 在交接时有未提交的 Windows / OpenDesign 页面、文档和草稿，并领先远端数个提交。**只在安卓工作树续作；不得切换主目录、覆盖、清理、重置、合并或提交主目录现有修改。**每次开工重新检查两个工作区状态。
- 用户当前希望在电脑 Android 虚拟机继续，不要把 APK 安装到一加 15 或操作实物手机。已知模拟器 `Genzo_Pixel9_API36` / `emulator-5554`，Android API 36、x86_64。Android SDK、构建和缓存主要在 `D:\DevTools\Android`，项目代码保留 H 盘；开始前复核工具链和设备。

## 必须先读并遵守

依次完整阅读根目录 `AGENTS.md`、`AI_HANDOFF.md`、`PROJECT_CONTEXT.md`、`ROADMAP.md`、`DESIGN_DIRECTION.md`，再阅读 `docs/android/BRIDGE_CONTRACT_V1.md`、`BACKEND_INTEGRATION.md`、`CODEX_RESPONSE.md`、`FRONTEND_PREVIEW.md`、`VALIDATION.md`、`SAF_INDEX.md`、`PLAYER_EVALUATION.md`，以及 `design/open-design/android-v1/CODEX_HANDOFF.md`、`CAPABILITY_MAP.md`、`UPSTREAM_BACKEND_CAPABILITY_MATRIX.md` 和相关 React / Rust / Kotlin 实现。

旧文件 `docs/android/CODEX_BACKEND_PROMPT.md` 是更早阶段留下的提示，仍含过期的“播放控制、字幕、WebDAV、事件尚未实现”“category 缺失”与等待用户选择等判断；保留原件，但**不得照它重复开发或按其待确认问题阻塞工作**。当前实际状态以代码及 `BACKEND_INTEGRATION.md` 为准。

## 产品范围与已确认决策

- 安卓首版重点为动漫、电影、电视剧的视频媒体管理和应用内播放。复用 PC 已有领域模型、数据库能力、刮削、纠错、WebDAV 协议和作品整理；保留 Windows 既有行为。漫画 / 轻小说阅读、网盘账号 / 官方 API 直连、后台播放、PiP、DRM 不在本阶段范围。
- 本地媒体使用 Android SAF 持久只读授权与文档 URI，不把 URI 转成 Windows 盘符路径、不申请全盘管理权限。扫描只枚举文件元数据，不为扫描 / 刮削下载完整视频。来源离线、撤权或连接失败时保留索引、作品关联和个人记录；不修改或删除真实媒体文件。
- 用户提供的 WebDAV 服务用于媒体来源接入。它与“用 WebDAV 同步跨设备观看记录 / 收藏 / 备份”是两个产品能力；目前 OpenDesign 的个人页 / 同步设置有预览状态，不能把其按钮、表单或占位文案当成已确认的云同步后端需求。不要把 Windows 挂载目录描述成安卓网盘直连。
- 用户确认优先复用 PC 能力，不更新或引入 `bangumi-data` 快照。本周播出日历已按此前确认使用 Bangumi 实时 `/calendar` 并保留 SQLite 离线缓存；历史季度概览沿用 PC 既有实现 / 内置索引，不得拿当前日历伪造历史季度结果。
- 正式界面由 OpenDesign 负责，按已确认设计实施。后端工作可补齐已有页面调用的真实数据与状态，不擅自改正式页面布局；若设计页面仍标注预览 / 待接入，应如实保留或提交明确方案。

## 已实现并已有验证，不要重复造轮子

`docs/android/BACKEND_INTEGRATION.md` 记录了 2026-10-06 的具体实现、命令、限制和 QA 结果。至少先检查以下事实：

- 已复用 PC 命令实现本地视频 SAF 来源、扫描任务、索引、待整理、作品和个人记录；`work_category.rs` 已派生 `category`，没有新增分类列。
- `control_internal_player`、`pick_external_subtitle`、`list_subtitle_candidates` 已接 LibVLC 原生 Activity；支持会话校验、播放 / 暂停 / seek / 倍速 / 音轨与字幕轨 / 字幕偏移 / 方向 / 关闭、外挂字幕授权以及多候选人工选择。远程原流通过 Rust 内部 Range 代理播放，不做完整视频下载兜底或转码。
- WebDAV 媒体来源添加、浏览、凭据更新、扫描和原流鉴权 / Range 播放已实现；凭据进入安卓安全存储，不返回 React。合成 Basic Auth 服务已覆盖成功、401、服务器不支持 Range、断线 / 恢复等场景。
- 四类事件已接入：`android-source-state`、`scan-task-updated`、`recognition-updated`、`player-state`。已支持多来源 SAF 目录定位原型，事件和快照恢复规则见桥接契约。扫描 1 秒轮询仍保留，因为大库、取消竞态和前后台生命周期尚未完整验收。
- 稳定 `mediaFileId` 的 SQLite 观看进度 / 续播、收藏和笔记已接；来源离线不清除这些数据。Android 每 5 秒及状态变化保存播放进度。
- 安卓 `get_weekly_calendar` 使用实时 `/calendar` + SQLite 六小时缓存；季度历史数据仍有旧快照缺口。
- 合成样本在模拟器上验证 MP4/H.264、MKV/H.265、SRT / ASS / SSA 基础字幕、双音轨、字幕选择 / 偏移、播放拖动、WebDAV 鉴权 / Range 和断线恢复。字体附件、复杂 ASS 特效、4K / 10-bit / HDR、音频透传等均未验，禁止扩大兼容承诺。

## 续作目标：先找实际缺口，再实现

1. 对照**当前** `src/android/*`、`src/android/api.ts`、`src/api.ts`、`src-tauri/src/commands.rs`、相关 Android Rust 模块、Kotlin 插件 / Activity、迁移和测试，制作“页面操作 → invoke / event → Rust / Kotlin → SQLite / 外部来源”的差异清单。逐条区分已实现、未实现、仅 UI 预览和无法验收；不能把旧能力矩阵或静态设计数据当作代码事实。
2. 优先完成安卓首版范围内可复用 PC 能力的真实闭环：SAF 权限撤销 / 恢复、来源离线与 WebDAV 凭据失效的状态区分和恢复；实际媒体文件扫描后识别、候选确认、人工纠错、刷新资料及错误恢复；播放中断与扫描任务重试 / 取消 / 回前台快照。所有 QA 只用 `D:\DevTools\Android\Samples\GenzoPrototype` 下合成样本或明确标记的测试 fixture，不读取真实媒体目录，不使用真实用户账号。
3. 对照最新 OpenDesign 页面，找出已画出但仍是 mock / 固定值的后端入口并如实处理。例如浏览记录移除 / 清空目前提示“接口待接入”，阅读统计中的章节 / 页数是占位零值，同步与 WebDAV 云同步页标注“待后端接入”。先查 PC 是否已有可直接复用的领域命令；不要仅因 UI 存在就新增云同步、统计、删除历史记录或数据库结构。清除观看记录会影响个人数据，只能遵循项目已有明确语义；若现有数据模型无法安全表达，先提交具体接口 / 数据保留方案，不擅自写迁移。
4. WebDAV **媒体来源**表单和错误补救路径需结合最新 OpenDesign 页面检查。若当前只有个人页里的云同步 WebDAV 预览，不能将其接成媒体来源或冒充已实现同步。先盘点设计已交付的来源页面；没有正式设计时补后端适配、契约和状态，不自行造新视觉页面。
5. 用户尚未批准修改共享 DTO / 数据库结构。`Work` / `WorkListItem` 目前没有确认的独立作者、作品 `sourceScope`、真实最近浏览时间字段。前端把 `category ?? type`、`sourceScope ?? local` 或 `updatedAt` 回退仅是当前呈现，不能当真实数据。先复用 PC 已有事实；确需增加字段时，先完成只读影响分析并给出字段来源、语义、迁移兼容、旧数据回填和 Windows 影响的具体方案，等待用户明确批准后再扩展。不要添加虚假默认值或“看起来能用”的推断。

## 接口与安全不变量

- `BRIDGE_CONTRACT_V1.md` 是冻结接口名的起点，但“冻结不等于实现”。先对照代码确认。React 统一 Tauri `invoke` / `listen`，继续复用 `src/api.ts` 和共享 DTO；不新增 `GenzoNative.call`、独立 HTTP 业务服务或绕过 PC 领域逻辑的第二套模型。
- 鉴权凭据、SAF URI、内部代理 URL 不暴露给 React 或日志。页面只传稳定 ID；错误使用明确的状态 / code / retryable；失效事件不得把 `range_unsupported` 误判成来源离线。事件用单调 revision 丢弃旧事件，监听后与返回前台都先读取快照，持久数据库状态优先于事件。
- 用户拒绝权限、来源 offline、credential invalid、扫描失败 / 取消、候选待确认、subtitle_error、decoder 不支持、Range 不支持等状态互相区分，提供真实可操作的重试 / 重授权 / 改凭据 / 人工选字幕路径。失败不得静默删除索引或个人记录。
- 无损播放表示播放原始文件 / 码流、不重新压缩或转码；不得承诺所有容器 / codec、HDR、音频输出或字幕特效完全兼容。网盘账号直连如成为必要，先由用户指定具体网盘并确认范围。

## 环境、验证与交付

- 开始先核对分支、Git 状态、AGENTS 与上述文档、实际 SDK / JDK / NDK / Rust / Cargo / Gradle 路径、ADB 目标。不要沿用过期 APK 作为验证结果。
- 代码保留在 H 盘；新增工具、构建产物、缓存、QA 输出放 D 盘。仅使用 `emulator-5554` 验证，不安装或启动到一加 15。模拟器 / APK 操作前核对包名、ABI、产物时间和哈希；若构建日志显示成功但 APK 没更新，依现有脚本 / `FRONTEND_PREVIEW.md` 核对 Gradle native-lib 打包缓存。
- 按风险运行相应检查：`npm run check`、`npm test`、相关 Rust 测试，以及 `node .\scripts\verify-android-backend.mjs` / `node .\scripts\verify-android-subtitles.mjs`。先检查脚本的设备限制、QA 数据与副作用；只操作自己的 QA 来源，不删除其索引 / 观看记录或用户数据。若运行不了，记录确切命令、原因和未验边界。
- 真正改动后按 `AGENTS.md` 更新 `docs/android/BACKEND_INTEGRATION.md`、接口契约（只有确有变化才更新）、`AI_HANDOFF.md` 和必要路线文档。分阶段做清晰的原子 Conventional Commit；不得创建发布版本 / 标签、推送或触碰 Windows 主工作树。
- 最终交付应说明：完成的具体接口和页面操作、提交、验证命令及结果、模拟器 APK 的绝对路径 / SHA256、仍未实现或未验证的范围。没有实际真机验收就明确写仅在 x86_64 API 36 模拟器验证。

请现在从工作树与代码审查开始。先报告当前 branch/status、已实现与真实剩余接口清单和实施顺序，然后持续推进不依赖用户确认的部分；只有遇到新增共享字段 / 迁移、扩大为账号直连或其他超出授权范围的决定时，才带着具体方案询问用户。
