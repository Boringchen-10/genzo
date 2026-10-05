# Android 接入个人同步 V1

此文档是共享核心接入说明，不代表安卓功能已实现或双端联调已通过。

1. 获取 `docs/SYNC_PROTOCOL_V1.md`、`docs/sync-v1`、`crates/genzo-sync` 和新增 `0026_personal_sync.sql`。已有迁移 1–24 不能替换；Android 分支已使用 0025_android_saf.sql，因此个人同步统一使用 0026，Windows 留出 0025 编号。Android 沿用同一 `works`/分集/媒体/进度结构，原 ID 与 SAF 绑定保留。
2. 在应用初始化后调用 `store::initialize`，使用本机唯一设备 ID。Tauri 宿主可复用 Windows 命令语义，但 `credentials.rs` 的 Windows Credential Manager 不能直接调用；现有 Android 分支已有 `CredentialStore.kt` / `android_bridge::credential_call` 的 Keystore 加密适配，可复用并核对同步凭据 ID 前缀，不重复造存储。核心只接收当前请求凭据，不将其写入 SQLite/载荷。
3. 连接流程调用 `store::connect`（先读远端），之后 `store::synchronize`。同一宿主串行化运行；网络和前台触发遵守 Android 生命周期，不后台常驻高频轮询。暂停保留日志，启动/前台/离线补传重新请求。
4. 原生播放器的真实进度采样与 `store::record_session` 在同一 SQLite 事务；一段观看会话固定 UUID，结束调用 `finish_sessions`。打开 URI 不算已观看。不要以 Android 原始文件名、集号或 Windows 路径映射进度。
5. SAF URI 用本机媒体 ID → 授权 URI 表。当前可用版本确认是 Windows `bind_media` 的完整文件 SHA-256；Android 须提供 SAF 流式等价适配与稳定文件属性绑定。协议允许 `manual:<UUID>`，但此轮没有交付手工跨端版本 ID 的绑定命令/界面，不能据此假定可直接调用。现有采样指纹不满足版本要求；未确认版本只保留观看会话，不能自动续播。
6. 作品标题不能去重；公共主锚点与共享 entity 映射由同一个核心处理。同步拉入的无本地文件作品可浏览资料，不能伪造可播放入口。图片仍由 Android 本地缓存和 WebView 资产 URL 适配。

验证顺序：共享 fixtures → 旧 Android 库升级 → 空手机加入 → 两端独立识别同 Bangumi/TMDB 主锚点 → PC 整理手机可见 → 收藏与笔记双向/并发 → 相同视频字节/分集跨设备续播 → 不同剪辑拒绝套用 → 离线/重启/认证过期 → 删除传播与服务器恢复。

当前 Android 分支事实须由接入方核对，不能仅凭历史 `ANDROID_BASELINE_V0.5.0.md` 判断现状。未向其他任务发送消息或修改其工作树；正式联调需用户授权协调和实际运行环境。

2026-10-04 只读核对 `codex/android-first`（8f3c146）：已有 `0025_android_saf.sql`、SAF 文档绑定和 Keystore 凭据桥。当前同步迁移使用 0026 避免版本冲突；未修改 Android 工作树。共享核心原生测试与 Android 应用接入/联调分别记录。

协议初始交付 `27a1113`；核心初始提交 `9dde815`，实际接入请以 `d10c551e203b600e9529ce1d6ab3f584dad0baca` 或本分支后续提交为准，包含测试夹具可移植和 JSON 评分 `8`/`8.0` 等价修复。仅获取最初核心提交会漏掉已验证修复。测试结果见 [SYNC_V1_VALIDATION.md](SYNC_V1_VALIDATION.md)。
