# Android 首版：OpenDesign 数据与交互交接

2026-10-04，开发基线 `v0.5.0` / `81b41d1`。下表是首版目标，不是全部完成的承诺。已按OpenDesign交付接入React可操作前端与本地数据 / 播放 / 续播，用户当前在电脑模拟器继续设计，暂不部署手机；原生控件仍为验证版。具体已验收与后续范围见 `FRONTEND_PREVIEW.md`。

## 首版能力与交付边界

| 能力 | 复用 / 新增 | 当前状态 |
| --- | --- | --- |
| 作品、文件、收藏、评分、笔记、人工锁定与观看记录 | Windows 领域模型、SQLite 迁移 | 共享后端；手机业务闭环待验证 |
| 动漫、电影、电视剧、分集与多版本文件 | Bangumi 主锚点；影视 TMDB 主源 | SAF 索引及季集解析已接；共享识别 / 纠错手机闭环待验收 |
| 手机下载目录授权、重启后访问 | Android SAF、持久 URI 权限 | 已接递归索引、共享扫描任务、重复扫描元数据复用；真机与模拟器合成目录验证通过，正式页面待接 |
| 扫描、候选核对、手动搜索 / 建作品、纠错、刷新 | 现有任务及识别接口 | 需适配手机来源后验收 |
| WebDAV 目录 / 扫描 / 播放 | 复用现有 Rust 协议；Android 安全凭据 | Keystore 密文与强制停止后读回已验；远程播放业务待验收 |
| 网盘 | 用户提供的 WebDAV 服务 | 不包含任何网盘账号 / API 直连；需要直连时先确认具体服务 |
| 应用内播放 | 原生内核 + Kotlin 视图 | LibVLC 真机验证原型；最终结论见播放器报告 |
| 漫画、轻小说、书架、探索 | 保留后续导航 / 扩展位置 | 安卓首版不交付阅读；不借用桌面已完成功能冒称手机可用 |
| Windows 现有功能 | 保留独立桌面入口 / 配置 | 不改变已发布标签及原主目录草稿 |

## 页面所需数据

| 页面 / 操作区 | 数据 | 状态 / 操作 |
| --- | --- | --- |
| 首页 / 继续观看 | 作品标题、分类、封面、最近播放文件、位置 / 时长、来源可用性 | 继续、从头播放；离线可浏览，文件不可用时给重新授权 / 重连入口 |
| 媒体库 | `WorkListItem`、动漫 / 电影 / 电视剧分类、搜索、收藏、排序 | 加载、空库、无筛选结果、缓存封面失败重试 |
| 作品详情 | `WorkDetail`、官方分集、多版本 `MediaFile`、字幕、字段来源 / 锁定、个人记录 | 播放、改分集、人工纠错、刷新、选季；网络失败保留旧资料 |
| 来源 | 来源 ID、名称、SAF 目录名称或 WebDAV 服务地址、授权 / 连接状态、最后完整扫描 | 添加、重新授权、测试连接、扫描、取消 / 重试；密码只输入，不回显 |
| 扫描任务 | 任务 ID / 来源、阶段、当前目录、已发现 / 处理 / 复用、失败范围 | 枚举时未知总量，禁止虚构百分比；写入阶段可按已知总量展示 |
| 待整理 / 候选确认 | 文件组、原始文件名、解析季集、候选标题 / 年份 / 类型、置信度、歧义理由、预览选择 | 勾选可靠子集；每组确认事务；近分、混季、复合集数保留人工选择 |
| 人工纠错 / 刷新 | 纠错预览 token、原映射 / 目标、锁定字段、识别历史、缓存时间 | 预览过期重试；人工资料优先；失败不能删除分集 / 进度 |
| 播放入口 / 原生播放视图 | 稳定媒体 ID、会话 ID、位置 / 时长、倍速、音轨、字幕轨、外挂候选、偏移、错误 | 见下文原生边界；不把临时 URL 当身份 |
| 设置 | 主题、缓存大小与用量、Provider 配置是否可用、版本、诊断摘要 | 凭据不进入普通配置或日志；明确 Future 能力 |

现有模型位置：`src/types.ts`、`src/scanTasks.ts`、`src/playback.ts`、`src/recognitionPreferences.ts`。个人状态 `planned/in_progress/completed/paused/dropped` 与播放器状态独立，播放到片尾不覆盖用户手动作品状态。

## 已有共享命令（实现依据 `src/api.ts` 和 Rust invoke handler）

| 场景 | 命令 | 关键参数 / 返回 |
| --- | --- | --- |
| 浏览 / 个人资料 | `list_works`, `get_work`, `create_work`, `update_work`, `set_work_field_lock` | 既有 Work 输入 / 详情；收藏、评分、笔记沿用现有事务 |
| 文件整理 | `list_unassigned_media`, `list_unassigned_media_groups`, `list_recognition_group_members`, `attach_media_files`, `detach_media_file` | 来源归属、文件 ID 与组范围；不改真实文件 |
| 来源 / 扫描 | `list_library_roots`, `list_remote_sources`, `browse_webdav`, `add_webdav_source`, `update_webdav_credentials`, `scan_library_root` | WebDAV 输入通过 Rust；手机本地来源新增接口，不能传 content URI 给 Path 扫描器 |
| 任务 | `list_scan_tasks`, `cancel_scan_task`, `retry_scan_task` | `ScanTask` 与 task ID；安卓恢复/撤权状态另需补齐 |
| 候选 | `recognize_media_file`, `recognize_unmatched_media`, `list_match_candidates`, `confirm_match_candidate`, `cancel_match_candidates` | `mediaFileId/query/kind/season`；候选确认附所选文件 / 组范围 |
| 纠错 | `inspect_media_correction`, `preview_media_correction`, `apply_media_correction`, `list_recognition_history`, `undo_recognition` | input、预览 token / 历史 ID；过期保护、撤销冲突保护 |
| 分集 / 刷新 | `get_anime_work_structure`, `list_anime_episodes`, `set_media_episode`, `refresh_work_metadata` | 稳定作品 / 文件 ID；主源与剧照来源分开 |
| 观看记录 | `get_playback_progress` | 共享记录可读取；`resume_playback` 当前依赖 PotPlayer，安卓必须使用新的内置入口 |

