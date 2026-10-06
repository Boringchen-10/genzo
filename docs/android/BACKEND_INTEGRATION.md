# Android 后端接入与模拟器验证（2026-10-06）

本阶段在 `codex/android-first` / `H:\二次元阅读器\.tmp\android-first`，承接 OpenDesign `4c96046`，保留其页面与样式。只安装电脑 `Genzo_Pixel9_API36` / `emulator-5554`，Android 16 / API 36 / x86_64；没有部署新的手机包。本阶段是可继续设计与验证的调试版本，尚不是完整安卓首版发布。

## 接入结果

| 能力 | 当前实现与验证边界 |
| --- | --- |
| 播放控制 | 冻结的 `control_internal_player` 覆盖播放、暂停、毫秒拖动、0.5–2×、内核音轨 / 字幕轨 ID、±60 秒字幕偏移、横 / 竖 / 系统方向、关闭；拒绝过期会话、非法轨道、未知字段与无效时间 |
| 字幕候选 | `list_subtitle_candidates` 读取现有 `subtitle_links` 与来源状态；唯一可用关联自动选择，多候选不选第一项。`open_internal_player.subtitleId` 只接受该视频的可用候选 |
| 手动字幕 | `pick_external_subtitle` 使用系统单文件只读授权。取消、选中 SRT、误选 MP4 的 `subtitle_error` 已验；撤权引起的 `permission_denied` 分支已实现，未用撤权样本验收 |
| WebDAV | 复用 PC 的浏览 / 添加 / 凭据更新 / 扫描及 Android 安全存储；合成 Basic Auth 服务验证播放、Range 拖动、401、Range 不支持、断线与恢复 |
| 视频传输 | 原始字节流经内部鉴权代理送入 LibVLC。Range 不支持直接报错，不走 PC 完整视频下载兜底；扫描只请求目录元数据。播放本身会读取视频字节，短样本可能被内核提前缓冲，不能称网络零下载 |
| 个人记录 | 稳定 `mediaFileId` 的 SQLite 观看进度、续播、收藏与笔记；来源离线保留索引、关联和个人记录。转发中断覆盖内核误报的结束，错误状态不标记看完，包括接近片尾的情况 |
| 多来源目录 | 现有 `android_native(listTree,{sourceId,uri?})` 按登记来源注入根 URI；两个合成授权树独立读取，拒绝跨树 URI。当前页面已传来源 ID；正式独立目录命令名尚未冻结 |
| 事件 | `android-source-state`、`scan-task-updated`、`recognition-updated`、`player-state` 已接。共享识别 / 确认 / 取消 / 纠错 / 撤销 / 手动整理 / 刷新完成后通知重新读取快照 |
| 分类 | PC 已有 `work_category.rs`，由元数据锚点与类型派生 `category`；继续复用，没有新增列或修改作品类型。后端 Prompt 中“尚无分类返回”的判断已过时 |
| 本周日历 | Android `get_weekly_calendar` 使用 Bangumi `/calendar` 的星期分组，SQLite 成功缓存 6 小时；更新失败保留上次成功内容并标记 stale，首次离线给错误 |

没有新增迁移、依赖或改动共享 DTO / 已执行迁移。Windows 保留外部播放器与原有探索实现。网盘经用户提供的 WebDAV 服务接入，不包含任何网盘账号 / API 直连。

## OpenDesign 可使用的边界

命令、参数、状态及事件的真源仍为 [BRIDGE_CONTRACT_V1.md](BRIDGE_CONTRACT_V1.md)，前端适配器 `src/android/api.ts`；共享能力继续调用 `src/api.ts`，不复制 PC 领域模型。

- React 负责作品 / 来源 / 整理 / 详情与进入、续播、字幕候选选择。业务播放只传媒体 ID、候选 ID、会话 ID，不传任意 URI、密码或代理地址。
- 独立 Kotlin `PlayerActivity` 持有 LibVLC 与视频 / 字幕 surface。当前控件是验证版；正式控件需要 OpenDesign 提供布局、Token 和交互后由原生实现。React 播放期间在后台，不能依赖 React 定时器写观看进度。
- 订阅后读取初始快照，返回前台再读取；前端按事件类型 + 来源 / 任务 / 会话 ID 丢弃旧 revision，部分订阅失败清理已注册监听。扫描正常进度发布间隔至少 500 ms，终态立即发布。
- 当前保留 1 秒扫描快照轮询。已验短扫描、终态和四类事件，以及前端旧事件 / 解除监听单测；大库长扫描、取消竞态与反复进出前台尚未完整验收，因此不能宣布轮询已安全退场。
- 来源列表返回最近授权 / 扫描 / 播放的检查状态，不在读取列表时主动联网或递归扫描。`range_unsupported` 属于播放器错误，不能因此把服务认定为离线。

现有页面可操作路径：`我的 → 资料库` 管理授权目录 / 扫描 / 待整理，作品详情 / 首页续播进入原生播放器，`发现 → 时间表` 读取本周日历。WebDAV 添加 / 更新凭据 / 浏览通过共享适配器与 QA 调用验证，正式连接表单仍需 OpenDesign 接入；现有 `我的 → 网络` 是阅读网络占位，不能当 WebDAV 表单。后端可用不表示所有页面错误操作入口都已完成设计验收。

## 数据方向与未完成项

