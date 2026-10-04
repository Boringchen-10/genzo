# Android 第一阶段验证记录

日期 2026-10-04，独立工作树 `H:\二次元阅读器\.tmp\android-first`，分支 `codex/android-first`，起点 `v0.5.0` / `81b41d1ddb076cad784a9eb909fc147b2f3db538`。Windows 正式标签未移动，主目录的其他工作保留；本阶段没有正式发布版本。

## 构建与设备

| 项目 | 实际值 |
| --- | --- |
| Node / pnpm | 24.19.0 / 11.19.0；按原锁文件安装，pnpm store 在 D 盘 |
| Tauri | CLI 2.11.4、Rust 2.11.5、React / TypeScript 沿用基线 |
| Rust | 1.98.1，`aarch64-linux-android`；Windows 仍为 x64 MSVC |
| JDK | D 盘 OpenJDK 17.0.20.1；Studio IDE runtime 与 Gradle JDK 区分 |
| Android | SDK / target 36，min 26 为工程设置；NDK 27.0.12077973 |
| Gradle / Kotlin / AGP | 8.14.3 / 2.2.10 / 8.11.0 |
| 手机 | 用户的一加 15，ADB 实报 OnePlus PLK110、Android 16 / API36、arm64-v8a、4 KiB 页 |
| 独立包名 | `com.genzo.android`；Windows 继续 `com.genzo.desktop` |

代码保留 H 盘；Cargo / Gradle / APK / pnpm / 测试片 / 临时目录在 `D:\DevTools\Android`。首次 SDK 环境不是从零重装，复用已有配置。中文项目路径需要 `android.overridePathCheck=true`；Kotlin 跨 D/H 盘增量缓存报错通过关闭该增量缓存、在进程内编译解决。

## 已执行与结果

| 验证 | 结果 | 证据 / 限制 |
| --- | --- | --- |
| Android 编译 / 安装 / 启动 | 通过 | `scripts/build-android.ps1`，ADB install -r 成功，实际应用页面 / Rust invoke 可用 |
| SQLite 初始化 | 通过 | 24 个既有 SQLx 迁移成功，`PRAGMA integrity_check=ok`，私有 `/data/user/0/com.genzo.android/genzo.db` |
| 数据库 / 缓存持久化 | 通过 | 写 app_settings 与图片缓存目录同一标记，强制停止 / 重启后两者一致；不是清数据 / 重装测试 |
| Android 凭据 | 通过 | 测试凭据经 Rust → Kotlin 保存 / 重启读回；Keystore AES256-GCM，私有 XML 未出现测试明文，页面仅返回匹配 bool；React QA 入口与直接插件调用均不能读取凭据 |
| SAF | 通过 | 用户系统目录授权，最新子树 Download/GenzoPrototype；重启后枚举同一组 content URI；未授权树返回 permission_denied |
| 本地播放器 | 通过本阶段样本 | 合成 40 秒 SDR 640×360 / 24 fps H264 MP4、H265 MKV；暂停 / 20 秒拖动 / 1.5× 倍速、双 AAC 音轨、原型退出续播 |
| 字幕 / 方向 | 通过本阶段样本 | 内嵌 ASS、外挂 SRT / ASS / SSA v4、偏移 +500 ms、横竖屏；截图实际显示简单描边 / 颜色 / 移动和 SSA 文本 |
| 原型状态修复 | 已复测 | 修正缓冲完成后仍显示 buffering，最新 SSA 截图为 playing |
| 16 KiB 静态对齐 | 通过 | ZIP `zipalign -c -P 16`，Rust / VLC / JNI / libc++ ELF LOAD 全部 `0x4000`；设备本身是 4 KiB，未做 16 KiB 真机测试 |
| Windows Rust 回归 | 260 通过，14 忽略，0 失败 | 包含历史 SQLite 升级 / 迁移兼容测试；不等于已在安卓导入历史用户库验证 |
| 前端回归 / 构建 | 72 通过；TypeScript / Vite 构建通过 | 保留 Windows App 入口；已有 Vite 大 chunk 警告，未为此重构 |
| Gradle Studio 配置 | 根脚本 / IDE 同步 / Rust 构建任务通过 | `gradlew help --quiet` 与 Studio 所用 `rustBuildArm64Debug` 任务；实际日志确认 D 盘 system / log / Gradle JDK / sync TEMP，Android NDK 链接器从项目本地配置传入；GUI Run 点击尚未验收 |

