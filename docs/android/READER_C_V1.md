# Android 原生阅读 C 方案

2026-10-07 用户确认 Android 优先，采用 Kotlin 漫画阅读模块与 Readium 小说模块。复用现有 React 书架 / 探索 / 详情、Rust 来源 / 缓存及 SQLite；不替换 Windows 外部阅读器。

## 验收范围

- 漫画：纵 / 横连续滚动，横 / 竖逐页及右向左阅读；缩放、双击查看、长按放大；目录、页码滑块、前后章和连续阅读；有限预加载、单页失败重试；自动位置恢复、书签；已有下载缓存离线重开；常亮、亮度 / 夜间遮罩、音量键及自动滚动。
- 小说：Readium 排版，分页 / 滚动、字号 / 字体 / 行距 / 页边距 / 配色；章节目录与插图；正文定位、书签及重启恢复；在线 TXT / 目录 / 插图接入，以及已有 EPUB 缓存离线重开。
- 原生返回、横竖屏、进出后台、长内容、断网 / 重试、缓存损坏和存量数据库升级必须验证。打开不自动标记整本已读；阅读记录与来源 / 章节 / 分组绑定，不使用临时图片 URL 作身份。
- 个人阅读记录保存到本机 SQLite。既有下载缓存不改写成用户扫描文件；真实媒体不修改。影视 WebDAV 同步协议不扩展为阅读同步。

## 接入与验证

React 通过 Tauri 命令启动阅读会话；Kotlin 原生页面消费仅绑定本机、带会话随机令牌的 Rust 内容端点。端点只提供会话所属的章卷、页图和正文资源，并保存该会话的进度 / 书签；不接受任意文件路径或远程地址。

阅读器先使用已校验的完整缓存，无缓存时按需读取在线正文。小说在线内容适配为 Readium Publication，不要求先下载所有插图或生成完整 EPUB。迁移使用 0027，保留 0026 给既有个人同步，不修改已执行迁移。

Readium 固定 3.1.2，源码参考 71074ea0c424eabbc39a93b48a4cefe366f7741b，BSD-3-Clause；Kira 基础交互参考既有 MIT 快照，品牌与第三方素材不移植。漫画图片采用原生采样缩放视图。依赖的精确许可随实现核对并记录。

实现顺序：数据 / 记录契约与迁移 → 原生漫画 → Readium 小说 → 前端入口与设备验证 → 回归 / 文档 / 原子提交。本文为实施验收契约，不能作为已完成或已通过验证的证明。

## 本轮验证记录（2026-10-07）

运行环境为 `Genzo_Pixel9_API36` / `emulator-5554`，独立包 `com.genzo.android.readerqa`。IPC 实际核对数据目录 `/data/user/0/com.genzo.android.readerqa`；测试只使用两个自制作品、各两章卷，漫画含 1000×12000 长图，小说含 600 段中文和自制插图。正式包及用户真实媒体未操作。

| 检查 | 结果与实际范围 |
| --- | --- |
| `pnpm check` / `pnpm test` | 类型检查通过，21 个文件 / 92 项通过 |
| `cargo test --lib --locked` | Windows 共享 Rust 回归 306 通过 / 17 忽略 / 0 失败；含令牌 / Origin、书签分组隔离和 25→27 存量升级保留记录 / 迁移校验和 |
| `verify-android-reader.mjs` | 11 项阅读模式 / 长图 / RTL / 位置重开检查通过，原生屏幕截图已检查 |
| `verify-reader-controls.mjs` | 原生目录 / 书签 / 设置、前后章、实际音量键、Window 亮度 / 常亮、最新阅读入口通过 |
| `verify-reader-gestures.mjs` | 实际双指触摸缩放约 4.33 倍；长按从 1 倍到 2.5 倍、松手回到 1 倍；双击原生查看器与自动滚动通过 |
| `verify-reader-lifecycle.mjs` | 横竖屏和进程强制停止后恢复通过；小说旋转与重启保持 `#p57` / 第 357 段，漫画保持第 4 页 |
| `verify-reader-online.mjs` | 合成 TXT / 目录通过真实会话 HTTP 接入 Readium，300 段锚点 / 滚动 / 插图及原生放大查看器通过 |
| `verify-reader-recovery.mjs` | 模拟器临时飞行模式下缓存正文 / 目录可读；仅破坏自制 CBZ，原生单页失败提示 / 恢复文件 / 点重试 / 校验后重开通过，原始字节与网络设置恢复 |
| `verify-reader-entry.mjs` | 实际 React 章节 / 续读按钮、系统最近任务回前台、原生返回、连续阅读开关通过；作品状态 / 收藏未因阅读被改写 |
| Android 构建 | x86_64 / arm64 Rust 和 Kotlin / Gradle 调试打包通过；APK 签名和 16 KiB ZIP 对齐静态检查通过；arm64 未装真机 |