用户确认优先移植 PC 能力，不更新 `bangumi-data` 快照。Android 本周日历改用实时 API 与持久缓存；既有季度概览仍复用 PC 实现及其内置索引，旧快照没有 2026-10 条目时会为空。`/calendar` 是当前播出日历，不能按前端选择的历史季度伪造返回内容。真实历史季度查询需后续独立范围与接口决定。

| 字段 / 流程 | 本阶段结论 |
| --- | --- |
| 作者 | 共享 DTO 未提供独立作者字段；未创建新作者 API / 数据源，漫画 / 轻小说仍非首版重点 |
| `sourceScope` | 后端未返回该作品级字段，页面当前回退 local；网络筛选不能作为已交付功能。混合本地与网络作品的归属语义及兼容 DTO 扩展待确定 |
| 最近浏览时间 | 未新增记录 / 迁移，书架排序仍回退 `updatedAt`，不能宣传为真实浏览排序 |
| 自动刮削 / 候选 / 纠错 / 刷新 | 接 PC 共享实现与本轮事件通知；真实 Bangumi / TMDB 作品的完整手机操作闭环仍待验收，手工整理通过不能替代该验收 |
| 大库与权限恢复 | 大目录、撤权 / 重授权、第三方文档 Provider、长视频、网络切换继续验收 |

上述三个字段与后端 Prompt “不改共享 DTO / 数据库结构”约束有冲突，本阶段没有擅自扩大结构。没有把作者占位、`updatedAt` 或一律 local 写成真实结果。

## 原生播放实测与修复

所有本地及 WebDAV 样本来自 `D:\DevTools\Android\Samples\GenzoPrototype` 的自制 40 秒、640×360 / 24 fps SDR 色条，音频 AAC；测试不读取或修改用户原有视频。

- MP4/H.264、MKV/H.265、双 AAC 音轨、内嵌 ASS 选轨通过；音轨 ID 返回正确不等于人工音质验收。
- 外挂 SRT、ASS、SSA 实际截图已检查，ASS 可见颜色、描边和简单移动，SSA 可见基本样式。小字幕最多 16 MiB，应用私有临时文件随会话结束清理。
- 系统选择器会销毁 LibVLC surface 并自动解除绑定；原型只在创建 Activity 时绑定，导致返回后黑屏。已接 `onStart/onStop` 重新绑定 / 解除视图，系统选择 SRT 后画面与字幕恢复。依据 [VideoLAN 发布的 3.7.7 源码](https://repo.maven.apache.org/maven2/org/videolan/android/libvlc-all/3.7.7/libvlc-all-3.7.7-sources.jar) 与实际失败 / 成功截图。
- Debug 模拟器的 goldfish 硬件解码在暂停拖动后保留旧帧；仅 `DEBUG && ranchu/goldfish` 用 LibVLC 软件解码，设备仍保留原硬件优先策略。这是内核解码策略，不涉及转码 / 重压缩。
- LibVLC 3.7.7 在暂停时改变倍速会丢失当前长字幕 cue；保留选定倍速，在恢复 Playing 时应用，防止暂停拖动 / 倍速 / 偏移组合使字幕消失。

未验字体附件、复杂特效 / 卡拉 OK、10-bit、4K、HDR / Dolby Vision、多声道 / 透传 / bit-perfect；不承诺所有容器、codec 或字幕完全兼容。后台服务、PiP、DRM 不在本阶段范围。

## 复验

```powershell
.\scripts\build-android.ps1 -Target x86_64
# 构建输出实际在 D 盘；显式打包 x86_64Debug，保留 Gradle / Cargo 缓存。
# 核对源 .so 与 merged_native_libs，以及 APK 与 stripped_native_libs 的哈希。
node .\scripts\verify-android-backend.mjs
node .\scripts\verify-android-subtitles.mjs
```

两个脚本限制为模拟器并使用合成样本。WebDAV 脚本创建有明确 QA 标签的测试作品 / 来源，结束后停用自己的来源、关闭自己的服务与 ADB reverse，不删除索引或个人记录；字幕脚本保留原目录授权，新增的 Nested QA 来源结束后停用。重复运行会保留测试条目，不能把它们当用户真实媒体。

原始结果、截图与构建日志在 `D:\DevTools\Android\Build\qa\backend`。`backend.json` / `subtitles.json` 为最近成功结果，另有早期失败结果用于定位，不把失败日志算通过。静态检查及构建已有 Vite 大 chunk / Kotlin 弃用 / Gradle 弃用警告，没有顺带做无关清理。

Windows 共享 Rust 回归 272 通过 / 14 忽略 / 0 失败（含存量迁移及 WebDAV 原有缓存 / 下载回归）；前端 18 文件 / 74 项通过，TypeScript 与生产构建通过。Windows 本轮没有重新打安装器或做全部原生窗口人工验收。

最终包在模拟器的五项实际 React 页面均为 412px、无水平溢出；强制停止后 SAF 来源授权 / 启停、观看进度、外观设置及日历缓存仍一致。`ui-smoke.json` / `verify-ui-smoke.mjs` 在上述 D 盘结果目录；不是全部错误交互或大库性能验收。当前模拟器留在首页供继续设计。

最终模拟器测试 APK、大小与 SHA256 记录在 [FRONTEND_PREVIEW.md](FRONTEND_PREVIEW.md)。旧固定 APK 保留，不用旧包代替本轮验证包。
