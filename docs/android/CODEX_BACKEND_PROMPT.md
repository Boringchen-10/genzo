# 给 Codex 的任务提示：安卓端后端功能接入

> 可直接整段复制发给 Codex。工作树：`H:\二次元阅读器\.tmp\android-first`，分支 `codex/android-first`。

---

你是 Genzo 安卓端的原生 / 后端开发 Agent。安卓 React 前端（`src/android/*`）已完成多轮 UI 迭代并在模拟器 `emulator-5554` 上逐轮重建安装、验收、提交；**现在缺的是你这一侧的后端能力**。请按本文件把前端已经声明、但 Rust / Kotlin 侧尚未实现的命令、事件与字段补齐。

## 0. 目标

让以下四条链路从「前端已接好、后端为空 / 半成品」变成真正可用：

1. 应用内播放的**完整控制**（播放 / 暂停 / 拖动 / 倍速 / 音轨 / 字幕轨 / 字幕延迟 / 旋转 / 关闭）与**外挂字幕选择**。
2. **WebDAV 来源**的添加 / 凭据更新 / 浏览 / 扫描 / **播放鉴权与 Range**。
3. **实时事件**（来源状态、扫描任务、识别、播放器状态）替代当前 1 秒轮询；事件未接前保持快照轮询。
4. 前端已使用但后端**缺失的字段**：作品 `category`、作者、`sourceScope`（本地 / 网络）、浏览时间、多来源各自的目录 tree URI。

探索页 `weekly_calendar` 季度化为**独立子项**，需先确认方向（见 §6），不阻塞上面四条。

## 1. 开工前必须先读（本仓库内）

- `docs/android/BRIDGE_CONTRACT_V1.md` — **桥接契约 v1（冻结）**：命令名 / 参数 / DTO / 事件名 / 状态枚举 / 错误码。**以本文件为唯一命名来源，不要另造名字。**
- `docs/android/CODEX_RESPONSE.md` — 七项架构决定（WebView + React 沿用方案 A、进程内 Rust / SQLite、SAF、LibVLC、主题、统一 `invoke` / `listen`）。
- `docs/android/OPENDESIGN_HANDOFF.md` — 页面数据需求、已有共享命令、正式接口准备（尚未实现项）。
- `docs/android/PLAYER_EVALUATION.md` — 播放内核选型（LibVLC 3.7.7 / Media3 / libmpv）与结论。
- `docs/android/FRONTEND_PREVIEW.md` — 每轮前端验收记录与当前数据限制（尤其「浏览器目录 / 多来源」「本地播放」两段）。
- `src/types.ts`、`src/api.ts`、`src/playback.ts`、`src/scanTasks.ts` — 共享 DTO 与前端适配器的**唯一真源**，不要用设计演示模型当数据库模型。
- `src-tauri/src/commands.rs`、`src-tauri/src/explore.rs`、`src-tauri/src/bangumi.rs`、`src-tauri/src/scanner.rs` — 现有实现。
- `src-tauri/gen/android/app/src/main/java/com/genzo/android/PlayerActivity.kt` — 原生播放 Activity（LibVLC）。

## 2. 现状（已实现 / 已验收，不要重做）

- 架构：Tauri 2 Android WebView + React / TypeScript；进程内 Rust / SQLite，**没有**独立 HTTP 业务服务；统一 `@tauri-apps/api/core.invoke` + `listen`，没有 `GenzoNative.call` 第二套通道。
- 已接命令：`authorize_video_source`、`scan_video_source`、`get_video_source_states`、`open_internal_player`、`get_internal_player_state`；共享 `list_works` / `get_work` / `update_work` / `create_work` / `set_work_field_lock` / 来源 / 扫描任务 / 识别候选 / 纠错 / 分集 / `get_playback_progress` 等。
- 已实现：SAF 递归索引、共享扫描任务、重复扫描元数据复用、本地稳定媒体 ID 的 `open_internal_player`（`restart` / SQLite 续播已实现）、后台每 5 秒及状态变化写共享进度、原生备份最后有效样本供重启恢复。
- 已验收：真机 / 模拟器构建安装启动、Rust invoke、迁移 0025、强制停止后 DB / 缓存 / Keystore 持久化、持久 SAF、LibVLC 核心播放链路；前端多轮 UI（首页 / 媒体库 / 书架 / 发现 / 我的 / 详情 / 播放入口）已在模拟器验收。

**尚未实现（本任务范围）**：见 §3。

## 3. 本任务范围

### A. 播放器桥接命令（前端已声明，后端未接）

按 `BRIDGE_CONTRACT_V1.md` §「安卓业务命令常量」实现，名称 / 参数 / 返回**不得改动**：

| invoke 常量 | 参数 | 返回 | 现状 |
| --- | --- | --- | --- |
| `control_internal_player` | `{sessionId:string, action:PlayerAction}` | `PlayerSnapshot`；过期会话 reject | 未实现 |
| `pick_external_subtitle` | `{sessionId:string}` | `{status:'selected'|'cancelled'|'permission_denied'|'subtitle_error', track?:SubtitleTrack}` | 未实现 |
| `list_subtitle_candidates` | `{mediaFileId:string}` | `SubtitleTrack[]` | 未实现 |

