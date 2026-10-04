# Genzo Android — 前端 → 原生（Codex）对接说明

面向：负责安卓原生的 Agent（Codex）。
来自：前端侧（`android/index.html` 及其规范）。
目标：把当前**纯静态原型**变成**真正可用**的应用。原型是 UI 与交互契约，不是成品；真实数据与播放能力需要你在原生层落地。

---

## 0. 一句话结论

前端已冻结 UI、导航、状态与 Token；**缺的是原生能力**：真实数据源、文件目录授权与扫描、以及原生视频播放。
请在开工前先回答第 6 节的 7 个问题——其中第 1 题（WebView 承载 vs 原生重写）决定所有后续工作量。

---

## 1. 前端现状与"可用"差距

| 能力 | 原型现状 | 要"真正可用"还缺什么 |
|---|---|---|
| 作品/收藏/详情/分集 | 静态 JS 数组 `WORKS` 演示数据 | 真实数据接口（见 §4） |
| 继续观看/进度 | 前端示例值，不持久化 | 进度读写 + 进度表 |
| 来源管理/扫描/待整理 | 仅界面与状态外壳 | 目录授权、扫描引擎、识别接口 |
| 播放器 | HTML 控制层 + `.gz-surface` 占位 | ExoPlayer 视频面 + 事件桥 |
| 搜索/筛选 | 前端内存过滤 | 可选服务端筛选 |
| WebDAV/网盘/探索/阅读器 | 标 `Future`，无入口 | 首版不做 |

**结论**：原型的按钮/导航/状态都是真的，但所有数据调用都是本地的。接入 = 把本地调用替换为桥接调用。

---

## 2. 建议架构（需你确认，见 §6-1）

**方案 A（推荐，改动最小）**：WebView 承载 `android/index.html`，原生实现：
- 把 HTML/CSS/JS 打包进 `assets/`，`WebView` 加载 `file:///android_asset/android/index.html`。
- 注入 JS 桥（§3），前端把 `WORKS` 等本地数据改为桥接调用。
- 视频：原生 `SurfaceView/TextureView` 通过 `WebView` 下方图层（behind）承载，`.gz-surface` 区域仅作定位锚点；用 `WebView.setBackgroundColor(TRANSPARENT)` + z-order 让视频面透出。

**方案 B**：Kotlin/Compose 按 `DESIGN_TOKENS.md` + `COMPONENTS_STATES.md` + `NAVIGATION.md` 原生重绘，事件契约（§5）不变。
- 优点：性能/播放体验最好；缺点：UI 需要重做一遍，规范文档即实现依据。

**前端侧态度**：A 能最快到"可用"；B 是长期正确解。若你已在写 Compose，直接按 B 走，规范已备齐。

---

## 3. 桥接契约（方案 A 下必须实现）

### 3.1 通道
- 原生 → 前端：`webView.addJavascriptInterface(nativeApi, "GenzoNative")`；调用前端：`webView.evaluateJavascript("window.__genzo.on(<eventJson>)", null)`。
- 前端 → 原生：`GenzoNative.call(method, argsJson)`（同步返回 void；结果通过事件异步回推）。

### 3.2 前端 → 原生（请求方法）

| method | args | 说明 |
|---|---|---|
| `library.listWorks` | `{query,type,sort,filter}` | 列表（对应 `list_works`） |
| `library.getWork` | `{workId}` | 详情（`get_work`） |
| `library.updateWork` | `{workId,fields}` | 编辑（`update_work`） |
| `favorites.toggle` | `{workId,fav}` | 收藏 |
| `progress.list` / `progress.update` | `{}` / `{workId,episode,positionMs,durationMs}` | 继续观看（NEW_REQUIRED） |
| `sources.list` / `sources.add` / `sources.remove` / `sources.setEnabled` | `{}` / `{kind,uri,label}` / `{id}` / `{id,enabled}` | 来源管理 |
| `sources.pickDirectory` | `{}` | 触发 SAF 目录选择，回推 `{uri}` |
| `sources.scan` / `sources.scanStatus` | `{id}` / `{id}` | 扫描（`scan_library_root`，无暂停语义） |
| `inbox.list` | `{}` | 待整理分组（`list_unassigned_media_groups`） |
| `inbox.recognize` / `inbox.candidates` / `inbox.confirm` | `{groupId}` / `{groupId,query}` / `{groupId,candidateId,fields}` | 识别/候选/确认 |
| `detail.setFieldLock` | `{workId,field,locked}` | 字段锁定 |
| `player.load` | `{workId,mediaFileId,episode,uri}` | 装载 |
| `player.play` / `pause` / `seek` / `rate` | `{}` / `{}` / `{positionMs}` / `{speed}` | 播放控制 |
| `player.track` | `{kind:'audio'\|'subtitle',index,externalUri?}` | 音轨/字幕 |
| `player.subtitleOffset` | `{offsetMs}` | 字幕偏移 |
| `player.orientation` | `{orientation:'portrait'\|'landscape'}` | 旋转 |
| `tools.launch` | `{tool,targetUri}` | 外部工具打开（`launch_media`） |
| `settings.get` / `settings.set` | `{}` / `{key,value}` | 设置/主题 |

### 3.3 原生 → 前端（事件回推）

