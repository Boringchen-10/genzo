# 用 Android Studio 查看与调试 Genzo

用户已于 2026-10-04 确认 Studio 显示工程。代码位于隔离工作树，不是 Windows 主工作区：

当前先在电脑模拟器展示可操作前端，暂不安装实物手机；页面、测试包与编辑位置见 `FRONTEND_PREVIEW.md`。下列真机操作保留为较早阶段记录，当前运行目标选 `emulator-5554`。

```text
H:\二次元阅读器\.tmp\android-first\src-tauri\gen\android
```

## 打开方式

从工作树根目录的 PowerShell 执行：

```powershell
.\scripts\build-android.ps1 -Studio -Target x86_64
```

脚本准备 D 盘工具 / 缓存环境、调用 `tauri android build --apk --target x86_64 --debug --open`，打开 Studio 并保持 Tauri 原生构建桥运行。**该 PowerShell / Tauri 进程在 Studio 编译期间须保持运行**；只打开目录能看源码，但不足以确保 Rust 构建任务工作。[Tauri 官方 IDE 开发说明](https://v2.tauri.app/develop/#using-xcode-or-android-studio)

脚本启动的是包含已编译 React 资源的调试包，React修改后重新构建安装更新。独立开发端口的热更新尝试尚未验收，不保留未验证入口；当前不与 Windows 现有开发服务争用端口。

Studio 首次出现 Trust Project 时信任此隔离工程。SDK 为 `D:\DevTools\Android\Sdk`；Gradle JDK 通过本地 `.gradle/config.properties` 固定为已有 `D:\DevTools\Android\Java\jdk-17.0.20.1+1`，不是 Studio 的 IDE 运行时 JBR。两个 JVM 的用途不同。

## 可以查看的位置

- `app/src/main/java/com/genzo/android/GenzoPlugin.kt`：SAF 目录 / 文件授权与原生桥。
- `CredentialStore.kt`：Keystore AES-GCM 密文存储。
- `PlayerActivity.kt`：LibVLC、视频 surface、轨道 / 字幕 / 进度的验证控件。
- `app/build.gradle.kts`：Android SDK 与 LibVLC 依赖。
- **Build**：Gradle / Kotlin 构建结果；Rust 任务通过 Tauri CLI，错误也可查看 `D:\DevTools\Android\Build\studio-bridge.log`。
- **Logcat**：选择 `Genzo_Pixel9_API36 / emulator-5554` 及 `com.genzo.android` 进程。不要对外粘贴可能含真实来源 / URL 的完整日志。
- **Running Devices**：当前使用可见独立模拟器窗口，ADB安装 / 启动与前端操作已验收；Studio嵌入设备窗口的GUI操作尚未验收。

React 页面在工作树 `src/android/`，共享 Rust 在 `src-tauri/src/`；Studio 的 Android 视图不一定显示它们，切 Project 视图或在当前编辑器查看。

## D 盘与已有 Studio 窗口

SDK、NDK、Cargo、Gradle、APK 构建输出和测试样本均使用 D 盘。构建根目录为 `D:\DevTools\Android\Build\gradle-genzo`，Rust target 为 `D:\DevTools\Android\Build\genzo`；Tauri 成功提示可能仍显示模板的 H 盘路径，实际 APK 在 D 盘。

脚本的 `STUDIO_PROPERTIES` 与已有用户配置中的 `idea.properties` 仅覆盖 system / log 两个路径，指向 `D:\DevTools\Android\AndroidUserHome\studio-system`，保留其余配置；先直接启动 IDE，使 D 盘 TEMP 等环境变量继承，再连接 Tauri。**如果已有 Studio 进程，打开请求会交给旧进程，旧进程不会重新读取这些配置**。首次使用时关闭 Studio 后通过上面脚本重新打开；不要删除现有 IDE 配置或用户已下载的 JBR。2026-10-04 实际日志已确认 system / log / Gradle JDK 与 sync 临时文件均在 D 盘。

本地 `local.properties`、`.gradle` 和 `.idea` 不提交 Git；可重复的环境准备在脚本中。若 SDK / JDK 目录与约定不同，通过 `GENZO_ANDROID_TOOLS` 更改根目录，并同步实际版本路径。

项目本地配置还保存 Node、Cargo、NDK 链接器及 Rust 链接参数；Gradle `BuildTask` 使用这些配置调用同一 Tauri CLI，避免 Studio 继承旧环境后使用不存在的 `cc`。实际 `rustBuildArm64Debug` 已通过，日志为 `D:\DevTools\Android\Build\studio-rust-bridge-check-final.log`。

2026-10-04 重启过程中发现 Studio 自身一个 JAR 损坏。已从校验匹配的官方安装包恢复该文件并检查全部 382 个 `lib/*.jar`，工程重新显示。此次只修复安装文件，不重建用户配置；具体校验和与备份位置见 `VALIDATION.md`。

## 同时使用电脑模拟器与真机

本机已创建并启动 `Genzo_Pixel9_API36`：Android 16 / API36、Google APIs x86_64 镜像 revision 7、Pixel 9 1080×2424 / 420 dpi、4 GiB 内存 / 4 核。WHPX 硬件虚拟化检查通过，未修改 BIOS 或 Windows 功能。

系统镜像在 `D:\DevTools\Android\Sdk\system-images`，AVD 在 `D:\DevTools\Android\Avd`；显式 `ANDROID_EMULATOR_HOME` 指向 `D:\DevTools\Android\AndroidUserHome`。已有 C 盘配置保留，仅本轮新建的三个模拟器元数据文件移到 D 盘。自动 GPU 模式在 VLC 测试后出现 external memory import 错误，现启动脚本使用 software 图形模式并关闭 Vulkan，已重新验证；这不代表手机的解码 / HDR 能力。

从工作树根目录启动可见窗口，安装已固定的电脑测试包：

```powershell
.\scripts\start-android-emulator.ps1 -Apk D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-x86_64-debug.apk
# 修改后重新构建电脑包；输出的通用文件名可能相同，内容按此次 target 选择。
.\scripts\build-android.ps1 -Target x86_64
adb -s emulator-5554 install -r D:\DevTools\Android\Build\gradle-genzo\app\outputs\apk\universal\debug\app-universal-debug.apk
adb -s emulator-5554 shell am start -n com.genzo.android/.MainActivity
```

当前两个设备是 `emulator-5554` 和一加 `3B164M00Z0500000`，每次 ADB 安装 / 调试都指定 `-s`。手机包用默认 `-Target aarch64`；两个固定 APK 单独保存。不要依据文件名 `universal` 推断包包含全部 ABI。

Studio 的目标设备菜单可选择运行中的模拟器或真机；Logcat 也选择同一个目标。[官方模拟器使用说明](https://developer.android.com/studio/run/emulator) 当前已验证 CLI 部署及可见独立模拟器窗口，尚未把 GUI Run 点击或 Running Devices 嵌入操作记为通过。React 修改通过构建更新，目前不是前端热更新会话。

IDE 默认 Universal 的 Rust 任务限定 arm64 / x86_64，两个任务均已通过，日志 `D:\DevTools\Android\Build\studio-two-target-bridge.log`。若想单独构建可在 Build Variants 选择 `x86_64Debug` 或 `arm64Debug`。普通 CLI 构建会覆盖 Tauri 临时 IDE 连接配置；**完成其他命令行 Android 构建后，最后运行 `build-android.ps1 -Studio -Target x86_64`，保持该命令存活再在 Studio 构建**，避免旧连接出现 ConnectionRefused。

### Run提示ABI不兼容

用户截图报告：`The currently selected variant "armDebug" ... none ... compatible ... "x86_64, arm64-v8a"`。`armDebug` 是32位ARM，当前模拟器不支持这个ABI，且本工程当前验证的Rust目标只有arm64 / x86_64。先在 **Build → Select Build Variant** 打开变体面板，在 `app` 行的 **Active Build Variant** 选择 **`x86_64Debug`**，等待同步完成；顶部设备选择 **`Genzo_Pixel9_API36 / emulator-5554`**，再点击Run。`arm64Debug` 是另一个64位变体，不能与 `armDebug` 混淆；当前模拟器使用已验证的x86_64版本。

截图只证明错误变体的GUI Run失败；切换后的GUI Run尚待实际验证。ADB已重新发起模拟器中既有Genzo的启动，不安装手机、不改应用数据。

### Run提示无法终止旧app

用户后续截图报告 `Couldn't terminate previous instance of app`。日志确认这次已选择x86_64Debug；但模拟器虽列为device，shell与console均5秒无响应，Studio设备控制getVmState也超时。通过核对AVD名称后停止该qemu进程，按脚本software / 关闭Vulkan / 不载入快照冷启动恢复；未清空模拟器数据，也未重启共用ADB服务器或操作手机。包当时未登记，重新安装固定测试APK后，4作品 /1来源 /dark主题 /available目录授权恢复。

恢复检查：实际已运行Genzo的force-stop退出0，pid查询不再有进程；随后am start -W返回Status ok、MainActivity前台。记录 / 截图在 `D:\DevTools\Android\Build\qa\studio-recovery`。GUI Run完整安装 / 启动仍待验证，不把ADB恢复等同于GUI Run通过。

启动脚本同时将本AVD的 `fastboot.forceColdBoot=yes` / `fastboot.forceFastBoot=no` 写入D盘config.ini，使Studio后续启动也采用冷启动，保留userdata；快照与卡住的因果关系尚未确认。再次出现失响应时先使用设备管理器的冷启动操作，或在本工作树执行启动脚本；不要清除数据。旧ADB连接短暂残留时脚本现在给出等待断开再重试的提示，不再空数组报错。

QA 指定 `GENZO_ANDROID_SERIAL=emulator-5554`、`GENZO_ANDROID_CDP_PORT=9227`、独立 `GENZO_ANDROID_QA_DIR`；手机默认 9226。系统镜像自带 WebView 133，QA 连接 CDP 使用 `noDefaults:true`，避免新版 Playwright 的浏览器上下文设置不受旧 WebView 支持。正式应用不依赖 CDP。
