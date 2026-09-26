# PotPlayer 进度与前端对接

## 已实现的边界

Windows / PotPlayer 优先，不内置播放器，不读取播放器私人历史数据库。仅记录由 Genzo 打开的实例，启动时先确认播放器文件与请求路径相符；随后支持同一实例内切换到可唯一匹配的库内视频。按媒体文件 ID 持久化；文件移动后只要扫描保留原 ID，记录继续保留，重新关联作品也不丢失。不会修改源媒体或手动作品完成状态。

使用独立实例 `/new`，覆盖模板中的 `/current`、`/add`、`/insert`；续播时覆盖模板旧 `/seek`。其他自定义参数保留。跳转未就绪的初始位置不覆盖旧进度。退出 Genzo 后停止采集；播放器自身的历史不自动导入。

## 前端契约

- `dataProvider.playbackProgress(workId?)` → `{items, sessions}`。省略作品 ID 时返回最近 100 条；指定时仅返回该作品的最近 100 条。`sessions` 为当前应用生命周期内的会话状态，详情按文件 ID 筛选。
- `items` 字段：`mediaFileId`、`workId`、`fileName`、`title`、`toolId`、`positionMs`、`durationMs`、`completed`、`updatedAt`、`missing`。`completed` 只代表文件距尾部不超过总时长 1% 且不超过 10 秒，不能用来标记整个作品已完成。
- `sessions` 字段：`mediaFileId`、`status`、`message`。状态为 `connecting` / `tracking` / `stopped` / `changed` / `error`。前两项禁止重复启动同一文件；`message` 也可能是数据库暂时无法保存的重试提示，不能只根据 `tracking` 推断保存成功。
- `dataProvider.resumePlayback(mediaFileId, restart=false)` 使用原 PotPlayer 工具继续播放，`restart=true` 请求从头播放。工具已删除或改为其他程序时要求重新选择 PotPlayer。
- 原 `launchMedia` 签名保持兼容；选择 PotPlayer 时默认读取旧进度，普通外部工具行为不变。后端 `launch_media` 可选 `restart` 参数默认 false。
- 首页横幅和详情主按钮按当前作品最后观看时间选择文件，不再按文件名默认第一集。无记录时详情仍允许打开首个可用文件；初次读取记录失败不会自动退回第一集。分集卡片按文件版本显示封面底部进度，默认选上次观看版本，用户手动选择版本优先。进度每 5 秒及窗口重新可见时刷新。
- 当前入口为 `src/components/PlaybackHistory.tsx`，首页只展示最近一次观看，详情只展示本作品上次观看；完整记录仍保留供分集进度使用。前端可替换布局，但必须保留错误状态，不能用点击打开推算观看时长。浏览器 mock 返回空列表，真实记录只来自桌面后端。

## 验证方法

常规：`cargo test --locked --manifest-path src-tauri/Cargo.toml`、`pnpm test`、`pnpm run build`。

UI：启动 `pnpm dev --host 127.0.0.1 --port 4175` 后执行 `node scripts/check-playback.mjs`；使用隔离 Tauri 响应验证 1024×640、1366×768、1920×1080 的记录显示、续播/从头参数、活动会话禁用和读取失败保留旧界面。

真实播放器测试仅按需执行，会打开合成测试视频窗口；不使用真实媒体库。使用 Python 3 标准库生成无声 AVI：

```powershell
python scripts/create-playback-fixture.py
$env:GENZO_POTPLAYER='D:/potplayer/PotPlayerMini64.exe' # 改成测试机器的实际路径
$env:GENZO_PLAYBACK_FIXTURE=(Resolve-Path .tmp/playback-fixture/genzo-progress-test.avi).Path
cargo test --locked --manifest-path src-tauri/Cargo.toml installed_player -- --ignored --test-threads=1
```

测试涵盖真实文件名返回、10 秒 seek、暂停保存到隔离 SQLite、重复启动保护与关闭重开续播。默认回归忽略这些需要已安装播放器的测试。真实用户网盘的拖动和断线表现仍需逐服务验收，不据合成文件测试宣称所有版本/网盘兼容。

分集 UI 回归：启动 Vite 端口 4176 后运行 `node scripts/check-episode-progress.mjs`（可设置 `GENZO_TEST_URL`）；使用模拟记录核对首页/详情续播第 7 集、50% 底部进度、读取失败保留记录与空记录首集打开。

## 播放器内换集

支持 PotPlayerMini64 / PotPlayerMini / PotPlayer64 / PotPlayer 可执行文件。初始路径未确认时持续等待，不把第一次不同路径回复视为结束。路径比较兼容扩展 UNC、本地扩展前缀、file URI 与 Windows 已登记的映射盘 UNC 别名；不按文件名或集号猜测文件身份。

首次绑定后，新文件须连续两次有效采样并唯一匹配库内完整视频路径才切换记录。上一集样本保留独立媒体 ID 与采样时间；重试旧写入不得覆盖更新的记录。未入库、重复路径、其他窗口正在记录的文件会等待重试，不丢弃旧位置。任意外部 WebDAV URL、未登记的重定向地址不能凭文件名归库；由 Genzo 打开的原远程地址仍使用原媒体 ID。

协议核对：[PotPlayer 控制协议头文件](https://github.com/ld3l/PotPlayerControl/blob/main/InternalSimpleCmd.h)。实际“下一集”回归通过专属合成视频播放列表调用播放顺序命令，不控制用户现有播放器窗口。测试 `installed_player_tracks_next_episode` 与既有真实播放器测试一起按需运行。
