# 安卓前端预览（模拟器优先）

用户在2026-10-04要求先看到可操作前端，再继续设计与加功能，暂不在实物手机展示或安装。工程仍为 `H:\二次元阅读器\.tmp\android-first` / `codex/android-first`；主目录 Windows 和其他草稿保留。

## 当前页面

| 页面 | 已连接能力 |
| --- | --- |
| 首页 | 本机作品、真实观看记录和续播；继续观看滑轨 + 动画 / 书籍 / 电影 / 电视剧 / 影视 分类封面滑轨，每个分类右侧「更多」跳转媒体库对应筛选（书籍 → 书架 Tab） |
| 媒体库 | 真实作品、搜索 / 分类、48项分段加载、缺封面占位 |
| 书架 | 漫画 / 轻小说分区标签（真实 `comic` / `novel` 数据网格）；工具行右侧「有更新」入口，点击打开排序弹层；空态为徽章 + 「书架空空如也」+「去找点好看的漫画 / 轻小说吧」+ 刷新。排序方式底部弹层：作品更新时间 / 收藏时间 / 浏览时间，选中项带对勾；阅读能力仍为后续版本 |
| 发现 | 三分区标签 动漫 / 漫画 / 轻小说，右上角搜索：动漫读真实 Bangumi（当季热度 / 当季番组 / 动画排行 + 搜索），漫画读真实 COPY 源（主题芯片 + 网格 + 搜索），轻小说无在线源显示「待接入数据源」占位；点封面打开详情抽屉，动漫可加入媒体库 / 收藏，漫画可加入媒体库 |
| 我的 | 分组设置列表：账户（未登录占位）/ 通用 / 外观 / 网络 / 资料库；下载、浏览记录、书签、继续阅读漫画、阅读统计；AI 配置、通知中心、关于。外观（主题模式深 / 浅 / 系统、暗色模式封面亮度、主题风格 8 档、主题色 + 15 色预设 + 圆环取色盘、动态颜色（待原生）、AMOLED 纯黑、默认字体大小、统一阴影大小、玻璃模糊、圆角大小、恢复默认外观、开发验证；设置按 主题模式 / 主题配色 / 显示与排版 分块展示）与网络（图二式数据源配置：代理设置 / 线路与节点 + 一键测速 / COPY 漫画源域名与版本 / 并发数；安卓未接后端，保存与测速标注待接入）、资料库（原来源管理：SAF 与远程来源列表、待整理入口、WebDAV 与网盘服务、账号 / API 直连、元数据来源）为独立子页；尚未接入项进入统一「Future」占位页 |
| 资料库 | SAF 添加 / 最近已授权目录登记；点击来源行直接进入文件夹分级浏览；仅保留「扫描」（进行中显示进度与取消、失败显示重试），不再显示启停开关、重新授权与扫描完成汇总 |
| 浏览目录 | 仅显示文件夹，PC 式点击分级下钻：从授权目录根（总文件夹）逐级进入子文件夹，面包屑可回跳上层，系统返回键逐级退出；文件不在列表中展示，识别逻辑从简 |
| 待整理 | 共享分组 / 文件范围、手动创建 / 关联、候选搜索 / 确认接口 |
| 详情 | 按作品类型分流：影视详情为分段标签页（剧集 / 概览 / 角色 / 关联 / 制作人员，默认进入剧集），剧集列已关联视频，概览含可点击标签、作品简介、个人备注、资料管理，角色 / 关联 / 制作人员读作品资料结构（缺资料时显示占位），不再显示「我的评分」；漫画 / 轻小说显示书籍版式（类型 / 年份 / 评分与章节统计、可点击标签、下载 / 评论 / 收藏、默认 / 单行本 / 分话章节网格与分页），阅读器仍待接入 |

底部主导航为 首页 / 媒体库 / 书架 / 发现 / 我的 五项，仅显示图标，当前选中项才展开文字。「我的」为分组菜单，外观 / 网络（图二式数据源配置）/ 资料库（原来源管理、待整理）为子页，其余未接入项显示 Future 占位。

作品来自实际授权 / 索引的模拟器测试目录，测试片是我们生成的，不是设计静态数组。未刮削作品明确显示缺图与资料缺失；没有打包 OpenDesign 未授权角色图。候选 / 刷新已连共享后端，真实联网作品闭环仍需样本验证。