## 当前验证命令

React → Rust：`android_probe({write})` 检查平台、数据库完整性 / 迁移数、数据库标记和应用私有文件标记；`android_native({command,payload})` 限制为下面的原型命令。

| Kotlin 命令 | 输入 | 返回 |
| --- | --- | --- |
| `pickTree` | `{}` | `authorized + uri` / `cancelled` / `permission_denied` |
| `listTree` | `{uri?: string}` | `available + files[]` / `not_authorized` / `permission_denied` / `source_offline`；只枚举第一层，不写媒体库 |
| `pickVideo` | `{}` | 单文件持久只读授权结果 |
| `openPlayer` | `{uri, restart}` | `opening`；原生独立 Activity，随后读取真实状态 |
| `playerState` | `{}` | 内核、真实位置 / 时长、可拖动性、倍速、音轨 / 字幕轨、偏移、错误状态 |
| `playerControl` | `{action,value?,uri?}` | 原型播放 / 暂停 / 拖动 / 倍速 / 选轨 / 偏移 / 外挂 / 旋转 / 关闭；用于真机 QA |

这些命令是验证接口，不应被正式设计绑定为完成后的业务 API。

## 正式接口准备（尚未实现，命名已冻结）

完整命名 / 参数 / 快照与事件常量以 `BRIDGE_CONTRACT_V1.md` 为准；OpenDesign 七项回应见 `CODEX_RESPONSE.md`。

- `authorize_video_source`：系统目录选择器返回稳定来源 ID 与授权状态；不返回 Windows 路径。
- `scan_video_source({sourceId})`：复用 task ID；快照与事件共用同一状态，进程重建后读取快照。
- `open_internal_player({mediaFileId,restart,subtitleId?})`：Rust 解析授权资源 / WebDAV 会话，Kotlin 接收临时可读资源；返回 session ID。
- `control_internal_player({sessionId,action})`：play / pause / seek / speed / audio / subtitle / subtitle-delay / orientation / close。时间统一为 ms，桥接内核微秒时转换一次。
- `pick_external_subtitle({sessionId})`：系统单文件选择器，只读；自动关联返回候选数组，多个候选必须提供人工选择，不自动选第一项。
- 事件 `android-source-state`、`scan-task-updated`、`recognition-updated`、`player-state`：携带 ID、递增 revision、完整状态与结构化错误，不带密码 / 令牌 / 临时鉴权 URL。首次和返回前台必须读快照，不能只靠事件。

## 状态与错误约定

- 来源：`not_authorized / available / checking / connection_failed / offline / permission_denied / credential_invalid`。离线、撤权与文件 missing 分开，不删除索引或个人记录。
- 扫描：沿用 `queued / scanning / indexing / committing / completed / failed / cancelled / interrupted`，提交中等待原子事务结束；部分失败用既有失败目录信息，重试限定失败范围，取消未提交任务保留旧索引。
- 匹配：`unmatched / candidate_pending / matched / error`，人工创建作品使用既有 metadata 状态；展示近分、年份 / 季数冲突及不能自动归档的原因。
- 刷新：`idle / refreshing / fresh / stale / error`；错误附 cachedAvailable，保留旧资料，锁定字段不覆盖。
- 播放：`idle / opening / buffering / playing / paused / seeking / ended / interrupted / error / closed`。错误 codes 覆盖 `permission_denied / source_offline / credential_invalid / range_unsupported / network_timeout / decoder_unsupported / subtitle_error / player_crashed`，说明可重试 / 重连 / 重新授权 / 重新选择字幕操作。

## 原生播放器与 React 的边界

React 负责媒体浏览、作品整理、来源、候选确认和播放入口。首个原型采用独立原生 Activity 承载 LibVLC 视频 surface 与验证控件；播放期间 React 页面不叠在视频上。OpenDesign 应交付播放器独立画面和控件规范；能映射为 Kotlin 原生控件的布局直接实现。若要求 WebView 覆盖视频 surface，需要额外验证 Z-order、字幕层、触摸、键盘与安全区，不能把 DOM `<video>` 视为等价实现。

系统返回关闭播放视图并保存进度后回到原详情；旋转、暂停 / 前后台、进程回收都要保存稳定媒体 ID。首版先验收前台播放；后台播放 / PiP 不在本次明确范围内。字幕样式、内嵌字体、复杂特效、HDR 与音频输出必须根据实测提供兼容性说明。

## 设计交付所需状态样本

空库、长标题 / 缺封面、多版本 / 多季、扫描总量未知 / 写入中 / 部分失败、近分候选、人工字段锁定、Provider 429 / 连接失败使用旧缓存、来源离线、SAF 撤权、多个外挂候选、播放器缓冲 / 音轨 / 字幕 / 偏移 / 不支持解码 / 中断恢复。手机安全区、系统返回、键盘遮挡、横竖屏及触摸目标都需设计；书架 / 探索扩展位标注 Future。