| event | payload | 前端反应 |
|---|---|---|
| `works` / `work` | `{items:[…]}` / `{work}` | 渲染列表/详情 |
| `sources` | `{items:[{id,kind,label,enabled,status,error?}]}` | 来源列表 |
| `scan.progress` | `{id,phase,scanned,total,matched,pending,errors:[…]}` | 扫描状态（进行中/完成但有失败/重试） |
| `inbox.groups` / `inbox.candidates` | `{items:[…]}` | 待整理/候选 |
| `progress` | `{items:[…]}` | 继续观看 |
| `player.state` | `{playing,positionMs,durationMs,buffering}` | 控制层状态 |
| `player.tracks` | `{audio:[…],subtitle:[…],embedded:bool}` | 音轨/字幕抽屉 |
| `player.ended` | `{episode}` | 下一集/结束 |
| `player.error` | `{code,message}` | 错误提示 |
| `player.unsupported` | `{codec,container}` | 播放不支持态 |
| `player.subtitleMissing` | `{reason}` | 字幕缺失态 |
| `toast` | `{text,kind}` | 全局反馈 |
| `theme` | `{mode}` | 跟随系统主题 |

> 命名可改，但**必须先冻结**：前端与原生用同一份常量表。原型当前用 `window.goBack` 与 `CustomEvent('genzo:player-load')` 作占位，接入时统一替换为本表。

---

## 4. 数据契约（前端需要的字段）

前端渲染所需最小字段集（与 `BACKEND_CAPABILITY_MATRIX.md` 对齐）：

```
Work {
  id, title, sub(原名), type(动漫/电影/电视剧), year, status(连载/完结),
  poster(url|null), webRating(0-10), tags[], desc,
  eps(total), local(本地可用集数),
  progress?: { episode, pct }
}
Source { id, kind(local|webdav|cloud), label, path, enabled, status, error? }
ScanStatus { id, phase, scanned, total, matched, pending, errors[] }
MediaGroup { id, fileCount, sampleNames[], status(pending) }
Candidate { id, title, sub, year, confidence, source }
```

- `poster`：本地文件用 `content://` 或前端可读的 `file://`；网络图另议（合规红线禁止在线聚合/分发）。
- 分页：列表 >50 项需分页/虚拟化（前端已按此约束设计）。

---

## 5. 播放器接入要点（详见 `UI_HANDOFF.md` §2）

- 视频面：ExoPlayer + `SurfaceView`（默认）或 `TextureView`（需要动画/变换时）；置于 WebView 之下或用原生 Activity。
- 横竖屏：竖屏视频区 16:9、控制层在下方；横屏全屏、控制层覆盖。旋转由 `player.orientation` 驱动，同时响应设备旋转（`sensorLandscape`/`fullSensor` 需定策略）。
- 手势（原生实现，控制层只读状态）：单击播放区切换控制层显隐；双击左右 ±10s；竖向调亮度/音量（建议）。**返回键永远优先关播放器**，不先退出全屏。
- 字幕：内嵌轨 + 外挂（ass/srt），支持偏移；缺失时回推 `player.subtitleMissing`。
- 不支持编码：回推 `player.unsupported`，前端显示遮罩 + 外部工具替代路径（`tools.launch`）。
- 进度：播放中定期 `progress.update`（建议 5–10s 及暂停/退出时）。

---

## 6. 需要 Codex 拍板 / 回答的问题（开工前）

1. **架构**：WebView 承载（方案 A）还是原生重写（方案 B）？（决定工作量与前端改动范围）
2. **后端归属**：本地数据/扫描引擎由你实现，还是已有后端/本地服务可复用？（`list_works` 等接口是 HTTP 还是进程内？）
3. **目录授权**：用 SAF（`ACTION_OPEN_DOCUMENT_TREE`）持久化权限，还是限定 `READ_MEDIA_*` + 应用私有目录？（影响 WebDAV/网盘 Future 的设计）
4. **扫描实现**：`MediaStore` 查询还是自建文件遍历？大库（>1 万文件）的进度回推节流策略？
5. **播放器**：ExoPlayer 版本、是否需 DRM、字幕渲染用 ExoPlayer 还是自定义 View？
6. **主题**：是否透传系统深/浅到 `data-theme`？状态栏/导航栏颜色策略？
7. **桥接命名**：接受 §3 的方法/事件命名，还是你已有既定命名？（需返回一份冻结常量表）

---

## 7. 验收标准（"真正可用"的最低线）

- [ ] 从真实来源目录扫描出作品，列表/详情/分集显示真实数据（非演示数据）。
- [ ] 本地视频能在应用内播放，进度可拖动，播放进度持久化并在"继续观看"出现。
- [ ] 收藏、来源启停、扫描失败重试、待整理确认走通真实读写。
- [ ] 权限拒绝、鉴权失败、扫描失败、字幕缺失、播放不支持均有明确状态与补救路径（`COMPONENTS_STATES.md`）。
- [ ] 返回键、横竖屏、安全区行为与规范一致（`NAVIGATION.md`）。

---

## 8. 边界与红线

- 首版不做：WebDAV/网盘、探索发现、漫画/轻小说/书架阅读器（标 `Future`）。
- 合规：不做在线聚合、下载或分发（COMPLIANCE-001）。
- 素材：`assets/` 内角色图为**设计演示素材**，授权未确认，禁止随产品发布；真实封面由数据层提供。