目录浏览走原生 `listTree`：每次只读取当前层级，前端过滤出文件夹（mime `vnd.android.document/directory`），点击子文件夹时把该子项的 `uri` 回传继续下钻；面包屑与系统返回键逐级回退。根级别调用不带 `uri`，使用最近一次持久化的 tree URI，故多来源场景需后端为每个来源暴露各自的 tree URI 才能分别浏览（当前模拟器单来源已验证）。

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

2026-10-05 发现三分区 + 搜索与「网络」数据源配置页：新增 `src/android/ExplorePanel.tsx`（发现页三标签 动漫 / 漫画 / 轻小说，右上角搜索并入 322 条栏；动漫读真实 Bangumi `exploreOverview` + `animeRanking`，分「当季热度 / 当季番组 / 动画排行」，搜索走 `searchExplore`；漫画读真实 COPY 源 `comicExploreApi.list/themes`，主题芯片 + 网格 + 搜索；轻小说无在线源，显示「轻小说发现 · 待接入数据源」占位；点封面打开详情抽屉，动漫「加入媒体库 / 收藏」走 `saveExploreSubject`，漫画「加入媒体库」走 `comicExploreApi.save`）与 `src/android/NetworkPanel.tsx`（图二式阅读网络页：代理设置 / 线路与节点 + 一键测速 / COPY 漫画源域名与版本 / 并发数，保存与测速标注「待接入」，安卓分支未接 `reading_network` 后端命令）。`AndroidApp.tsx`：`发现` 路由改用 `ExplorePanel`，新增 `network` 路由，标题映射 `sources` → 「资料库」、新增 `network` → 「网络」；`我的` 分组菜单「网络」改跳 `network`，并在其下新增「资料库」行（`Database` 图标，副标题「本地目录与来源管理」）跳 `sources`。`mobile.css` 新增 `.gz-explore-*` / `.gz-rank-*` / `.gz-net-*` / `.gz-node-*`。模拟器（`emulator-5554`，重建 x86_64 debug APK → `install -r` → 启动）经 WebView CDP 验收：发现三标签在列，动漫区「当季热度 / 当季番组 / 动画排行」与 12 张封面 + 12 条排行、漫画 21 个真实主题芯片 + 24 张卡片、轻小说占位标题；网络页三块标题「代理设置 / 线路与节点 / COPY 漫画源」与 1 条默认线路，点击测速 / 保存弹出「待接入」提示；「资料库」进入原来源管理内容；全程无 `pageerror`。改动 `src/android/AndroidApp.tsx` / `src/android/mobile.css`，新增 `src/android/ExplorePanel.tsx` / `src/android/NetworkPanel.tsx`。

2026-10-05 影视详情分段标签顺序调整：把「剧集」与「概览」对调，`detailTabs` 首项改为 `episodes`，并把两个默认入口（`useState` 初值与作品切换 effect 里的 `setDetailTab`）从 `overview` 改为 `episodes`——后者是上一版遗漏点，仅改顺序时打开详情仍会回到概览。改动 `src/android/AndroidApp.tsx`。模拟器（`emulator-5554`，重建 x86_64 debug APK → `install -r` → 启动）经 WebView CDP 验收：详情标签顺序为 剧集 / 概览 / 角色 / 关联 / 制作人员，`剧集` 为 active / `aria-selected=true`，默认渲染 `.gz-episodes`（本地视频）而非概览简介。