要点：

- `PlayerAction` 覆盖 `play` / `pause` / `close`、`seek`、`rate`、`audio` / `subtitle`、`subtitle-delay`、`orientation`（见契约）。
- 时间统一毫秒，内核微秒只在 Kotlin 边界转换一次；`trackId` 是内核 / 会话内 ID，不是数组下标。
- 外挂字幕用 `ACTION_OPEN_DOCUMENT` 单文件只读授权；自动关联唯一可靠时返回候选数组，**多个候选必须人工选择，不得自动选第一项**。
- 未知时长为 `null`，不渲染 NaN 百分比。
- 已在 `open_internal_player` 实现的 `restart` / SQLite 续播保持不变；`subtitleId` 入参待此子项接通。

### B. WebDAV：命令 + 播放鉴权与 Range

- 命令（契约 §「共享命令常量」）：`browse_webdav` / `add_webdav_source` / `update_webdav_credentials`。表单凭据只进入 Rust / Android 安全存储，列表与快照**不返回密码 / 令牌 / 临时鉴权 URL**。
- 播放：WebDAV 视频需在 Rust 侧完成鉴权并支持 **Range** 转发（本地 Range 转发器是内部资源边界），Kotlin 只接收临时可读资源，页面不提交 / 不返回 URI、凭据、临时代理地址。
- 来源状态用契约枚举 `not_authorized` / `checking` / `available` / `connection_failed` / `offline` / `permission_denied` / `credential_invalid`；失败用结构化 `Failure{code,message,retryable}`。
- 离线 / 撤权 / 文件 missing 相互独立，**不删索引、不删个人记录**。

### C. 事件接入（契约 §「事件常量」）

| listen 常量 | payload |
| --- | --- |
| `android-source-state` | `{sourceId,revision,state:SourceState,error?:Failure}` |
| `scan-task-updated` | `{revision,task:ScanTask}` |
| `recognition-updated` | `{revision,mediaFileIds:string[],workIds:string[]}` |
| `player-state` | 完整 `PlayerSnapshot` |

要点：

- 每个实体 `revision` 单调递增，**旧事件丢弃**；正常扫描进度至多每 500 ms 发布，终态立即发布。
- 监听后立即读一次初始快照，返回前台再读一次；数据库任务终态是恢复依据，事件不是持久队列。
- 当前扫描前端的 1 秒轮询在事件接通前**保留**；接通后可改为事件 + 快照兜底，但不得删除快照恢复路径。
- `player-state` 承载完整快照（含音轨 / 字幕轨），不再拆多个可能错序的事件。
- 不发送名为 `works` / `work` / `progress` 的 RPC 回包事件。

### D. 字段缺口（前端已用 / 已占位）

| 缺口 | 前端表现 | 需要后端 |
| --- | --- | --- |
| 作品 `category` | 媒体库分区「动漫 / 电影 / 电视剧 / 未分类影视」、书架「漫画 / 轻小说」 | `works` 目前无 `category` 列，`commands.rs` 用 `work.type` 兜底。补稳定的作品分类字段（或规范 `list_works` 的分类来源）；**不改写作品类型**。 |
| 作者 | 详情 / 书架作者、可点击作者 | `Work` / `MetadataSummary` 无 author 字段；补作者字段及其元数据来源。 |
| `sourceScope` | 媒体库 / 书架工具行「全部 / 本地 / 网络」筛选 | 作品列表未返回来源归属，前端暂全部视为 `local`；补后「网络」才有结果。 |
| 浏览时间 | 书架排序「浏览时间」 | 后端无「作品最近浏览时间」，前端回退 `updatedAt`；补该字段或明确不提供。 |
| 多来源目录树 URI | 资料库点击来源行进入文件夹分级浏览 | 原生 `listTree` 根级别只用「最近一次持久化的 tree URI」，故**多来源需后端为每个来源暴露各自的 tree URI**（`listTree` 支持按来源 ID 下钻）。当前单来源已验证。 |

### E. 多来源目录浏览

按 D 表最后一行：`listTree` 需支持按来源定位；前端「每层只读当前层级、过滤文件夹、子项 `uri` 回传下钻、面包屑与系统返回逐级回退」的逻辑不变。

## 4. 约束与红线（必须遵守）

