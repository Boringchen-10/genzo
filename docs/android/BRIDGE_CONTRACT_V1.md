# Android / OpenDesign 桥接契约 v1

冻结日期 2026-10-04。名称是首版实现约定，**冻结不等于已实现**；下面逐项区分已有 / 新增。共享 DTO 以 `src/types.ts`、`src/playback.ts`、`src/scanTasks.ts` 为准，不复制设计演示模型当数据库模型。

## 通道与读取

React 通过 `@tauri-apps/api/core.invoke(command, args)` 异步读写，用 `src/api.ts` 完成缓存图片地址转换。命令参数 camelCase，返回共享 DTO；错误 reject，不用全局 toast 事件替代请求结果。Tauri `listen(event, handler)` 用于持续状态变化，离开页面解除监听。没有 `GenzoNative.call` 或独立 HTTP 业务服务。

OpenDesign 的 `library.* / sources.* / inbox.* / player.*` 可以作为前端函数名，底层命令常量只使用下面的实际名称。列表请求返回快照；不发送名为 `works/work/progress` 的 RPC 回包事件。当前扫描仍使用 1 秒轮询，事件接入前不能订阅空事件等待数据。

## 共享命令常量（v0.5.0 已有）

| 前端操作 | invoke 常量 | 参数与结果 / 注意 |
| --- | --- | --- |
| library.listWorks | `list_works` | `{}` → `WorkListItem[]`；搜索 / 分类 / 排序目前前端处理，超过 50 项分页或虚拟渲染 |
| library.getWork | `get_work` | `{id}` → `WorkDetail` |
| library.updateWork / favorites.toggle | `update_work` | `{id,input:WorkInput}` → `WorkDetail`；收藏沿用完整输入，不能发送不完整 fields 导致其他个人资料丢失 |
| library.createWork | `create_work` | `{input:WorkInput}` → `WorkDetail` |
| detail.setFieldLock | `set_work_field_lock` | `{workId,field,locked}`；字段范围沿用现有 API |
| sources.list | `list_library_roots` + `list_remote_sources` | 合并稳定 ID；`LibraryRoot` 提供 enabled / availability，WebDAV 提供名称 / endpoint / directory，不返回密码 |
| sources.setEnabled | `update_library_root` | `{id,kind,enabled}`；只是启停，不删除索引 |
| sources.browseWebdav / addWebdav | `browse_webdav` / `add_webdav_source` | `{input:{name,endpoint,directory,username,password,kind}}`；表单凭据只进入 Rust / 安全存储 |
| sources.updateCredentials | `update_webdav_credentials` | `{id,username,password}` |
| sources.scanStatus | `list_scan_tasks` | `{}` → `ScanTask[]` |
| sources.cancel / retry | `cancel_scan_task` / `retry_scan_task` | `{id}`；取消等待提交事务安全完成，不提供未实现的暂停语义 |
| inbox.list | `list_unassigned_media_groups` | 沿用现有 API 参数和 `UnassignedMediaGroup[]` |
| inbox.recognize | `recognize_media_file` / `recognize_unmatched_media` | 文件 / 组成员 ID；query、kind 与 season 按 `src/api.ts`，不是伪造 groupId |
| inbox.candidates / confirm | `list_match_candidates` / `confirm_match_candidate` | 沿用文件 / 候选 / 所选组成员范围，确认是事务 |
| detail.correct | `inspect_media_correction` / `preview_media_correction` / `apply_media_correction` | 预览 input + token；锁定 / 记录 / 撤销沿用共享 DTO |
| detail.episodes / refresh | `get_anime_work_structure` / `list_anime_episodes` / `refresh_work_metadata` | `{workId}`；季度 / 多版本 / 缓存失败规则沿用现有实现 |
| progress.list | `get_playback_progress` | `{workId:null|string}` → `{items,sessions}`；安卓写入接新增接口，不调用 PotPlayer 的 `resume_playback` |

`delete_library_root` 和桌面 `add_library_root({path})` 不作为安卓 SAF 入口。移除来源的设计先用停用 / 撤销授权表达并保留资料；实际删除须另定确认与数据保留行为。

## 安卓业务命令常量（新增，尚未实现）

