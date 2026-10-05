# 安卓前端预览（模拟器优先）

用户在2026-10-04要求先看到可操作前端，再继续设计与加功能，暂不在实物手机展示或安装。工程仍为 `H:\二次元阅读器\.tmp\android-first` / `codex/android-first`；主目录 Windows 和其他草稿保留。

## 当前页面

| 页面 | 已连接能力 |
| --- | --- |
| 首页 | 本机作品、真实观看记录和续播；继续观看滑轨 + 动画 / 书籍 / 电影 / 电视剧 / 影视 分类封面滑轨，每个分类右侧「更多」跳转媒体库对应筛选（书籍 → 书架 Tab） |
| 媒体库 | 真实作品、搜索 / 分类、48项分段加载、缺封面占位 |
| 书架 | 漫画 / 轻小说作品网格（真实 `comic` / `novel` 数据）；阅读能力为后续版本，无数据时显示空态并引导管理来源 |
| 我的 | 分组设置列表：账户（未登录占位）/ 通用 / 外观 / 网络；下载、浏览记录、书签、继续阅读漫画、阅读统计；AI 配置、通知中心、关于。外观（主题模式深 / 浅 / 系统、暗色模式封面亮度、主题风格 8 档、主题色 + 15 色预设 + 圆环取色盘、动态颜色（待原生）、AMOLED 纯黑、默认字体大小、统一阴影大小、玻璃模糊、圆角大小、恢复默认外观、开发验证；设置按 主题模式 / 主题配色 / 显示与排版 分块展示）与网络 / 来源管理（SAF 与远程来源列表、待整理入口、WebDAV 与网盘服务、账号 / API 直连、元数据来源）为独立子页；尚未接入项进入统一「Future」占位页 |
| 来源 | SAF 添加 / 最近已授权目录登记、启停、重新授权、扫描 / 进度 / 问题 / 取消 / 重试 |
| 待整理 | 共享分组 / 文件范围、手动创建 / 关联、候选搜索 / 确认接口 |
| 详情 | 作品资料、收藏、个人状态 / 评分 / 备注、已关联视频播放、已匹配资料刷新接口 |

底部主导航为 首页 / 媒体库 / 书架 / 发现 / 我的 五项，仅显示图标，当前选中项才展开文字。「我的」为分组菜单，外观 / 网络（来源管理、待整理）为子页，其余未接入项显示 Future 占位。

作品来自实际授权 / 索引的模拟器测试目录，测试片是我们生成的，不是设计静态数组。未刮削作品明确显示缺图与资料缺失；没有打包 OpenDesign 未授权角色图。候选 / 刷新已连共享后端，真实联网作品闭环仍需样本验证。

本地播放由独立 LibVLC Activity 承载，目前仍是原生验证控件。页面只交稳定 mediaFileId；Rust 解析授权文档 URI，后台保存共享 SQLite 观看记录，返回后刷新首页。字幕自动关联 / 多候选、原生正式控件、WebDAV 页面 / 鉴权与 Range、中断恢复、原始目录分组与大库继续实现，不能视为完整安卓首版。

外观设置对齐 PC 并参考阅读器主题面板扩展：`--accent-h` / `--accent-s` / `--accent-l` 驱动 `--accent`；主题风格（柔和 / 鲜明 / 表现 / 准确 / 内容 / 中性 / 黑白 / 彩虹）同时调节强调色饱和 / 明度与中性底色染色 `--n-s` / 面板明度 `--n-lift`，底色（`--bg`）、面板（`--surface` / `--surface-strong`）、描边（`--line`）与分隔线均由这两个变量派生，因此切换风格会整体重绘背景与卡片，而不只改变强调色；彩虹额外叠加 `.gz-rainbow-layer` 彩色氛围层。主题色提供 15 色预设与圆环 + 明度/饱和方块取色盘。暗色模式封面亮度、AMOLED 纯黑、统一阴影大小、默认字体大小、玻璃模糊、圆角大小各自对应根节点变量；动态颜色依赖 Android 12+ 原生取色，暂标注「待接入」。全部由 zustand `genzo-preferences`（与 PC 同名）持久化，恢复默认外观回到色相 158 / 饱和 55 / 明度 55 / 柔和 / 封面亮度 100 / 字体 100% / 阴影 1 / 模糊 24 / 圆角 8；切换深 / 浅 / 系统主题不清空这些项，`theme` 仍走共享后端设置。

## 独立测试 APK

`D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-20261005-x86_64-debug.apk`

SHA256：`fd1605433a1e5c8f182ddb399025aad628b6033b6b0d2bebf507c4e376073506`，121,287,503 字节。包含2026-10-05源码 `8f3c146` 的五项导航与新外观设置。只面向电脑 x86_64 模拟器；当前未生成或部署这一前端版本的真机交付包。独立包包含前端，不需要电脑开发服务器。2026-10-04的旧固定包仍保留，不能用它展示后续前端修改。

在工作树 PowerShell 运行：

