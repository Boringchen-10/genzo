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