- **命名冻结**：命令名 / 参数 / 返回结构 / 事件名以 `BRIDGE_CONTRACT_V1.md` 为准，不得新增 `GenzoNative.call` 或独立 HTTP 业务服务；不得更改命令名 / 参数 / 返回结构 / 数据库结构。
- **播放**：PC 端借用外部播放软件；安卓走**内置原生 LibVLC Activity**（`PlayerActivity.kt`），不把 PC 播放行为对齐到安卓。首版验收前台播放；后台播放 / PiP 不在本轮明确范围。不接 DRM，不自研字幕解码 / 渲染（音视频与 ASS/SSA 交由内核）。
- **权限**：SAF `ACTION_OPEN_DOCUMENT_TREE` + 持久只读；外挂字幕 `ACTION_OPEN_DOCUMENT`；首版不要求 `MANAGE_EXTERNAL_STORAGE`，不申请写权限。返回 URI 与文档 ID，**不得把 URI 转盘符路径**。`delete_library_root` 与桌面 `add_library_root({path})` 不作为安卓 SAF 入口。
- **安全**：密码 / 令牌 / 临时鉴权 URL 只进入 Rust / 安全存储，不进列表、不进日志、不返回页面。
- **合规红线**：不做在线聚合、下载或分发（`COMPLIANCE-001`）；「未入库 / 未识别」只表达状态，不做下载入口。
- **覆盖**：`android_probe` / `android_native` 的 Kotlin 方法名只供 QA，不作为正式业务契约；正式页面不传任意播放 URI、不读取凭据、不调用 Windows 工具命令。
- **验证**：改后端后，前端需能在 `emulator-5554` 上重建安装并跑通（构建见 §7）。

## 5. 验收标准

- [ ] `control_internal_player` 的 play / pause / seek / rate / audio / subtitle / subtitle-delay / orientation / close 全部生效；过期会话 reject；`PlayerSnapshot` 字段与契约一致。
- [ ] `list_subtitle_candidates` 返回候选；`pick_external_subtitle` 单文件授权成功 / 取消 / 拒绝 / 字幕错误分类正确；多候选**不自动选第一项**。
- [ ] WebDAV 可添加 / 更新凭据 / 浏览 / 扫描；视频可带鉴权与 Range 播放；列表与快照无密码 / 令牌。
- [ ] 四个事件接通，`revision` 单调、旧事件丢弃、进度至多每 500 ms、终态立即；返回前台读快照；扫描 1 秒轮询可安全退场。
- [ ] `category` / 作者 / `sourceScope` / 浏览时间 / 多来源 tree URI 按 §3-D 补齐，前端相应分区、筛选、排序、多来源下钻出现真实结果。
- [ ] 来源离线 / 撤权、文件 missing、扫描失败、候选待确认各自独立展示，且失败不删库 / 不删进度。
- [ ] 权限拒绝、鉴权失败、扫描失败、字幕缺失、播放不支持均有明确状态与补救路径（重试 / 重连 / 重新授权 / 选字幕）。

## 6. 需要你先确认 / 回答的问题

1. **探索数据源方向**（阻塞发现页真实季度数据）：内置 `bangumi-data` 快照 `0.3.132`（`src-tauri/src/explore.rs`）**无 2026-10 条目**，`get_weekly_calendar` 各天为 0、`overview(2026,10).seasonal` 为 0；且 `bangumi.rs` 的 `subject_to_metadata` 丢弃 `air_weekday`。三选一，请答复：(1) 刷新内置快照到最新（npm `bangumi-data` 0.3.229）；(2) 后端改走实时 `/calendar` 并保留 `air_weekday`；(3) 只改前端用最近可用档期。选择后把 `weekly_calendar` 做成**季节化**（按年 / 季度）。
2. **`category` 来源**：新增列 / 迁移，还是由现有 `type` + 标签派生并规范返回？（前端书架按 `category ?? type` ∈ {`comic`,`novel`} 只读映射。）
3. **作者字段**来源与许可 / 限流 / 缓存策略。
4. **浏览时间**：是否提供真实「最近浏览时间」，或保持 `updatedAt` 回退。
5. **轻小说在线源**：是否有可接入源；无则前端维持「待接入数据源」占位。
6. **多来源 tree URI**与 `listTree` 按来源下钻的参数 / 返回如何定（同时保持 `list_works` 的 `sourceScope` 一致）。

## 7. 交付与验证方式

- 按 `BRIDGE_CONTRACT_V1.md` 冻结命名实现，改动集中 `src-tauri/*` 与 `PlayerActivity.kt`；**不改命令名 / 参数 / 返回结构 / 数据库结构 / 现有共享 DTO**。
- 前端侧集成位置：`src/android/api.ts`（安卓命令 + 事件监听）、`src/api.ts`（共享命令）。
- 构建 / 模拟器验证（工作树根目录 PowerShell）：
  ```powershell
  .\scripts\build-android.ps1 -Target x86_64
  .\scripts\start-android-emulator.ps1 -Apk 'D:\DevTools\Android\Build\gradle-genzo\app\outputs\apk\universal\debug\app-universal-debug.apk'
  ```
  注意：前端嵌入 Rust `.so` 时 Gradle 可能判 up-to-date 不重打，需先清 `D:\DevTools\Android\Build\gradle-genzo\app\intermediates\{merged_native_libs,stripped_native_libs,incremental\packageUniversalDebug}` 与 `outputs` 强制重打包。ADB 必须 `-s emulator-5554`。
- 每完成一项，回报：改了哪些命令 / 事件 / 字段、对应前端可验证的操作路径、以及在模拟器上的实测结果。若某子项依赖 §6 未决问题，先完成不依赖的部分并明确标注阻塞点。

---

**请先回复 §6 的第 1、2、6 项**，再据此推进命令与事件的实现。