QA 脚本 `verify-android-prototype.mjs` / `verify-android-player.mjs`。本机原始结果 `D:\DevTools\Android\Build\qa\persistence-saf.json`、`player.json` 与 `embedded-ass / external-srt / external-ass / external-ssa / landscape-ass.png`。测试片由 `create-android-samples.ps1` 生成，唯一输入是 lavfi 测试画面 / 正弦声音及自有字幕，未修改真实视频。

可安装的第一阶段测试包已固定为 `D:\DevTools\Android\Build\artifacts\Genzo-android-stage1-arm64-debug.apk`，153,817,025 字节，SHA256 `3304df1fcd14372654319b72c7cd0d5021cf873d4880e8e6343dbf269e61dc03`。该文件已重新安装并通过上述真机 QA，仅包含 arm64 原生库；它是验证原型，正式媒体库页面与远程播放未交付。

Studio 2026.2.1.8 曾因安装文件 `intellij.platform.ide.impl.jar` 的 CRC 损坏与无效常量池失败。用本机已有官方安装包（SHA256 `4c26f92e0e78adb1381c9a76597dbd5f6bce13d2ff2bf88cd2b57d425d685f3d`）提取原文件，保留损坏文件备份后仅恢复该 JAR；恢复后的 SHA256 为 `402dde07f0b3f44ceeca1ab441be6a71e2ade8ccc7f25aa5fcac0f15ab5808b6`。安装目录 `lib` 下 382 个 JAR 的 ZIP CRC 检查通过，Studio 已重新显示工程。证据与备份在 `D:\DevTools\Android\Research\StudioRepair`，Rust IDE 构建日志在 `D:\DevTools\Android\Build\studio-rust-bridge-check-final.log`；没有删除用户 IDE 配置。

## 重现

```powershell
pnpm install --frozen-lockfile --store-dir D:\DevTools\Android\Pnpm
.\scripts\build-android.ps1
# 实际 APK 在 D 盘，CLI 可能提示未重定向的模板路径。
adb install -r D:\DevTools\Android\Build\gradle-genzo\app\outputs\apk\universal\debug\app-universal-debug.apk
adb shell am start -n com.genzo.android/.MainActivity
# 首次由人通过系统目录选择器授予测试子树只读权限。
node scripts/verify-android-prototype.mjs
node scripts/verify-android-player.mjs
```

QA 使用已安装调试包的 WebView CDP，作用范围是 Genzo 原型 / 合成片；不是正式包暴露的用户功能。Windows regression：`pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml`；Cargo target 指向 D 盘独立 `genzo-windows`。

## 尚未验收

SAF 递归 / 大库 / 增量索引、来源启停与扫描重试、安卓刮削 / 人工确认闭环、稳定媒体 ID 的 SQLite 观看记录 / 首页续播、自动字幕多候选、WebDAV 鉴权 / Range / 中断恢复、TMDB Token 的安卓安全迁移、正式 OpenDesign 页面 / 原生控件、安全区 / 系统返回全流程、后台 / 进程回收恢复。当前原型使用 URI 哈希进度，不能计为正式观看记录交付。

字体附件、复杂 ASS、高清 / 10-bit / HDR、多声道输出、其他 API / ABI 与 16 KiB 设备、历史库在手机上升级均需后续验证。Release 签名 / 公开分发对应源码与许可证清单未完成。普通 EncounteredError 不能可靠推断 decoder_unsupported，应作为 unknown 展示可重试信息。

## 本地索引与电脑模拟器补充验证

同日新增迁移 0025，手机原型由 24 迁移升级为 25；基线持久化标记 / 缓存 / 安全凭据保留。合成的存量 0024 库升级测试核对历史迁移校验和、收藏 / 备注 / 观看进度、外键与 SQLite 完整性；未操作用户 Windows 真实库。