```powershell
.\scripts\start-android-emulator.ps1 -Apk 'D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-20261005-x86_64-debug.apk'
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

2026-10-05启动时，Studio模式完成原生编译后 APK 输出仍是昨日文件。保持该桥进程，显式运行 `src-tauri/gen/android/gradlew.bat :app:assembleX86_64Debug` 后才生成最新包，本次安装实际来自 `D:\DevTools\Android\Build\gradle-genzo\app\outputs\apk\x86_64\debug\app-x86_64-debug.apk`。Gradle使用D盘Java17、`GRADLE_USER_HOME`及TEMP；不要把Universal与x86_64输出混用，安装前核对时间，安装后核对新页面。

## 验证与范围

2026-10-05 外观面板按参考图扩展并在模拟器验收（`emulator-5554`，重建 x86_64 debug APK → 安装 → 启动）：主题模式下拉、暗色模式封面亮度滑杆、主题风格 8 档切换、主题色 15 色预设选择（改动即时生效并更新右上 hex）、圆环 + 明度/饱和方块取色盘（含 取消 / 确定 与 hex 显示）均正常渲染与响应。未逐项回归浅色主题在取色后的对比度。参考图 1（导航栏顺序拖动排序、应用字体 / 字号 / 应用图标）依赖原生拖动与字体、图标资源，列为本轮之后待接入项。

2026-10-05 修复主题风格无效：此前 8 档只改强调色，底色 / 面板固定在 `--accent-h` 的低饱和，深色下几乎无变化。现引入 `--n-s`（中性染色）与 `--n-lift`（面板明度），由风格同时驱动强调色与背景 / 面板 / 描边。经 CDP 直接写入 `genzo-preferences` 逐档实测（深色与浅色各 8 / 5 档，抽取强调色、底色、面板、标签栏像素），确认 柔和→鲜明→表现→内容→准确→中性→黑白 呈饱和到灰阶的连续梯度（如深色面板 `#141D1F` → `#112228` → `#0F2730` → `#171B1C` → `#1A1D1D` → `#1D1D1D`），黑白纯灰、彩虹为彩色氛围层 + 渐变强调色；浅色下背景 / 下拉底色 / 描边同样分档。验收后已把模拟器偏好恢复为默认（色相 158 / 柔和）。

2026-10-05 取色盘与设置分块：撤销上一轮「色块矩阵」取色，恢复圆环色相 + 明度/饱和方块取色盘（`hslToHsv` / `hsvToHsl` / `hsvToHex`，`.gz-picker-ring` / `.gz-picker-square` / `.gz-picker-sv`）。用户澄清「分块化」指设置功能分块，故把「外观」页从平铺 `Section` 改为分块（block）卡片：`SettingBlock` / `SettingRow` 与 `.gz-block*` / `.gz-set-row` / `.gz-set-inline` 样式，主题模式、主题配色、显示与排版三块，块内行以分隔线相连，恢复默认外观与开发验证移到页面底部操作区。模拟器验收：圆环取色盘与分块卡片在浅 / 深主题下渲染正常，块标题 / 描边 / 面板底色随主题风格变化。

2026-10-05「我的」分组菜单在模拟器验收：三组设置行（图标 + 标签 + 右箭头）与 `继续阅读漫画` 副标题、`通知中心` 红点、页脚版本号均按参考图渲染；`未登录` 弹出「账号功能待接入」提示；`通用` 等未接入项进入「· Future」占位页并可返回；`外观` / `网络` 子页正常。改动为 `src/android/AndroidApp.tsx` 与 `src/android/mobile.css` 的 `.gz-menu*` 样式。

2026-10-05新包启动检查通过：五项导航与外观三个滑块显示，五页412px无横向溢出，4作品 / 1来源 / available目录授权 / 用户外观设置保留。结果与已检查截图在 `D:\DevTools\Android\Build\qa\frontend-20261005`；未重复完整来源 / 播放回归。

2026-10-04的 `scripts/verify-android-ui.mjs` 限定模拟器及 GenzoPrototype 合成目录，覆盖来源启停 / 新扫描、手动整理、搜索空态、收藏 / 评分 / 备注、系统返回关闭抽屉 / 播放器、原生播放、React后台的SQLite进度、首页续播和深浅布局。强制停止后重新连接新WebView，断言DB个人记录 / 进度、主题、来源授权恢复。结果 / 截图在 `D:\DevTools\Android\Build\qa\frontend`。旧脚本「我的 → 目录与来源」选择器需适配新分页后才能继续完整回归。

模拟器视口412px且无横向溢出；顶部 / 底部导航不盖主内容。安全区由原生系统 inset 处理，IME开启时保留可见区；系统返回先关闭键盘，再到应用抽屉 / 路由。首屏缺图和空态按实际数据渲染。Windows三尺寸模拟IPC首页 / 媒体库检查通过，72项前端、266项Rust /14忽略通过；不是所有 Windows 原生窗口与设备兼容验收。
