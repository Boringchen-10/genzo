# 用 Android Studio 查看与调试 Genzo

用户已于 2026-10-04 确认 Studio 显示工程。代码位于隔离工作树，不是 Windows 主工作区：

```text
H:\二次元阅读器\.tmp\android-first\src-tauri\gen\android
```

## 打开方式

从工作树根目录的 PowerShell 执行：

```powershell
.\scripts\build-android.ps1 -Studio
```

脚本准备 D 盘工具 / 缓存环境、调用 `tauri android build --apk --target aarch64 --debug --open`，打开 Studio 并保持 Tauri 原生构建桥运行。**该 PowerShell / Tauri 进程在 Studio 编译期间须保持运行**；只打开目录能看源码，但不足以确保 Rust 构建任务工作。[Tauri 官方 IDE 开发说明](https://v2.tauri.app/develop/#using-xcode-or-android-studio)

脚本启动的是包含已编译 React 资源的调试包。正式页面需要前端热更新时再切 `tauri android dev --open` 和独立开发端口；当前不与 Windows 现有开发服务争用端口。

Studio 首次出现 Trust Project 时信任此隔离工程。SDK 为 `D:\DevTools\Android\Sdk`；Gradle JDK 通过本地 `.gradle/config.properties` 固定为已有 `D:\DevTools\Android\Java\jdk-17.0.20.1+1`，不是 Studio 的 IDE 运行时 JBR。两个 JVM 的用途不同。

## 可以查看的位置

- `app/src/main/java/com/genzo/android/GenzoPlugin.kt`：SAF 目录 / 文件授权与原生桥。
- `CredentialStore.kt`：Keystore AES-GCM 密文存储。
- `PlayerActivity.kt`：LibVLC、视频 surface、轨道 / 字幕 / 进度的验证控件。
- `app/build.gradle.kts`：Android SDK 与 LibVLC 依赖。
- **Build**：Gradle / Kotlin 构建结果；Rust 任务通过 Tauri CLI，错误也可查看 `D:\DevTools\Android\Build\studio-bridge.log`。
- **Logcat**：选择连接的一加设备及 `com.genzo.android` 进程。不要对外粘贴可能含真实来源 / URL 的完整日志。
- **Running Devices**：可以在已连接真机运行时查看屏幕；具体可用性依 Studio / 手机连接状态。当前实际验证由真机 ADB 完成，没有宣称已验收模拟器。

React 页面在工作树 `src/android/`，共享 Rust 在 `src-tauri/src/`；Studio 的 Android 视图不一定显示它们，切 Project 视图或在当前编辑器查看。

## D 盘与已有 Studio 窗口

SDK、NDK、Cargo、Gradle、APK 构建输出和测试样本均使用 D 盘。构建根目录为 `D:\DevTools\Android\Build\gradle-genzo`，Rust target 为 `D:\DevTools\Android\Build\genzo`；Tauri 成功提示可能仍显示模板的 H 盘路径，实际 APK 在 D 盘。

脚本的 `STUDIO_PROPERTIES` 与已有用户配置中的 `idea.properties` 仅覆盖 system / log 两个路径，指向 `D:\DevTools\Android\AndroidUserHome\studio-system`，保留其余配置；先直接启动 IDE，使 D 盘 TEMP 等环境变量继承，再连接 Tauri。**如果已有 Studio 进程，打开请求会交给旧进程，旧进程不会重新读取这些配置**。首次使用时关闭 Studio 后通过上面脚本重新打开；不要删除现有 IDE 配置或用户已下载的 JBR。2026-10-04 实际日志已确认 system / log / Gradle JDK 与 sync 临时文件均在 D 盘。

本地 `local.properties`、`.gradle` 和 `.idea` 不提交 Git；可重复的环境准备在脚本中。若 SDK / JDK 目录与约定不同，通过 `GENZO_ANDROID_TOOLS` 更改根目录，并同步实际版本路径。

项目本地配置还保存 Node、Cargo、NDK 链接器及 Rust 链接参数；Gradle `BuildTask` 使用这些配置调用同一 Tauri CLI，避免 Studio 继承旧环境后使用不存在的 `cc`。实际 `rustBuildArm64Debug` 已通过，日志为 `D:\DevTools\Android\Build\studio-rust-bridge-check-final.log`。

2026-10-04 重启过程中发现 Studio 自身一个 JAR 损坏。已从校验匹配的官方安装包恢复该文件并检查全部 382 个 `lib/*.jar`，工程重新显示。此次只修复安装文件，不重建用户配置；具体校验和与备份位置见 `VALIDATION.md`。