| invoke 常量 | 参数 | 返回 |
| --- | --- | --- |
| `authorize_video_source` | `{label?:string, sourceId?:string}`；sourceId 为重新授权，目录由系统选择 | `{status:'authorized'|'cancelled'|'permission_denied',source?:VideoSource}` |
| `scan_video_source` | `{sourceId:string}` | `{taskId:string}`；仅 SAF 或 WebDAV 视频来源，任务按快照跟踪 |
| `get_video_source_states` | `{}` | `VideoSource[]`；与 shared roots 同 ID |
| `open_internal_player` | `{mediaFileId:string,restart:boolean,subtitleId?:string}` | `PlayerSnapshot`；URI、凭据与临时代理地址不由页面提交 / 返回 |
| `get_internal_player_state` | `{sessionId?:string}` | `PlayerSnapshot`；无活动会话为 idle / closed |
| `control_internal_player` | `{sessionId:string,action:PlayerAction}` | `PlayerSnapshot`；过期会话 reject |
| `pick_external_subtitle` | `{sessionId:string}` | `{status:'selected'|'cancelled'|'permission_denied'|'subtitle_error',track?:SubtitleTrack}` |
| `list_subtitle_candidates` | `{mediaFileId:string}` | `SubtitleTrack[]`；唯一可靠关联可自动选，多项提供人工选择 |

```ts
type SourceState = 'not_authorized'|'checking'|'available'|'connection_failed'|
  'offline'|'permission_denied'|'credential_invalid';
type ErrorCode = 'permission_denied'|'source_offline'|'credential_invalid'|
  'range_unsupported'|'network_timeout'|'decoder_unsupported'|'subtitle_error'|
  'player_crashed'|'unknown';
type Failure = {code:ErrorCode; message:string; retryable:boolean};
type VideoSource = {
  id:string; kind:'saf'|'webdav'; label:string; enabled:boolean;
  state:SourceState; lastScannedAt:string|null; error?:Failure;
}; // URI / endpoint 编辑信息另用已授权来源详情，列表不展示密码。
type PlayerAction =
  | {type:'play'|'pause'|'close'}
  | {type:'seek';positionMs:number}
  | {type:'rate';speed:number}
  | {type:'audio'|'subtitle';trackId:string}
  | {type:'subtitle-delay';offsetMs:number}
  | {type:'orientation';orientation:'portrait'|'landscape'|'system'};
type SubtitleTrack = {
  id:string; label:string; kind:'embedded'|'sidecar'; language?:string;
  available:boolean; // 不把文件 URI 暴露为可任意读取的页面媒体 URL。
};
type PlayerSnapshot = {
  sessionId:string|null; mediaFileId:string|null; revision:number;
  status:'idle'|'opening'|'buffering'|'playing'|'paused'|'seeking'|'ended'|
    'interrupted'|'error'|'closed';
  positionMs:number; durationMs:number|null; seekable:boolean; rate:number;
  audioTracks:{id:string;label:string;language?:string}[];
  subtitleTracks:SubtitleTrack[]; audioTrackId:string|null;
  subtitleTrackId:string|null; subtitleOffsetMs:number; error?:Failure;
};
```

时间统一毫秒；内核微秒只在 Kotlin 边界转换。track ID 是内核 / 会话内 ID，不是数组下标。未知时长为 null，不渲染 NaN 百分比。原始文档 URI + sourceId 用于后端定位，业务身份用稳定媒体 ID。个人进度后台按 5 秒及暂停 / 退出 / 片尾保存，不要求 React 播放期间持续运行写库。

## 事件常量（新增，尚未实现）

| listen 常量 | payload |
| --- | --- |
| `android-source-state` | `{sourceId,revision,state:SourceState,error?:Failure}` |
| `scan-task-updated` | `{revision,task:ScanTask}`；所有计数与快照同源 |
| `recognition-updated` | `{revision,mediaFileIds:string[],workIds:string[]}`；页面据 ID 重新读共享快照 |
| `player-state` | 完整 `PlayerSnapshot`；含音轨 / 字幕轨，不再拆成多个可能错序的 tracks / ended / error 事件 |

每个实体 revision 单调递增，旧事件丢弃。正常扫描进度至多每 500 ms 发布；终态立即发布。监听后立刻读取初始快照，返回前台再读一次；数据库任务终态与进度为恢复依据，事件不是持久队列。

## 状态与显示规则

来源离线 / 撤权、文件 missing、扫描失败和候选待确认各自独立。扫描沿用共享 `queued/scanning/indexing/committing/completed/failed/cancelled/interrupted`；已发现数与已处理数不混用。失败显示范围 / 重试入口；离线不删库。候选继续沿用共享 pending / matched 状态，前端空候选与连接失败分别展示。刷新失败保留缓存、个人记录与锁定字段。

播放器错误显示重试 / 重连 / 重新授权 / 选字幕中适用的一项。通用 EncounteredError 无法可靠推断 codec 时返回 unknown，不猜“解码不支持”。权限与凭据失败可明确分类。没有合适字幕只显示选择入口，不冒充播放失败；多个外挂候选必须人工选。

当前验证入口 `android_probe` / `android_native` 的 Kotlin 方法名只供 QA，不作为正式业务契约。正式页面不传任意播放 URI、不读取凭据，也不调用 Windows 工具命令。