2026-10-05 详情页标签 / 分段切换：漫画 / 轻小说详情收窄章节标签与操作行（`.gz-book-tabs` 按钮内边距 5px 2px 8px、字号 13px，小标 11px、下划线 16px/2.5px；`.gz-book-action` 最小高 36px、字号 13px、图标 15px），标签改为可点击按钮 `.gz-book-pill`（`button` + `focus-visible`）。点击漫画标签调用 `openTag(tag, type)`：`comic` / `novel` 跳转 `#/bookshelf` 并写入 `bookQuery`，书架按类型过滤并把标签作为 `标签：<x>` 芯片显示在工具行（可点击清除，空结果显示「没有匹配的作品」+ 清除按钮）；影视标签仍跳转媒体库带搜索词。影视详情移除「我的评分」，改为参考图分段标签栏 `.gz-detail-tabs`（概览 / 剧集 / 角色 / 关联 / 制作人员）：概览显示可点击 `.gz-tag` 标签、作品简介、个人备注、资料管理；剧集列已关联视频；角色 / 关联 / 制作人员读 `api.getAnimeWorkStructure(workId)`（`structure.characters` / `seasons` / `staff`），加载 / 失败回退为「暂无…资料」占位。新增 `detailTab` / `structure` / `structureState` / `bookQuery` 状态与 `.gz-tag` / `.gz-detail-tabs` / `.gz-credit*` / `.gz-related*` 样式。模拟器（`emulator-5554`）验收：漫画详情 默认 24 / 分话 24、标签为按钮「奇幻 / 日本 / 漫画」，点击「奇幻」→ `#/bookshelf`，芯片「标签：奇幻」+「共 1 部」命中「魔都精兵的奴隶」，清除芯片后标签消失；影视详情分段栏切换正常（概览 / 剧集 / 角色，「角色 → 暂无角色资料。匹配 Bangumi 资料后可显示。」），全文不含「我的评分」。

2026-10-05 漫画 / 轻小说作品详情页：`src/android/AndroidApp.tsx` 详情路由按 `detail.type` 分流，`comic` / `novel` 使用书籍版式（`.gz-book-head` / `.gz-book-chips` / `.gz-book-pills` / `.gz-book-stats` / `.gz-book-actions` / `.gz-book-tabs` / `.gz-chapter-grid`），影视仍用 `.gz-detail-head`。新增 `bookApi.entries(workId)` 读取真实章节：默认（全部）/ 单行本（按 `volumeNumber`）/ 分话（按 `chapterNumber`）三种分组，单行本与分话在无对应数据时隐藏；章节网格显示话号 / 卷号、文件格式徽章、缺失与在读状态，超过 72 条时分页（`.gz-book-groups`）并带回到顶部按钮。模拟器（`emulator-5554`）验收：种子漫画「魔都精兵的奴隶」（24 个 `.cbz` 章节）渲染 默认 24 / 分话 24（无单行本故隐藏），分话视图首项「第01话」，深 / 浅主题正常；并回归影视详情（4 部视频作品，点击 `#/detail/eba43f8c…` 仍显示 `.gz-detail-head` 与 1 集）与书架（漫画 / 轻小说分区、1 张漫画卡、排序行）不受影响。

2026-10-05 书架工具行精简：删除「换一换」，把「有更新」移到右侧（`.gz-shelf-bar` 改为 `justify-content: flex-end`），点击「有更新」打开「排序方式」弹层（`aria-haspopup="dialog"`）；同时移除 `shelfUpdated` 状态与按更新时间过滤、`Shuffle` 图标引用与 `.gz-chip-plain` 规则。模拟器（`emulator-5554`）验收：书架工具行仅剩右侧「有更新」，点击弹出排序弹层（作品更新时间 / 收藏时间 / 浏览时间）。

2026-10-05 书架按参考图重做：`src/android/AndroidApp.tsx` 书架路由改为 漫画 / 轻小说 分区标签（下划线高亮，切换按 `work.type` 过滤），工具行左「有更新」（`gz-chip` 开关，仅显示 `updatedAt` 晚于 `createdAt` 的作品）、右「换一换」（打开排序弹层）；列表按 `shelfSort` 排序（作品更新时间 / 收藏时间 / 浏览时间，无浏览记录时浏览时间回退按更新时间）；空态为圆角徽章 + 书架空空如也 + 去找点好看的漫画 / 轻小说吧 + 刷新（触发 `refresh()`）。新增 `.gz-shelf-tabs` / `.gz-shelf-bar` / `.gz-shelf-empty` / `.gz-shelf-badge` 与排序弹层 `.gz-sheet-handle` / `.gz-sheet-title` / `.gz-sort-*` 样式；系统返回键先关闭排序弹层。模拟器（`emulator-5554`）浅 / 深主题验收：分区切换、空态文案随分区变化、排序弹层三选项与对勾切换、暗色渲染均正常；因当前无 `comic` / `novel` 作品，网格态未实机验证。

