# Genzo Android 首版 — UI Handoff 与接入说明

冻结日期：2026-10-03
设计格式：单文件可编辑 HTML 原型（内联 CSS/JS）
主设计文件：`android/index.html`（canonical）
配套规范：`android/DESIGN_TOKENS.md`、`android/COMPONENTS_STATES.md`、`android/NAVIGATION.md`、`android/CAPABILITY_MAP.md`
桌面端基线：根目录 `index.html`（未改动），Token 与能力矩阵见根目录 `DESIGN_TOKENS.md`、`BACKEND_CAPABILITY_MATRIX.md`

## 1. 页面与路由映射

| 页面 | 路由 | 能力 ID | 首版完成度 |
|---|---|---|---|
| 首页 | `/home` | HOME-001 / HOME-002(进度) | 完成（进度为 NEW_REQUIRED，原型示例） |
| 媒体库 | `/library` | LIBRARY-001 / BOOKSHELF-001 | 完成（筛选为前端） |
| 收藏 | `/favorites` | HOME-001 | 完成 |
| 我的 / 设置 | `/profile` | SETTINGS-001 / THEME-001 | 完成（持久化待接入） |
| 来源管理 | `/sources` | LIBRARY-002/003/004/005、SCAN-001/002 | 本地完成；远程 Future |
| 待整理 | `/inbox` | MATCH-001/002/003、DETAIL-006 | 完成（识别由后端） |
| 作品详情 | `/detail/:workId` | DETAIL-001…006 | 完成 |
| 播放器 | 覆盖层 | PLAYER-001、DETAIL-002 | 设计完成；原生播放待接入 |
| 书架 | `/bookshelf` | BOOKSHELF-001、PLAYER-002 | **Future 预留** |
| 探索 | `/explore` | EXPLORE-001/002/006 | **Future 预留** |

## 2. 原生播放器接入方案（重点）

### 2.1 区域划分

```
┌──────────────────────────────────────────────┐
│ .gz-ptop   控制层：返回 / 标题 / 旋转 / 更多      │  HTML 覆盖
├──────────────────────────────────────────────┤
│ .gz-surface  原生视频区域（SurfaceView）        │  ← 原生视图
│   · data-native-surface 仅作占位与事件锚点       │
│   · 横屏时填满；竖屏时为 16:9 顶部区域           │
├──────────────────────────────────────────────┤
│ .gz-pctl   控制层：进度 / 播放控制 / 抽屉入口     │  HTML 覆盖
└──────────────────────────────────────────────┘
```

- 原型中原生视频区以 `.gz-surface`（图片帧 + 遮罩 + 中心播放键）表示，仅用于表达布局与状态；真实接入时映射到 ExoPlayer 的 `SurfaceView` / `TextureView`。
- 控制层（`.gz-ptop`、`.gz-pctl`、底部抽屉）为 HTML/CSS，通过桥接事件与原生播放器通信。
- 两种落地方式（任选，界面契约一致）：
  1. **HTML 承载 + 原生视图嵌入**：WebView 页面负责控制层，原生 `SurfaceView` 通过 `TextureView`/`SurfaceView` 嵌入视频区位置。
  2. **原生 Activity 承载**：控制层由 Compose/View 重绘，按本文事件契约与同一状态机对齐。

### 2.2 事件契约（原型实现为占位，需与原生对齐）

方向 A：HTML 控制层 → 原生（原型以 `CustomEvent('genzo:player-load')` 表示装载；其余为本地状态演示）

| 事件 | 触发 | 载荷（建议） |
|---|---|---|
| `player.load` | 打开播放器 / 切换分集 | `{ workId, mediaFileId, episode, uri }` |
| `player.play` / `player.pause` | 播放键 | `{}` |
| `player.seek` | 进度拖动 | `{ positionMs }` |
| `player.rate` | 倍速 | `{ speed }` |
| `player.audioTrack` | 音轨选择 | `{ index }` |
| `player.subtitleTrack` | 字幕选择 / 关闭 | `{ index|null, externalUri? }` |
| `player.subtitleOffset` | 字幕偏移 | `{ offsetMs }` |
| `player.setOrientation` | 旋转 | `{ orientation: 'portrait'|'landscape' }` |

方向 B：原生 → HTML 控制层（驱动 UI 状态）

| 事件 | 载荷（建议） | UI 反应 |
|---|---|---|
| `player.state` | `{ playing, positionMs, durationMs, buffering }` | 更新播放键、进度、时间 |
| `player.tracks` | `{ audio:[], subtitle:[], embedded:bool }` | 音轨/字幕抽屉选项 |
| `player.subtitleMissing` | `{ reason }` | 字幕缺失状态（`nosub`） |
| `player.unsupported` | `{ codec, container }` | 播放不支持状态（`unsupported`） |
| `player.error` | `{ code, message }` | 错误提示与替代路径 |
| `player.ended` | `{ episode }` | 自动下一集或结束态 |

> 命名与生命周期需与 Android Agent 二次确认；本表为对齐用建议契约，不是已实现接口。

### 2.3 播放器状态项（首版）

- 播放 / 暂停、进度拖动、时间显示。
- 倍速：`0.5 / 0.75 / 1 / 1.25 / 1.5 / 2`。
- 音轨：日语原声 / 中文配音 / 评论音轨（示例）。
- 字幕：关闭 / 内嵌简体 / 内嵌繁体 / 外挂文件；**字幕偏移** ±0.5s；**字幕缺失**提示与加载外挂。
- 分集切换：上一集 / 下一集；无本地文件或编码不支持时禁用并标注。
- 横竖屏：控制层一键旋转；竖屏视频区 16:9、控制层在下方，横屏视频全屏、控制层覆盖。
- 手势与控件关系（接入约定）：单击播放区切换控制层显隐；双击左右分别快退/快进 10s；控制层显隐不阻断返回键（返回键总是优先关闭覆盖层）。原型实现单击播放/暂停、±10s 按钮与键盘方向键，手势层留给原生。

## 3. 设计与能力对齐要点

- 视觉：延续桌面端 `#090d0f` / `#75d2ad` / 8px 圆角 / `cubic-bezier(.2,.8,.2,1)`；显示字体换为 Android 窄体无衬线栈。
- 状态真实性：本地/远程、在线/离线、已匹配/待确认、扫描/刮削均在界面明确标注；未实现能力标 `Future` 或「未实现」。
- 不伪装成功：所有未接入操作的原型反馈均带「（示例）」。
- 示例数据：作品、评分、来源、扫描指标均为**设计演示数据**；角色图像为本地设计参考素材，来源与授权未确认，**不得随产品发布**。
- 素材：原型引用本地 `assets/`（`../assets/…`），不引用远程图片；图标为内联线性 SVG 家族。

## 4. 后端接入清单（以 `BACKEND_CAPABILITY_MATRIX.md` 为准）

- 已具备：`list_works` / `get_work` / `update_work`、`list/add/update/delete_library_root`、`scan_library_root` / `list_scan_jobs`、`list_unassigned_media_groups`、`recognize_media` / `list_match_candidates` / `confirm_match_candidate` / `set_work_field_lock`、`list/create/update/delete_external_tool` / `detect/test_external_tool` / `launch_media`、`get_setting` / `set_setting` / `get_dashboard`。
- 需新增：继续观看进度（`update_progress` + 进度表）、阅读器与阅读进度、制作人员 credits、下载/备份。
- Future / 未排期：WebDAV、网盘、探索发现页、本季日程、推荐。
- 合规红线：不做在线聚合、下载或分发（COMPLIANCE-001）。
