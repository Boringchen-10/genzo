# 安卓前端预览（模拟器优先）

用户在2026-10-04要求先看到可操作前端，再继续设计与加功能，暂不在实物手机展示或安装。工程仍为 `H:\二次元阅读器\.tmp\android-first` / `codex/android-first`；主目录 Windows 和其他草稿保留。

## 当前页面

| 页面 | 已连接能力 |
| --- | --- |
| 首页 | 本机作品、真实观看记录和续播；继续观看滑轨 + 动画 / 书籍 / 电影 / 电视剧 / 影视 分类封面滑轨，每个分类右侧「更多」跳转媒体库对应筛选（书籍 → 书架预留） |
| 媒体库 / 收藏 | 真实作品、搜索 / 分类、48项分段加载、缺封面占位 |
| 我的 | 三段分页：外观（深 / 浅 / 系统主题持久化、主题色色相 / 玻璃模糊 / 圆角大小与恢复默认、我的收藏、预览范围、Future 扩展、开发验证）/ 来源管理（SAF 与远程来源列表、待整理入口）/ 数据源（WebDAV 与网盘服务、账号 / API 直连、元数据来源） |
| 来源 | SAF 添加 / 最近已授权目录登记、启停、重新授权、扫描 / 进度 / 问题 / 取消 / 重试 |
| 待整理 | 共享分组 / 文件范围、手动创建 / 关联、候选搜索 / 确认接口 |
| 详情 | 作品资料、收藏、个人状态 / 评分 / 备注、已关联视频播放、已匹配资料刷新接口 |

作品来自实际授权 / 索引的模拟器测试目录，测试片是我们生成的，不是设计静态数组。未刮削作品明确显示缺图与资料缺失；没有打包 OpenDesign 未授权角色图。候选 / 刷新已连共享后端，真实联网作品闭环仍需样本验证。

本地播放由独立 LibVLC Activity 承载，目前仍是原生验证控件。页面只交稳定 mediaFileId；Rust 解析授权文档 URI，后台保存共享 SQLite 观看记录，返回后刷新首页。字幕自动关联 / 多候选、原生正式控件、WebDAV 页面 / 鉴权与 Range、中断恢复、原始目录分组与大库继续实现，不能视为完整安卓首版。

外观设置对齐 PC：主题色以根节点 `--accent-h` 色相驱动 `--accent`，并调和底色 / 面板 / 描边等中性色，玻璃模糊与圆角通过 `--ui-blur` / `--radius` 应用到面板、滑轨封面与卡片。三项由 zustand `genzo-preferences`（与 PC 同名）持久化，恢复默认回到色相 158 / 模糊 24 / 圆角 8；切换深 / 浅 / 系统主题不清空这三项，`theme` 仍走共享后端设置。

## 独立测试 APK

`D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-x86_64-debug.apk`

SHA256：`65f7894aa3e89a43cf42ca9c26d9f5f3a6c505fe96f135cf6be321ff91f3d600`。只面向电脑 x86_64 模拟器；当前未生成或部署这一前端版本的真机交付包。独立包包含前端，不需要电脑开发服务器。

在工作树 PowerShell 运行：

```powershell
.\scripts\start-android-emulator.ps1 -Apk 'D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-x86_64-debug.apk'
```

启动 `Genzo_Pixel9_API36`，冷启动保留原 AVD 数据；GPU software / 关闭 Vulkan。脚本将该AVD默认设为冷启动，Studio下次启动也不自动恢复快照。工具、AVD、构建 / 日志 / 缓存 D，源代码 H。ADB 必须 `-s emulator-5554`，不要在双设备状态下用默认目标。

## 前端编辑位置

- `src/android/AndroidApp.tsx`：页面、导航、真实数据与操作。
- `src/android/mobile.css`：OpenDesign 手机Token与局部样式；只作用Android，不修改Windows布局。
- `src/android/api.ts`：安卓来源 / 播放命令；共享作品资料仍用 `src/api.ts`。
- `design/open-design/android-v1/`：原始设计与规范。
- `src-tauri/gen/android/app/src/main/java/com/genzo/android/PlayerActivity.kt`：原生视频 / 控件，React页面不直接绘制视频面。

Android Studio 工程为 `src-tauri/gen/android`；React 文件在工程外层，可通过 File → Open / 编辑器打开。Windows页面文件仍走原 App。新功能先明确数据与状态，再接现有命令；不要将设计演示动作做成伪成功。

当前修改后通过重新构建 / 安装更新页面，尚未验收热更新。独立开发端口的尝试已停止，保留已验证的独立 APK，不依赖1421服务。用工作树根目录的 PowerShell：

```powershell
.\scripts\build-android.ps1 -Target x86_64
.\scripts\start-android-emulator.ps1 -Apk 'D:\DevTools\Android\Build\gradle-genzo\app\outputs\apk\universal\debug\app-universal-debug.apk'
# 最后打开 Studio 并保持此进程，给 IDE 的 Rust 构建任务提供 Tauri 桥。
.\scripts\build-android.ps1 -Studio -Target x86_64
```

普通构建提示成功后再安装；`-Studio` 模式构建结束仍会等待 IDE，不能把未退出误判为未完成。Studio目标选 `Genzo_Pixel9_API36 / emulator-5554`，Build Variants 选 `x86_64Debug`；React不在Kotlin文件里，修改位置见上方。GUI Run点击尚未验收，当前实际部署由指定模拟器的脚本完成。其他CLI Android构建会替换临时连接，之后需重新运行最后一条。日志与两个JVM的配置见 `ANDROID_STUDIO.md`。

## 验证与范围

`scripts/verify-android-ui.mjs` 限定模拟器及 GenzoPrototype 合成目录，覆盖来源启停 / 新扫描、手动整理、搜索空态、收藏 / 评分 / 备注、系统返回关闭抽屉 / 播放器、原生播放、React后台的SQLite进度、首页续播和深浅布局。强制停止后重新连接新WebView，断言DB个人记录 / 进度、主题、来源授权恢复。结果 / 截图在 `D:\DevTools\Android\Build\qa\frontend`。

模拟器视口412px且无横向溢出；顶部 / 底部导航不盖主内容。安全区由原生系统 inset 处理，IME开启时保留可见区；系统返回先关闭键盘，再到应用抽屉 / 路由。首屏缺图和空态按实际数据渲染。Windows三尺寸模拟IPC首页 / 媒体库检查通过，72项前端、266项Rust /14忽略通过；不是所有 Windows 原生窗口与设备兼容验收。
