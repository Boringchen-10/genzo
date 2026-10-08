# Android v0.5.1 发布记录

日期：2026-10-08。用户指定将本轮安卓更新打包为 v0.5.1，用于实际用户分发；只交付正式 APK，不携带测试数据。Windows 安装器保留 v0.5.0，主工作区未提交的桌面 / 设计改动不纳入本版。

## 产物

- 文件：`Genzo_0.5.1_android_arm64-v8a.apk`，Android 8.0及以上 /64位 ARM，包名 `com.genzo.android`。
- versionName `0.5.1`，versionCode `5001`；Release /非 debuggable，R8与资源收缩开启。
- 文件大小：74,869,842字节（约71.4MiB）。SHA-256：`d599124d1c7952f1c6f3fa1ee9e73b1e839ff2b1b673c258e3a55e99071a476b`。
- 固定发布签名证书SHA-256：`cee90e5f49edc18217ec2d1f7cdf360f50b61af1e99e4eefdb0837b549c13cdb`。签名私钥与密码文件只在仓库外的本机签名目录保存，不纳入源码、APK或发行附件。
- 发布附件仅APK与`SHA256SUMS.txt`；截图、日志、样本与中间调试包不分发。

## 本轮内容

- 原生漫画 / Readium 小说阅读、位置 /书签 /续读；漫画渐进整话预取、话末准备下一话前6张、在途复用和及时取消。
- 漫画状态区 /居中 /全段缩放 /加载中菜单、小说位置与大跳转、Bangumi封面及分类 /评论缓存、COPY连接 /线路 /评论修复。
- Android-only前端入口，强制真实Provider，排除桌面mock与public演示 /设计参考图；正式关于显示实际版本 /GPLv3，关闭WebView调试。保留本地 /WebDAV播放器、SAF、个人资料分享等已完成能力。
- 用户数据库不随APK交付，正常启动初始化 /迁移；本轮不修改已运行迁移，不清库，不复制实体机或模拟器数据库。

## 验证

| 项目 | 结果与边界 |
| --- | --- |
| TypeScript /前端 | 类型检查通过，96项单元测试通过。Android生产前端约408kB JS，仅入口 /CSS /图标资源；不含原型页面与mock作品文本。 |
| Rust | v0.5.1宿主321项通过，18项外网 /实际媒体环境用例忽略。 |
| Android构建 | arm64 Rust release /Kotlin release /R8 /lintVital /资源收缩通过；使用固定签名生成正式APK。 |
| APK元数据 | aapt确认包名 /5001 /0.5.1 /min26 /target36 /arm64-v8a /Genzo标签。签名验证与16KiB ZIP对齐通过。 |
| 包内数据 | ZIP不含数据库、CBZ /EPUB样本、私钥或demo /design /fixtures目录；编译前端不含mock作品、开发验证和原型文案。Readium /LibVLC自身运行资源保留。 |
| 实体机正式包 | 一加PLK110 /Android16首次安装启动成功，版本0.5.1，无DEBUGGABLE；封面与阅读入口实际运行。用户在正式包确认小说正文正常显示，不把截图空白推断为正文故障。 |
| 阅读功能回归 | 本轮功能在此前相同内核 /代码的独立包验证：整话36页 /真实52页、跨话边界 /在途复用 /失败恢复 /并发4、真实02→03切换、状态 /缩放 /离线四模式。详细记录见`docs/android/COMIC_KIRA_FOLLOWUP.md`。这些是独立包证据，不冒充正式包全套自动化。 |

尚未覆盖所有厂商 /Android版本、真实16KiB页设备和所有外网服务。首次未缓存内容仍受网络影响；Bangumi账号同步和Kazumi规则播放未实现。正式包关闭CDP与QA控制入口，测试数据和测试状态不发布。

## 升级与构建

- 以后普通包沿用本次固定签名，可覆盖升级并保留普通包数据。
- `com.genzo.android.readerqa`独立测试包与正式包数据不同，本次不将其数据打入普通包。早期普通调试原型签名不同，不能直接覆盖；不自动卸载旧包来丢弃数据。
- 本机使用`./scripts/build-android-release.ps1`；签名目录须提供已有`genzo-release.p12`与`store-password.txt`，脚本不自动更换签名。
- 构建过程中生成的QA APK只用来编译共享优化内核，不安装、不发布；最终正式包使用Release /普通包名 /固定发布签名。版本字段与生成的Android版本同步。