2026-10-05 外观面板按参考图扩展并在模拟器验收（`emulator-5554`，重建 x86_64 debug APK → 安装 → 启动）：主题模式下拉、暗色模式封面亮度滑杆、主题风格 8 档切换、主题色 15 色预设选择（改动即时生效并更新右上 hex）、圆环 + 明度/饱和方块取色盘（含 取消 / 确定 与 hex 显示）均正常渲染与响应。未逐项回归浅色主题在取色后的对比度。参考图 1（导航栏顺序拖动排序、应用字体 / 字号 / 应用图标）依赖原生拖动与字体、图标资源，列为本轮之后待接入项。

2026-10-05 修复主题风格无效：此前 8 档只改强调色，底色 / 面板固定在 `--accent-h` 的低饱和，深色下几乎无变化。现引入 `--n-s`（中性染色）与 `--n-lift`（面板明度），由风格同时驱动强调色与背景 / 面板 / 描边。经 CDP 直接写入 `genzo-preferences` 逐档实测（深色与浅色各 8 / 5 档，抽取强调色、底色、面板、标签栏像素），确认 柔和→鲜明→表现→内容→准确→中性→黑白 呈饱和到灰阶的连续梯度（如深色面板 `#141D1F` → `#112228` → `#0F2730` → `#171B1C` → `#1A1D1D` → `#1D1D1D`），黑白纯灰、彩虹为彩色氛围层 + 渐变强调色；浅色下背景 / 下拉底色 / 描边同样分档。验收后已把模拟器偏好恢复为默认（色相 158 / 柔和）。

2026-10-05 取色盘与设置分块：撤销上一轮「色块矩阵」取色，恢复圆环色相 + 明度/饱和方块取色盘（`hslToHsv` / `hsvToHsl` / `hsvToHex`，`.gz-picker-ring` / `.gz-picker-square` / `.gz-picker-sv`）。用户澄清「分块化」指设置功能分块，故把「外观」页从平铺 `Section` 改为分块（block）卡片：`SettingBlock` / `SettingRow` 与 `.gz-block*` / `.gz-set-row` / `.gz-set-inline` 样式，主题模式、主题配色、显示与排版三块，块内行以分隔线相连，恢复默认外观与开发验证移到页面底部操作区。模拟器验收：圆环取色盘与分块卡片在浅 / 深主题下渲染正常，块标题 / 描边 / 面板底色随主题风格变化。

2026-10-05「我的」分组菜单在模拟器验收：三组设置行（图标 + 标签 + 右箭头）与 `继续阅读漫画` 副标题、`通知中心` 红点、页脚版本号均按参考图渲染；`未登录` 弹出「账号功能待接入」提示；`通用` 等未接入项进入「· Future」占位页并可返回；`外观` / `网络` 子页正常。改动为 `src/android/AndroidApp.tsx` 与 `src/android/mobile.css` 的 `.gz-menu*` 样式。

2026-10-05新包启动检查通过：五项导航与外观三个滑块显示，五页412px无横向溢出，4作品 / 1来源 / available目录授权 / 用户外观设置保留。结果与已检查截图在 `D:\DevTools\Android\Build\qa\frontend-20261005`；未重复完整来源 / 播放回归。

2026-10-04的 `scripts/verify-android-ui.mjs` 限定模拟器及 GenzoPrototype 合成目录，覆盖来源启停 / 新扫描、手动整理、搜索空态、收藏 / 评分 / 备注、系统返回关闭抽屉 / 播放器、原生播放、React后台的SQLite进度、首页续播和深浅布局。强制停止后重新连接新WebView，断言DB个人记录 / 进度、主题、来源授权恢复。结果 / 截图在 `D:\DevTools\Android\Build\qa\frontend`。旧脚本「我的 → 目录与来源」选择器需适配新分页后才能继续完整回归。

模拟器视口412px且无横向溢出；顶部 / 底部导航不盖主内容。安全区由原生系统 inset 处理，IME开启时保留可见区；系统返回先关闭键盘，再到应用抽屉 / 路由。首屏缺图和空态按实际数据渲染。Windows三尺寸模拟IPC首页 / 媒体库检查通过，72项前端、266项Rust /14忽略通过；不是所有 Windows 原生窗口与设备兼容验收。