原生阅读器的小说旋转问题已修复：允许 Activity 按 Android 生命周期重建，通过保存的 Locator 恢复段落；只保持同章不足以验收，测试同时检查段落附近位置。Readium 内部使用 WebView，不能将本方案称为纯原生文本渲染。

最新固定构建输出：

- x86_64：`D:/DevTools/Android/Build/reader-gradle/app/outputs/apk/x86_64/debug/app-x86_64-debug.apk`，SHA256 `B1A3544082FB2CD9842870DD446E97F0D1465682C77B394A8BB8E5BF08F98491`。
- arm64：`D:/DevTools/Android/Build/reader-gradle/app/outputs/apk/arm64/debug/app-arm64-debug.apk`，SHA256 `3ADD334AD5F27C46AFC95CF89341FA0B7ED4DA1E08817CA2B6115073B30124D5`。
- 检查日志 / JSON / 截图：`D:/DevTools/Android/Build/qa/reader-c/` 各脚本对应子目录。早期失败用于定位，当前各 `result.json` 为通过记录；不要以旧 APK 或早期失败的截图证明最新实现。
- 同哈希固定备份：`D:/DevTools/Android/Build/artifacts/Genzo-reader-c-20261007-x86_64-readerqa-B1A35440.apk` 与 `Genzo-reader-c-20261007-arm64-readerqa-3ADD334A.apk`。

## 复现方式与边界

`scripts/build-reader-qa.ps1 -Install` 仅安装到 `emulator-5554`；`-Target aarch64` 只构建 arm64 独立包。脚本保持 Kotlin / JNI 命名空间 `com.genzo.android`，仅 Gradle applicationId 隔离测试数据，启用 `custom-protocol` 并嵌入本次前端。测试脚本均核对 QA 私有目录，不能指向正式包。

准备合成数据时，将 `GENZO_READER_FIXTURES` 设为**新的绝对目录**，执行 Rust `book_content::tests::export_native_reader_fixtures` 测试；该测试拒绝覆盖已有 `genzo.db`。仅把生成的 `genzo.db` 与 `reading-cache` 放入独立测试包私有目录。日常回归保留已经准备的 QA 数据以检验重启恢复，不重复播种或清空记录。

双指测试使用 `scripts/fixtures/ReaderGesture.java` 的 shell 触摸注入器；用 SDK `android.jar` 编译后经 D8 转换为 dex、打成 jar，推送至 `/data/local/tmp/genzo-reader-gesture.jar`。其余入口、控件与生命周期检查使用 Playwright 连接 QA 主 WebView 和 ADB 原生输入；Readium 生成的 WebView 可用于检查实际段落 / 插图，但不能以网页 DOM 替代原生屏幕检查。

本轮交付已有来源章节和 Genzo 缓存的阅读基础。真实第三方服务、复杂排版、任意外部 EPUB / SAF / WebDAV 导入、超大图片 / 全机型性能、16 KiB 页设备运行与长时间真机体验未据本轮模拟器结果宣称完成；它们按后续具体样本验收。功能扩展与界面优化沿用现有 ReaderActivity / 两类 Surface，不需要重做整个书库；Kotlin 和 SDK 改动仍需重新打包验证。

## 后续实体机预览（2026-10-07）

用户明确要求在已连接实体机查看。既有 arm64 独立测试包已安装到一加 PLK110 / Android 16；该包安装前不存在，确认新私有目录无数据库后才准备合成数据，未覆盖普通应用。实际启动并观察到 Readium 在线小说正文、阅读位置和原生工具栏，页面保留给用户操作。自动入口检查遇到转场 / DOM 变化超时，未报为通过；此次是安装 / 启动 / 显示检查，不代替完整真机回归。记录在 `D:/DevTools/Android/Build/qa/reader-c/phone-preview/`。

实体机可用桌面快捷方式 `F:/desktop/Genzo 手机投屏.lnk` 打开“Genzo 实体机画面”。使用已核对官方 SHA256 的 scrcpy 5.0 便携版，指定本轮手机序列号，保持原分辨率并限制最高 60 fps；禁用音频 / 剪贴板自动同步。可鼠标操作、右键返回、F11 全屏，用 Windows 截图工具截取窗口。启动器和日志在 `D:/DevTools/Android/Tools/open-genzo-phone.ps1` / `Build/qa/phone-mirror/`；此工具不捆绑进 Genzo APK。
