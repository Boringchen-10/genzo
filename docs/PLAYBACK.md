# PotPlayer 进度与前端对接

## 已实现的边界

Windows / PotPlayer 优先，不内置播放器，不读取播放器私人历史数据库。仅记录由 Genzo 打开的实例，播放器文件名必须与启动路径相符。按媒体文件 ID 持久化；文件移动后只要扫描保留原 ID，记录继续保留，重新关联作品也不丢失。不会修改源媒体或手动作品完成状态。

使用独立实例 `/new`，覆盖模板中的 `/current`、`/add`、`/insert`；续播时覆盖模板旧 `/seek`。其他自定义参数保留。跳转未就绪的初始位置不覆盖旧进度。退出 Genzo 后停止采集；播放器自身的历史不自动导入。

## 前端契约

- `dataProvider.playbackProgress(workId?)` → `{items, sessions}`。省略作品 ID 时返回最近 100 条；指定时仅返回该作品的最近 100 条。`sessions` 为当前应用生命周期内的会话状态，详情按文件 ID 筛选。
- `items` 字段：`mediaFileId`、`workId`、`fileName`、`title`、`toolId`、`positionMs`、`durationMs`、`completed`、`updatedAt`、`missing`。`completed` 只代表文件距尾部不超过总时长 1% 且不超过 10 秒，不能用来标记整个作品已完成。
- `sessions` 字段：`mediaFileId`、`status`、`message`。状态为 `connecting` / `tracking` / `stopped` / `changed` / `error`。前两项禁止重复启动同一文件；`message` 也可能是数据库暂时无法保存的重试提示，不能只根据 `tracking` 推断保存成功。
- `dataProvider.resumePlayback(mediaFileId, restart=false)` 使用原 PotPlayer 工具继续播放，`restart=true` 请求从头播放。工具已删除或改为其他程序时要求重新选择 PotPlayer。
- 原 `launchMedia` 签名保持兼容；选择 PotPlayer 时默认读取旧进度，普通外部工具行为不变。后端 `launch_media` 可选 `restart` 参数默认 false。
- 当前入口为 `src/components/PlaybackHistory.tsx`，首页展示最近 5 条，详情展示本作品记录。前端可替换布局，但必须保留错误状态，不能用点击打开推算观看时长。浏览器 mock 返回空列表，真实记录只来自桌面后端。

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