- Windows Rust 全套：265 通过、14 忽略、0 失败；日志 `D:\DevTools\Android\Build\windows-saf-tests.log`。
- 前端 72 通过；两个 ABI 的 Android 构建均执行 TypeScript / Vite 构建，Kotlin / Rust 编译、安装和启动通过。
- 一加真机与 Android 16 / API36 Pixel 9 模拟器均通过持久化 / 拒权 / 凭据 JS 读取拒绝、递归 SAF 索引、7 个视频 / 字幕条目的稳定身份 / 元数据复用、S02E03 解析、手工建作品 / 收藏 / 评分 / 状态 / 备注保留、来源停用拒绝扫描和删除保护。
- 队列取消、目录部分拒权 / 来源不可用时保留索引由 Windows 单元验证；手机实际撤销授权再授权与大库仍待验收。原始目录层级已保存，共享文件夹分组后续适配，见 `SAF_INDEX.md`。
- 两设备的原生播放器样本 QA 均通过。模拟器 host GPU 出现导入错误后改为 software 并关闭 Vulkan，冷启动后再次通过持久化 / 索引 / 播放 QA；它用于页面和交互，不替代手机解码 / 画质验收。
- 模拟器 WebView 的 `innerWidth=scrollWidth=412`，已修复桌面 `min-width:1024px` 泄漏；仅 Android data-platform 覆盖，不改变 Windows 布局。
- Studio 所用的 arm64 / x86_64 Rust 任务均通过。普通 CLI 构建覆盖临时连接曾导致 ConnectionRefused；最后重新启动 `-Studio` 桥并执行 `rustBuildUniversalDebug` 成功，日志 `studio-two-target-bridge.log`。不是 GUI Run 人工验收。

结果分别在 `D:\DevTools\Android\Build\qa\phone-stage2` 和 `qa\emulator`，各含 `persistence-saf.json`、`saf-index.json`、`player.json` 与截图。脚本明确指定设备；测试媒体均在本轮 `Download/GenzoPrototype`，包括额外 Nested 合成拷贝，未触及原有真实媒体。

固定的第二阶段测试包：

| 用途 | 路径 | SHA256 |
| --- | --- | --- |
| 一加 / arm64 | `D:\DevTools\Android\Build\artifacts\Genzo-android-stage2-arm64-debug.apk` | `20c0ebb795708d83d30ab36f923e4d49a3364c5a86e3c69b494e259b657c94d8` |
| 电脑 / x86_64 | `D:\DevTools\Android\Build\artifacts\Genzo-android-stage2-x86_64-debug.apk` | `b6dc261864d731d997c10545d0ce0c69f7e166ec0e310ce6f760d8687ad2aca9` |

以上为第二阶段快照；第一阶段是24迁移 / arm64的历史快照。第三阶段已接稳定ID的本地观看记录与React页面，见下文；仍未正式发布。

## 可操作前端 / 模拟器阶段

用户要求暂不在实物手机展示，本轮只安装 / 测试emulator-5554。按OpenDesign v1接React首页、媒体库、收藏、我的、来源、待整理和详情，显示实际索引 / 整理的合成视频。没有使用静态演示作品 / 未授权角色资产。

- 独立x86_64 APK编译 / 安装 / 启动通过；固定包 `D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-x86_64-debug.apk`，SHA256 `65f7894aa3e89a43cf42ca9c26d9f5f3a6c505fe96f135cf6be321ff91f3d600`。
- 来源开关 / 新扫描、手动分组建作品、搜索空态、收藏、评分8.5 / 备注、系统返回关闭抽屉与原生播放器、详情打开原始视频、React后台时Rust写SQLite进度、首页续播通过。合成片在约17秒保存并续播；没有播放转码。强制停止 / 新WebView重连后再断言主题、个人记录、进度、目录授权恢复，脚本通过。
- 新增进度单元验证稳定媒体ID、无效 / 陈旧 / 未索引样本拒写、作品收藏 / 备注保留。Windows全套266通过、14忽略、0失败，日志 `Build/windows-frontend-tests.log`；前端72通过，TypeScript / Vite通过。
- 模拟器宽412 / scrollWidth412，顶部56与底部56不覆盖主内容，深浅主题截图已检查。Windows1024×640、1366×768、1920×1080浏览器模拟IPC首页 / 媒体库无横向溢出，桌面min-width1024保留。未进行全套Windows原生控件人工验收。
- UI脚本修正新任务识别、重名卡片、启动Socket / 旧播放会话竞态；主题先误用不支持的新设置键，改用共享theme。模拟器全屏系统教学遮罩已确认。原生平台Activity返回键不退出已改ComponentActivity回调并通过实际系统返回测试。
- 实时预览尝试启动独立1421服务并编译开发包，但实际WebView仍读取tauri.localhost，未通过热更新验证；未提交该Preview配置 / 入口。已恢复固定独立包和普通Studio构建桥。当前React迭代使用重新构建安装，不将开发服务启动等同于热更新成功。

脚本 `scripts/verify-android-ui.mjs`；记录与截图 `D:\DevTools\Android\Build\qa\frontend`。候选 / 刷新仅接口连接，真实联网匹配 / 纠错闭环、WebDAV、原始目录分组 / 大库、字幕自动候选 / 原生正式控件、生命周期 / 解码范围仍需继续。新前端尚未在一加部署，不把模拟器当新真机验收。
