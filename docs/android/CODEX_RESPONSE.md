# 给 OpenDesign 的 Android 开发回应

后续接入更新：React可操作页面已在电脑模拟器连接真实库 / 来源 / 手工整理 / 收藏 / 个人记录，本地稳定媒体ID进度与首页续播已验收。用户当前只用模拟器继续设计，暂不部署手机；当前页面 / 原生边界和剩余能力见 `FRONTEND_PREVIEW.md`，此前七项架构决定继续适用。

2026-10-06 后端接入：冻结播放控制 / 字幕候选 / 单文件选择、WebDAV 原流鉴权 Range、四类事件、多来源目录定位已实现并在模拟器验证。本周日历用实时 Bangumi `/calendar` + SQLite 6 小时缓存；历史季度仍沿用 PC 概览，未更新 bangumi-data。PC 分类已有，无需迁移；作者、sourceScope、真实浏览时间未扩大共享结构。具体操作、实测范围、待办与结构约束见 [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md)，以下第一阶段记录不代表当前全部能力仍待实现。

2026-10-04。针对 `design/open-design/android-v1/CODEX_PROMPT.md` 和 `CODEX_HANDOFF.md`；实际基线为 Windows `v0.5.0`。交付中的根能力矩阵使用较早版本结论，不能代替代码审查。

1. **架构**：Tauri 2 Android WebView + React / TypeScript，沿用方案 A 的 Web 页面方向。按静态 HTML 的布局、Token 和交互实现 React 页面；不直接装载 `file:///android_asset` 静态演示数组，也不整体重写 Compose。播放器使用独立原生 Activity；OpenDesign 已允许此边界。
2. **后端**：复用进程内 Rust / SQLite。作品、收藏、分集、识别 / 候选 / 纠错 / 刷新、WebDAV、扫描任务和观看进度表在 v0.5.0 已有；安卓新增 SAF 与内置播放接入。没有供前端直连的独立 HTTP 业务服务器。播放的 Rust 本地 Range 转发器是内部资源边界。
3. **目录授权**：`ACTION_OPEN_DOCUMENT_TREE` + 持久只读权限。手动外挂字幕使用 `ACTION_OPEN_DOCUMENT`。首版不要求 `MANAGE_EXTERNAL_STORAGE`，也不申请写权限。返回 URI 与文档 ID，不能把 URI 转盘符路径。
4. **扫描**：通过 `DocumentsContract` 枚举授权目录树，再接现有 Rust 索引 / 文件名解析 / 任务模型。首版不用 MediaStore 代替用户明确授权的目录范围。枚举总数未知时显示已发现数，不能编造百分比；正常进度通知至多每 500 ms 一次，状态结束 / 失败立即通知。现有任务快照支持 1 秒轮询，事件实现后仍保留快照以恢复前台 / 进程重建。
5. **播放**：主内核选 LibVLC 3.7.7；Media3 1.11.1 和 libmpv 已评估，依据见 `PLAYER_EVALUATION.md`。不接 DRM，不实现自有字幕解码 / 渲染；音视频与 ASS/SSA 均由内核处理。先验收前台播放，后台服务 / PiP 后续规划。
6. **主题**：React 用 `matchMedia('(prefers-color-scheme: dark)')` 跟随系统，设置允许 `system/light/dark` 并持久化；在页面根设置 `data-theme`，原生播放控件同步选择。系统状态栏 / 导航栏按真实窗口 inset 与主题处理，不固定模拟手机壳空白。此为正式接入契约，原型只验证深色诊断页。
7. **桥接**：统一 Tauri `invoke` Promise 和 `listen`，不引入 `GenzoNative.call` / `evaluateJavascript` 第二套通道。方法、参数、事件名称冻结在 `BRIDGE_CONTRACT_V1.md`；已有 `src/api.ts` 作为真实共享适配器。读取返回结果，不用 `works/work` 事件模拟 RPC；扫描与播放等持续变化才使用事件。

## 需要同步到设计的结论

- **范围**：用户已明确要求首版 WebDAV，来源页面需提供 WebDAV 连接 / 测试 / 凭据更新 / 扫描 / 播放状态。网盘经 WebDAV 服务接入，账号 / API 直连需另行确认具体服务。探索 / 漫画 / 轻小说阅读仍为 Future。
- **数据**：作品个人状态与连载状态分开；动漫 / 电影 / 电视剧由视频作品类别表达，不把共享 `mediaType=video` 当全部分类。观看进度的身份是 `mediaFileId`，不是作品标题或“第几集”；一个作品 / 集可以有多个文件版本。
- **封面**：由受限应用私有图片缓存经 `convertFileSrc` 提供 WebView 地址；不假设任意 `content://` / `file://` 都能直接用于 `<img>`。网络作品资料与用户媒体来源分开。
- **控件**：正式原生播放器按 Token / 区域 / 交互规范实现，不在 React 上叠原型视频占位。不承诺此次实现未确认的 DRM、后台播放、PiP、自动连播或亮度手势。
- **素材**：不发布来源与授权未确认的角色图；使用用户资料封面和自有占位。

## 第一阶段事实与后续接入（2026-10-04 历史记录）

真机已经验证构建 / 安装 / 启动、Rust invoke、基线 24 迁移及新增 0025 / 完整性、强制停止后的数据库 / 缓存 / Keystore 持久化、持久 SAF / 未授权 URI 拒绝，以及 LibVLC 核心播放链路。递归视频 / 字幕索引、元数据复用、稳定 ID 与手工建作品 / 收藏 / 备注保留也已在真机和模拟器合成目录验证。目录分组、自动刮削 / 纠错手机闭环、稳定媒体 ID 播放进度、正式页面与安卓 WebDAV 播放业务尚未完成；不能把当前诊断 APK 当作上文整套能力已交付。

用户完成目录选择后的最新持久来源为 `Download/GenzoPrototype` 子树，测试只读取该目录的合成样本。初期曾观察到 Download 根树授权；未读入其他真实视频内容或创建它们的索引。
