# Codex 与 DeepSeek Harness 项目交接记录

## Android v0.5.1正式分发（2026-10-08）

- 已公开发布：https://github.com/Boringchen-10/genzo/releases/tag/v0.5.1 。发布提交 `c197e9f40e230d41ef3e71547a1414afdb7b8d94`，注释标签v0.5.1与分支已推送；附件只有正式APK /SHA256SUMS.txt，GitHub资产digest与本地APK SHA256一致。后续交接文档提交不移动发布标签。
- 用户明确要求打包v0.5.1供实际用户分发，不保留 /携带测试数据。基线 `64cd09c`；发布源码用本分支v0.5.1注释标签固定，主目录的桌面 /设计未提交改动保留。
- 同步package /Cargo /Tauri版本0.5.1、Cargo.lock与生成Android versionCode5001。APK普通包`com.genzo.android`、arm64、min26 /target36、非debuggable、R8 /资源收缩；本次Windows安装器仍v0.5.0。
- Android-only入口 /真实Provider /publicDir关闭，生产前端408kB JS，排除桌面mock /演示封面 /设计图；关于显示0.5.1与GPLv3，不展示开发验证页。正式WebView调试关闭，补齐虚拟asset.localhost本地资源许可。开发预览与Windows默认入口保留。
- 正式文件 `D:/DevTools/Android/Build/releases/v0.5.1/Genzo_0.5.1_android_arm64-v8a.apk`，74,869,842字节，SHA256 `d599124d1c7952f1c6f3fa1ee9e73b1e839ff2b1b673c258e3a55e99071a476b`；发布附件只APK /SHA256SUMS.txt，不上传截图 /测试包 /签名私钥。
- 固定签名证书SHA256 `cee90e5f49edc18217ec2d1f7cdf360f50b61af1e99e4eefdb0837b549c13cdb`；本机私钥 /密码仅在 `D:/DevTools/Android/Signing/`，权限限当前用户 /SYSTEM，不纳入仓库。后续发布必须复用这份签名，`build-android-release.ps1`要求已有签名文件。
- 类型 /前端96项、Rust321通过 /18忽略、arm64Release /R8 /lintVital、签名 /16KiB ZIP通过。包内没有DB /测试书籍 /demo /design /fixtures目录；编译前端不含mock /原型文字。正式包已在一加Android16首次安装启动，versionName0.5.1 /5001，run-as拒绝调试且无WebView调试socket；用户在正式包确认小说正文正常。
- 正式包安装前手机没有普通包，本轮首次安装不覆盖readerqa或其数据；没有清库或播种。用户实际浏览产生的数据只留在设备，不进入APK。原始阅读回归与正式验证边界见 `docs/RELEASE_V0.5.1.md`。

## 话末准备下一话（2026-10-08）

- 基线 `5d9533b`，起点干净。用户确认接近本话结束时预载下一话；只做漫画跨话衔接，不扩展整本预取、小说分卷策略或修改已有自动连续阅读开关。
- 向前进入最后约20% /剩余6页范围时，ReaderActivity合并目录请求、缓存直接下一话manifest并预取前6张。两话共用图片并发4 /后台2；准备不写下一话进度、不切话、不递归准备再下一话。下一话离线时只复用manifest /CBZ。
- 切换复用manifest与完成 /正在下载的图片，取消尚未开始的预取让位于当前页；返回上一话从末页初始化为回看方向。背景资料或单图失败保留本话，手动切换正常重新读取失败项，Supervisor避免背景单图异常取消其他准备或崩溃。
- 发现退出动画约0.7秒内旧Surface原来继续网络工作，连续重开测试峰值6；finish时立即取消漫画Scope /预取 /生命周期工作后峰值4。独立writes仍保存位置，旧surface关闭后的回调不再触发预取；缓存章节切换yield一轮避免在ViewPager布局回调中直接换Adapter。
- `verify-comic-transition.mjs` 最终全部通过：触发边界、前6张 /无提前进度、自动切换96ms、在途首图仅一次请求、回看 /真实目录跳章、资料503 /单图503恢复、退出取消与并发≤4。证据 `D:/DevTools/Android/Build/qa/comic-transition-1791468957775/`。原四项 /离线四模式 `comic-four-1791469112421/` 通过；既有单章夹具补齐只有1话的目录响应，不把目录误当图片请求。
- 真实第02→03话：第03话开头6张起点缓存0 /无离线归档；仍读第02话末段时7.76秒准备齐全，latest resume保持第02话；切换到第03话首屏164ms。证据 `D:/DevTools/Android/Build/qa/comic-real-transition-1791469221559/`。暖切换不是首次网络耗时，不承诺所有来源零等待。
- 最终 `D:/DevTools/Android/Build/artifacts/Genzo-comic-transition-arm64-readerqa-6CF11B15.apk`，SHA256 `6CF11B159B26FDB2A3D90647CCE474E59034B21AEBF04CE51AE9E2A36F2C2F39`，79,001,417字节，签名 /16KiB ZIP通过，手机base.apk校验一致。只更新实体机readerqa；普通包、真实媒体、数据库迁移与主Windows工作区不改，不清库或重新播种。

## 漫画渐进整话预加载（2026-10-08）

- 基线 `65512f5`，起点工作区干净。用户确认当前加载快了，但逐页等待不舒服；后续明确“开头加载一部分，进去后加载剩下一部分”。沿用原生Kotlin /Rust，不增加新依赖或整本下载。
- `ComicReaderSurface` 当前页优先、阅读方向后6张 /回看2张优先、后台补齐当前整话；总并发4，后台预取最多2，无排队背景任务占住前台名额。去掉每个滚动事件重置100ms预加载延迟；只在可见页范围 /方向变化时重排。下载完成持续补充，关闭 /换话由scope取消。磁盘图缓存复用、SSIV只解码附近控件；CBZ只预解压附近页。
- 固定Kira源码本身是邻页±2，本次整话策略为用户要求的Genzo增强。不要说完整照搬Kira整话预加载。
- `verify-comic-prefetch.mjs`：36页每图延迟1.5秒，旧包后6页预热断言失败；新包提前准备后6张、六次翻页60–70ms、反向预取、跳页当前请求22ms即开始、停在中间完成全部36页 /并发≤4均通过，证据 `D:/DevTools/Android/Build/qa/comic-prefetch-1791462605665/`。36页快速往返 /跳页 /全章连续阅读仍通过，证据 `comic-loading-1791462684502/`。
- 真实第02话 `c2d8f146-17b6-11e9-bfa4-00163e0ca5bd` 52页缓存起点0；第一屏可见图片齐5.65秒，此时后6图已好。第一屏显示后后台36.6秒补齐52页，期间保持开头未跳页；随后跨段约0.11秒、连续52页通过。证据 `D:/DevTools/Android/Build/qa/comic-real-chapter-1791462858864/`。不把后台时间报为打开总耗时，不把缓存显示报为网络耗时。
- 最终增量Kotlin构建另避免同页滚动重复遍历整话队列；APK `D:/DevTools/Android/Build/artifacts/Genzo-comic-prefetch-arm64-readerqa-98262EA6.apk`，SHA256 `98262EA699728107A3BC8CE500294537A90EADF9D78D889621BA05AAF6636279`，78,985,033字节，签名 /16KiB ZIP检查通过，已安装独立readerqa包且手机校验一致。最终预加载回归通过，六次翻页59–70ms /跳页当前请求11ms开始 /全章36页预取（`comic-prefetch-1791463102581/`）；状态背景、加载期间菜单、整段缩放 /横移、一次失败重试、磁盘重开、CBZ四模式回归也通过（`comic-four-1791463252920/`）。普通包 /真实媒体 /SQLite迁移 /主Windows工作区均未操作，没有清库或重新播种。

## 整话加载停滞与动漫封面修复（2026-10-08）

- 分支 `codex/android-first`，本轮基线 `3c89941`，工作区起点干净。用户报告动漫封面不显示、漫画前几张快后面长期加载；不是仅凭历史首图验收推定网络正常。
- 真机复现：36页每图1.5秒延迟样本快速来回滑，第10页等待7秒仍未渲染；该页请求曾多次被取消，跳开再回来才恢复。Kira pipeline的缓存任务复用没有Genzo这种窗口外全部取消策略。改为保留在途下载 /磁盘图，取消无需求的队列项；挂载控件保护、缓存控件重新挂载恢复取消任务、SSIV旧回调不删除或更新复用控件的新图。
- 动漫首屏封面均为 `lain.bgm.tv` 直连且未完成。背景封面下载另建普通客户端，绕过Bangumi网络；改为可见封面原生请求、同一Bangumi DoH /ECH通道、本地缩略图立即替换、并发4、排队项离屏丢弃、瞬断最多一次自动重试。桌面后台缓存路径保留。
- 已验证：36页第一轮修复回归全部通过，真实 `modujingbingdenuli` 第01话61页连续滑动覆盖全部页 /跨段跳转 /快滑返回通过，最长可见图片等待2.55秒。证据 `D:/DevTools/Android/Build/qa/comic-loading-1791460459156/`、`comic-real-chapter-1791460817683/`。最终AD8E0FCB包的36页延迟回归仍通过（`comic-loading-1791461434147/`），真实61页完整暖缓存再次通过（`comic-real-chapter-1791461533540/`），最长0.667秒、各段跳页约0.11秒；暖缓存结果不能冒称首次网络加载。
- 动漫首屏 /两段快滑 /回顶部全部可见封面解码，未发WebView CDN请求；证据 `D:/DevTools/Android/Build/qa/anime-covers-1791461198978/`。缓存首屏 /返回约0.1秒，两新段各12张全部齐全约10.7 /14.3秒，仍有来源网络波动，不能声称所有未缓存内容已达Kira /Kazumi相同速度。
- 类型检查、96项前端测试、Rust321通过 /18忽略，以及显式Bangumi ECH实网封面 /评论 /分集用例通过。先前状态区 /加载中点击 /全段缩放 /离线四模式回归通过，证据 `D:/DevTools/Android/Build/qa/comic-four-1791461287487/`。
- 最终固定QA包 `D:/DevTools/Android/Build/artifacts/Genzo-reader-loading-arm64-readerqa-AD8E0FCB.apk`，SHA256 `AD8E0FCBCD48249C83B203BFC85738B1919B5D4EC8404DEF004EF16E6AA8C3EB`。原生旧回调保护为最后的Kotlin增量构建；签名 /16KiB ZIP检查通过，已覆盖安装实体机独立readerqa包。普通包 /真实媒体 /主Windows工作区未改；未清库、未重新播种、未正式发布。

## 漫画四项Kira适配修复（2026-10-08）

- 用户确认滚动阅读整段一起缩放 / 横向拖动；状态栏应与界面同色，加载时点击中间可开关菜单。保留已选Kotlin / SSIV与其他模块。当前提交以Git日志为准。
- 实际读取 caolib/kira `fc3f242fee2e3b68de94bc35296fc73db60031c3` 的图片服务 / pipeline / 滚动模式 / pinch_zoomable / API transport。具体对照见 `docs/android/COMIC_KIRA_FOLLOWUP.md`，MIT声明保留。不是嵌入Flutter或声称全部Kira功能均移植。
- 实施：状态 / 切口背景由chrome承载；容器手势覆盖占位；滚动整段1–5倍缩放 / 拖动，分页仍单图；URL哈希跨会话图缓存7天 /256MiB，15s /1次 /200ms策略、±2邻图、有界并发与当前页不排在预加载后；移除在线Rust完整像素解码（下载归档完整验证保留），取消旧读图同时中止远端请求。设置展示真实网络加载均值，磁盘命中不计数。
- 一加实体机 `verify-comic-four.mjs`：延迟首图期间中心点击、两张图统一4.33倍（布局1272 /显示5512）、横向平移、恰好一次自动重试、换令牌会话不重下载、同色状态区以及新自制CBZ四模式 /分页居中通过。证据 `D:/DevTools/Android/Build/qa/comic-four-1791452722619/`。旧reader-fixture缓存目前手机不存在，未覆盖播种DB；本轮用新自制CBZ验证，不能把旧缓存脚本失败报为通过。
- 真实线路0全部不可达，线路1可达；在自动节点模式追加已知另一线路回退，固定节点仍固定，保存设置不变。此兜底为Genzo针对失效线路的补充，Kira原码本身是所选线路内测速权重选择。测速证据 `D:/DevTools/Android/Build/qa/comic-source-probes.json`。
- 真章 `modujingbingdenuli` 第01话成功在线显示，从目录 /章节获取到首图5990ms，重开含章节获取1284ms；均非单张网络耗时，不能宣称全部来源0.5秒。证据 `D:/DevTools/Android/Build/qa/comic-real-online.json` /png。原有设置保留，手机留在这部漫画供查看。
- Rust321通过 /18忽略，前端类型检查 /94项通过；arm64压缩APK构建成功，最终SHA256 `3964F97EC425665EF0C134CD8C61B33704385178C05F92280BA12470300C84CB`，固定副本 `D:/DevTools/Android/Build/artifacts/Genzo-comic-kira-arm64-readerqa-3964F97E.apk`，已安装独立readerqa包。普通应用、真实媒体和Windows主工作区不动。

## 实体机网络、资料共享与轻量化交付（2026-10-08）

- 工作树 `H:/二次元阅读器/.tmp/android-first`，分支 `codex/android-first`。阅读 / 网络六项修复已提交 `a8a0073`；资料共享已提交 `9c48982`，Bangumi持久缓存 / 瞬断恢复已提交 `55c5b9a`；构建优化提交以 Git 日志为准。主目录的 UI / 设计草稿及普通 Android 包不操作。
- 具体借鉴 Kira 的连接池 / gzip / UUID / 缓存 / 按需图片，以及 Kazumi 的 Bangumi DoH / ECH。固定上游、许可、实现与六项样本证据见 `docs/android/READER_NETWORK_FIXES.md`。Kazumi 规则播放与 Bangumi 账号同步仍是后续方向，未声称已实现。
- 从 PC 已提交 `0dae95d` 复用共享 V1 核心，原样加入0026，注册宿主 / 安全凭据 / 后台服务 / 真实面板，接入 PC 与 Android 观看会话。SAF 完整哈希在原生授权文档流上执行，版本 / 属性变化拒绝绑定，WebDAV 正文不自动下载。
- 影视自动同步继续使用 `state.json` V1；各品类资料、来源阅读位置 / 书签通过独立 `personal-data-v1.json` 快照共享，并可系统文件导出 / 预览导入。当前书籍共享需要预览导入，不是后台自动同步；资料包不含媒体正文、设备身份、凭据、本机路径或 Readium 正文摘录。格式 / 操作见 `docs/PORTABLE_PERSONAL_DATA.md`。
- 增量0028 / 0029保存可移植身份和别名；均已在 QA 手机执行，不得编辑。0026 / 0027 原样保留；存量0027补入26的测试保留个人记录和旧校验和。预览内显式文件绑定、既有记录保留、事务重检 / 回滚和规范化书签去重通过。不能重新播种手机 genzo.db。
- 验证：前端22文件 /94项与类型检查通过；宿主319通过 /18忽略，同步核心3单测 /13集成通过；6项资料包测试覆盖阅读时间 / 最近章卷顺序与书签去重。Windows独立 sharingqa 的1024 /1280 /1366 /1440 /1920宽度无横向溢出，真实书架自动刷新且未保存点评草稿保留，PC 管理 / 刮削共享回归通过。
- 最终 arm64 QA APK `D:/DevTools/Android/Build/artifacts/Genzo-sharing-light-arm64-readerqa-364831F6.apk`，SHA256 `364831F65F60B9374CA3C0C0A6531B7D09BD286B172BA520626B4AC6B298554C`，78,952,265字节，已安装一加PLK110 / Android16的 `com.genzo.android.readerqa`。签名与16KiB ZIP对齐通过；这是测试包，没有正式发布 / 升版本 / 标签 / 推送。
- 轻量化：过期前端构建资源约12.7→2.6MiB，修正构建目录重新生成；无引用旧阅读CSS、假WebDAV表单及旧表单样式清理。Rust size / thin LTO / strip，R8 / 资源收缩；初次发现 Wry、Tauri 和 LibVLC JNI 被收缩，补齐保留规则后真机回归。最终APK约112.6→75.3MiB，减约33.1%，保留有效内核 / PC功能 / 原始媒体。详见 `docs/android/LIGHTWEIGHT_AUDIT.md`。
- 真机压缩包 reader-regressions / cover-fling 通过：CBZ打开207ms（测量在故意等待前）、分页上下居中432 /2340，滚动顶部约0；五次实际小说滑动9.9→48.9%，大跳转约0.41–0.42秒。Bangumi各分类 / 评论和COPY评论真实样本返回非空。release Rust 拒绝调试在线夹具入口，压缩回归使用已有自制 EPUB缓存，不弱化生产入口检查。
- `verify-optimized-player.mjs`：专用已授权自制目录 `GenzoSharingQA-1791431130`，h264.mp4 / h265.mkv完整SHA256与D盘样本相同、两编码版本不同，播放 / 拖动 / SQLite位置保存通过。只扫描此测试目录；没有扫描或修改真实媒体。
- `verify-webdav-native.mjs` 最终包通过PC→手机、手机→PC、再次更新、离线保留、恢复与进程重启后Keystore / 空间 / 设备ID保留；待传为0时63.4秒自动接收电脑更新。证据 `D:/DevTools/Android/Build/qa/webdav-native-1791425850165/result.json`；同测试空间仍暂停，端点 `http://127.0.0.1:51799/library/`，libraryId `f361de4e-7bca-480a-84f0-7f309cdeb73a`。用GENZO_SYNC_QA_RESUME / PORT=51799 / APK指向最终包复测，不清库或覆盖其他连接。
- `verify-portable-sharing.mjs` 的 Windows真IPC / Android真IPC漫画、小说、位置 / 书签双向快照和默认保留 / 明确更新通过，证据 `D:/DevTools/Android/Build/qa/portable-sharing-1791444580975/`。最终包 `verify-package-picker.mjs` 的真实系统保存 / 打开 / 预览 / 重复导入保留七部作品通过，证据 `D:/DevTools/Android/Build/qa/package-picker-1791444840440/`。测试文件名带 Genzo-qa 前缀，不覆盖已有文件。
- WebDAV验收使用本机鉴权 / 强ETag服务和ADB reverse，测试后服务停止、反向端口移除、同步暂停。没有用户外部WebDAV服务凭据，不能声称所有真实服务已覆盖。正式包、其他机型 / 页大小设备、任意复杂书籍格式和完整后台阅读同步各自需要后续范围与样本。

- 最终网络回归出现过一次分集12秒超时，补上在线分类的一小时磁盘缓存 / 强制更新 / 失败带提示保留旧值，以及分集公开GET两次各4秒的瞬断重试。最终强制联网回归无缓存兜底：分集1.48秒 /36，角色4.21秒 /91，关联0.38秒 /21，人员2.81秒 /862；评论正常。受控真机缓存命中3–4ms、重启后不发请求、失败刷新保留值 / 警告均通过，证据 `D:/DevTools/Android/Build/qa/bangumi-cache-1791447024922/`。
- 当前完整验收对应表见 `docs/android/DELIVERY_VERIFICATION.md`。桌面投屏已打开。停止本轮隐藏Windows sharingqa进程不影响主Genzo进程或数据库。

## 手机桌面投屏（2026-10-07）

- 用户要求把实体机画面显示到 Windows 桌面以便截图。使用官方 scrcpy 5.0 Windows x64 便携包，ZIP SHA256 `44c10d9e82f20ea67227d14d37bf9fbe3603117c5736df3f514544a02ba20a73`；解压在 `D:/DevTools/Android/Tools/scrcpy-5.0/`，复用 SDK ADB，只指定实体机 `3B164M00Z0500000`。
- 桌面快捷方式 `F:/desktop/Genzo 手机投屏.lnk`，启动器 `D:/DevTools/Android/Tools/open-genzo-phone.ps1`。窗口标题“Genzo 实体机画面”，已核对窗口句柄 / 响应、手机连接与 D3D11 视频解码纹理初始化。音频和剪贴板自动同步关闭，鼠标控制保留；关闭窗口后可双击快捷方式重开。日志在 `D:/DevTools/Android/Build/qa/phone-mirror/`。此为本机调试工具，不是应用运行依赖。

## 实体机阅读预览（2026-10-07）

- 用户随后明确要求在已连接实体机打开效果，授权本轮部署。核对设备为一加 PLK110 / Android 16 / arm64，序列号 `3B164M00Z0500000`；安装既有独立 arm64 QA 包，SHA256 `3ADD334AD5F27C46AFC95CF89341FA0B7ED4DA1E08817CA2B6115073B30124D5`。未更新普通 `com.genzo.android`。
- 该手机安装前没有 readerqa 包；确认新包私有目录尚无 `genzo.db` 后才复制自有合成库与缓存，随后实际 IPC 核对 `/data/user/0/com.genzo.android.readerqa`。后续此包已有阅读记录，不得再次覆盖播种。未修改真实媒体文件。
- 已实际启动 MainActivity 和 ReaderActivity，观察到 Readium 3.1.2 在线小说第01卷正文、滚动位置与原生目录 / 书签 / 设置工具栏，`rendered=true`；截图与状态在 `D:/DevTools/Android/Build/qa/reader-c/phone-preview/visible-reader.*`。保留当前阅读页给用户体验，不继续自动切章或修改设置。
- 自动 React 点击检查遇到转场 / DOM 变化超时；没有将该脚本报为通过。本轮只确认真机安装、启动与当前小说显示，不代表完整真机功能 / 性能 / 来源回归。

## Android 原生阅读 C 方案基础交付（2026-10-07）

- 用户确认 Android 优先，采用 Kotlin 漫画与 Readium 小说。本轮覆盖约定的基础交互与已有来源 / Genzo 缓存阅读；未来新功能与界面优化继续在各阅读模块迭代，不推定已经批准语音 / 标注 / 阅读同步等后续功能。
- 工作树 `H:/二次元阅读器/.tmp/android-first`，分支 `codex/android-first`，基线 `75810a8`；最终提交包含本记录，以该分支 Git 日志为准。只纳入本轮阅读改动，主 Windows 工作区已有设计 / UI 修改未操作。主要技能 project-builder；范围与复现说明见 `docs/android/READER_C_V1.md`。
- 用户已允许构建与电脑模拟器安装。只操作 `emulator-5554` 的独立 `com.genzo.android.readerqa`；IPC 核对数据根 `/data/user/0/com.genzo.android.readerqa`。普通包 `com.genzo.android`、一加手机和真实媒体未操作。QA 数据是自制的两作品、各两章卷，长图1000×12000、小说600段中文和插图；生成目录 `D:/DevTools/Android/Build/qa/reader-c/7cf49f17ac1749228162aef76665c1e2`。
- 实现：Rust `android_reader.rs` 提供本机随机令牌会话、有限并发内容 / 目录 / 位置 / 书签 / 最近阅读；会话关闭终止工作请求。Kotlin ReaderActivity 负责原生控件 / 生命周期，ComicReaderSurface 提供四模式 / RTL / 缩放 / 临时长按 / 查看器 / 自动滚动，NovelReaderSurface 使用 Readium 排版 / 目录 / 插图 / Locator。React BookReader 启动原生页面，OnlineChapters 增加续读与阅读事件刷新。
- 迁移 `0027_android_reading.sql` 已实际执行，新增阅读位置与书签；`0026` 留给既有同步。不得编辑已经运行的迁移；后续数据库改动新增迁移。位置以 kind / 来源作品 / group / entry 绑定，不按临时 URL 存储；打开没有将作品标记已读。
- Readium 3.1.2（BSD-3-Clause）、SSIV 3.10.0（Apache-2.0）、jsoup 1.18.1（MIT）固定，许可在 licenses 与 THIRD_PARTY_NOTICES。Readium 内部使用 WebView；字体大小是比例，UI逻辑值除16。在线 TXT / 目录适配内存 Publication，图片按需读取；旧 `<pre>` EPUB 在内存转段落与可点插图链接，不改缓存或真实文件。
- 修复并验证：滚动模式使用 SDK evaluateJavascript 实际滚动、firstVisibleElementLocator 保存段落、插图 URI 使用分层 genzo-image://reader/、小说旋转按 Activity 重建恢复位置、长按松手恢复原缩放、自动滚动到末尾可进入下一章。QA state 在 UI 线程读取实际视图尺寸 / 缩放 / Window 参数，生产包严格拒绝 QA 控制。
- 最新检查通过：pnpm check，前端21文件 /92项；共享 Windows-target Rust306通过 /17忽略 /0失败（含HTTP令牌 / Origin、分组书签与存量25→27升级保留个人记录和迁移校验和）；x86_64 / arm64 Rust、Kotlin、Gradle打包及APK签名 /16KiB ZIP对齐静态检查。arm64未装真机，也未做Windows安装器 /全窗口人工回归。
- 七组设备脚本通过：verify-android-reader（11项模式 /长图 /RTL /重开）；verify-reader-controls（原生目录 /书签 /设置 /前后章、真实音量、亮度 /常亮）；verify-reader-gestures（真实双指约4.33倍、长按1→2.5→1、双击查看器、自动滚动）；verify-reader-lifecycle（旋转 /进程重启，小说保持#p57 /第357段，漫画保持第4页）；verify-reader-online（自有TXT /插图经真实HTTP Publication，不是第三方取数证明）；verify-reader-recovery（飞行模式缓存目录 /正文、只破坏自制CBZ的第6页失败 /恢复 /重试 /重开，网络与原文件字节已恢复）；verify-reader-entry（真实React章节 /续读按钮、最近任务回前台、原生返回、连续开关、作品状态不改）。最新JSON /截图 /日志在 `D:/DevTools/Android/Build/qa/reader-c/`。早期失败日志保留，但不得作为当前通过证据。
- 最终x86_64独立包SHA256 `B1A3544082FB2CD9842870DD446E97F0D1465682C77B394A8BB8E5BF08F98491`；arm64独立包SHA256 `3ADD334AD5F27C46AFC95CF89341FA0B7ED4DA1E08817CA2B6115073B30124D5`。构建输出在 `D:/DevTools/Android/Build/reader-gradle/app/outputs/apk/`，固定备份见 `Build/artifacts/Genzo-reader-c-20261007-*-readerqa-*.apk`。仅调试包，不是正式发布；版本未提升，无发布标签或推送。
- 续作：先核对 Git / 工作区 / 已安装APK，再按用户指定功能迭代。真实第三方服务、复杂排版、任意外部EPUB / SAF / WebDAV书籍导入、长时间真机与全机型性能、16KiB页设备运行需各自样本验收，不能据合成模拟器结果宣称全部兼容。原生代码改动必须重新打APK；前端预览不能验证它。日常回归保留QA阅读记录；生成新夹具只能使用不存在genzo.db的新目录，不清正式应用数据。

## 安卓加载与会话保留优化（2026-10-07）

- 本轮开始状态：安卓工作树 `H:\二次元阅读器\.tmp\android-first`／分支 `codex/android-first`，HEAD `73c6d69`，工作区干净。`5844264` 已纳入此前漫画首页／OpenDesign 改动；主仓库仍有其他 Windows／设计修改，本轮未操作或提交它们。
- 用户当前要求首次显示更快、进程未回收时切页避免重载，并确认动画参考 Kira／拷贝漫画。首页原本用 `Promise.all` 等全部快照后设置作品，发现页离开主导航即卸载。已改为独立并行更新与快照合并、访问后保留发现／网络组件、保留主导航搜索／筛选／滚动、会话缓存作品与来源资料／评论／目录、恢复章节组／页／顺逆序。隐藏发现页不处理返回键或继续滚动追加。
- 新缓存只存当前 WebView 会话元数据，无凭据／媒体字节或迁移。失败可重试，失效前的旧响应不能回填；保存个人记录、扫描／来源事件、显式刷新和网络保存更新相应资料。原始章节页与显示顺逆序分开，换组／换页保留旧内容并禁用旧章操作直到新数据返回。
- 加载动画用自有 React／CSS 四瓣旋转形变、主题色与 160ms 延迟显示；减少动态效果模式静态提示，不加虚假百分比或新依赖。Kira 参考提交 `fc3f242fee2e3b68de94bc35296fc73db60031c3` 的来源与实现边界见 `docs/android/FRONTEND_LIVE_PREVIEW.md`。
- 已验证：`pnpm check`、`pnpm test`（21 文件／92 项）、Vite 前端构建（输出 D 盘，现有大包提示仍在）；`scripts/verify-android-loading.mjs` 全部通过。受控 React 测试固定作品 80ms、最慢辅助请求 2200ms，基线首屏 2244／2236／2238ms，本轮 116／114／97ms；只能证明解除首屏慢请求依赖，不代表原生 APK 冷启动耗时。隔离 iframe 模拟 API 不替换生产冻结的 Tauri invoke，不下载媒体。
- 真实 `emulator-5554` 预览验证章节末页恢复、书架搜索、发现漫画分类／35 张卡片／约 380px 滚动、网络页再次打开，360／412／915 无横向溢出；20 个作品 ID／收藏／状态／评分摘要一致，页面无 JS 错误。报告与两张截图在 `D:\DevTools\Android\Build\qa\loading-20261007`。Windows 共享前端编译与测试通过，未打 Windows 安装器／做全部窗口人工回归。
- 按用户指示没有构建／安装新 APK，没有操作一加 15、清应用数据或修改真实文件。保持既有 Vite watch + CDP 预览；正常切页保留会话，但保存代码触发整个页面重载会清空内存状态，重启应用需重新启用预览。本轮更改尚未装入任何 APK。

## 漫画详情交互修正与模拟器前端预览（2026-10-07）

- 用户要求七项漫画详情修正，并明确效果确认前不生成新 APK、先在模拟器查看，实体机验证后排。本轮只在 `H:\二次元阅读器\.tmp\android-first` / `codex/android-first` 开发，起始 HEAD `a0ef1d8`。起始 `ExplorePanel.tsx` 与 `mobile.css` 已有 OpenDesign 漫画首页／更多列表的未提交修改；保留其工作文件，通过起始备份与 HEAD 比较仅提交本轮差异。主目录 `main` 的 Windows／设计未提交内容未操作。
- `BookDescription` 对书架与发现书籍详情按实际排版夹到三行，确有溢出才显示展开／收起；作者、状态与标签代替详情来源展示。没有实际本地／WebDAV 文件关联的作品卡片和详情隐藏文件计数与设置，不改变共享 DTO 或 Windows 页面。
- `OnlineChapters` 共用于书架与发现详情，读取来源实际组 ID／总数，显示默认／单行本／其它组与 100 条分页；原生返回多少就展示多少，不伪造组。倒序按全目录映射请求 offset，再反转本页，214 条例子为 114／14／0，末页截取 14 条，避免只反转当前页或尾页重叠。
- 主下载按钮进入多选，同一组内可跨页选择、全选本页、下载所选／取消；组切换清空选择。复用已有章节缓存接口，不再显示每章下载按钮或在线下载设置。下载逐章执行，中途失败保留未完成选择；取消停止后续排队，已经进行的一章由现有后端完成，不宣称原生任务立即取消或后台下载中心已经实现。阅读器传递当前真实组 ID。
- 发现页共享封面转场改为实际被点击的卡片（首页多组存在重复封面时不取第一个）；进入详情滚到顶部，返回恢复列表位置，转场失败清理名称，减少动态效果模式回退正常导航。模拟器实际完成 forward／back 两次 `morph.ready`，无转场拒绝。
- 最终复核发现快速缓存响应会先写完整详情，随后异步转场回调又覆盖为列表简略资料。已调整为完成详情页初始提交后再读取资料；返回／新请求使旧响应失效，资料重试不重复做前进转场。QA 增加进入两次后简介、作者、状态与标签必须匹配原生缓存 DTO 的断言，`cachedDetailPreserved=true` 已通过，避免只看章节或动画成功就报详情完成。
- 不构建／安装 APK，通过 Vite `build --watch` 输出到 `D:\DevTools\Android\Build\frontend-preview`，`scripts/preview-android-frontend.mjs` 在模拟器已安装调试 WebView 的原生源下加载新 React。CDP 仅对当前调试会话 bypass CSP，没有改应用权限、capability 或生产配置；页面使用真实已安装后端。这不是官方 Tauri HMR，重载／重启应用会恢复包内资源，需重新启动预览；Rust／Kotlin 新能力不能靠此更新。完整启动与限制见 `docs/android/FRONTEND_LIVE_PREVIEW.md`。
- 已通过 `pnpm check`、`pnpm test`（20 文件／86 项）与 Vite 前端构建。八组分页单元样本验证顺／倒序恰好覆盖全目录。只改 Android 页面／样式与 QA／文档；Windows 共享前端编译通过，未重新打 Windows 安装器或做全部窗口人工回归。
- `scripts/verify-android-comic-detail.mjs` 在 `emulator-5554` 验证已有作品「魔都精兵的奴隸」三行简介展开／收起，真实 214／20／1 分组，三页与末页 14 条，全目录倒序、多选模式、无每章下载图标、无零文件与设置。三个样本章节实际调用已有后端并缓存成功，保留在 Genzo 阅读缓存；中途失败／重试另用隔离 iframe 夹具验证，不替换冻结的 Tauri invoke。20 个作品 ID／收藏／状态／评分摘要前后相同；不宣称整库文件哈希校验。
- 360／412／915 宽度无横向溢出，页面无 `pageerror`。结果／详情与选择截图在 `D:\DevTools\Android\Build\qa\comic-detail-20261007`，`watch-preview.json` 验证保存 CSS 后模拟器自动应用及恢复。未清应用数据、卸载或操作一加 15，也未修改原始媒体文件。本轮资源只存在于当前前端预览，不能将旧 APK 报作包含这些改动的交付包。

## 动漫热度与漫画首页资料接口（2026-10-07）

- 用户明确：安卓动漫「热门番组」要对应 Bangumi 动画目录「热度」顺序；漫画先提供拷贝推荐、排行榜、热门更新、全新上架、已完结接口，正式页面后续交给 OpenDesign。只在 `H:\二次元阅读器\.tmp\android-first` / `codex/android-first` 工作，起始 HEAD `c2a2ef0` 且工作树干净；主目录 `main` 的 OpenDesign / Windows 未提交内容未触碰。
- 新增 `get_anime_popular` / `api.animePopular(page,refresh)`，调用官网 `https://next.bgm.tv/p1/subjects?type=2&sort=trends&page=1`，保留来源顺序。v0 搜索 `heat` 是累计收藏人数，不能替代官网 `trends`；Windows 原 `get_anime_ranking` / `animeRanking` 保持 `rank` 评分排名语义。
- P1 实际使用 `page`（固定每页 24），`limit/offset` 会被忽略；响应 `total` 是总页数，本轮实测 42 页，最后一页 11 项，越界空页。DTO 返回 `totalPages` / `pageSize` / `hasMore`，不能把 42 当作作品数量。前五项 ID `622288,554779,639938,568244,622206` 与用户图一及官网热度目录一致。该接口是官网内部协议，不宣称 v0 稳定开放 API；沿用客户端系统代理／直连，自定义 v0 镜像不代理 P1。
- 安卓热门区改接此接口，明确加载／错误／重试／过期缓存状态，移除「评分榜／当季列表冒充热门」的两处回退；追加页完整显示，修复已载入内容仍被当季 `seasonalVisible=30` 截断的问题。现有卡片、标签、详情及视觉布局保持，筛选仅针对已载入内容。
- 实测相邻热度页可能重叠，本轮前两页 48 条去重后 46 张卡片，校验原始顺序且无遗漏。P1 新请求独立使用两秒限流，避免共享 v0 后台补图队列导致交互请求长时间等待；不是移除限流，不改变 Windows 原有请求队列。
- 截图复核发现旧加载逻辑在当季／日历较晚返回时会将已追加热门列表重置为第一页。热门分页使用当前快照保存条目／页码／剩余页；独立请求结束时读取当前快照，刷新后的旧分页响应不能覆盖新列表。QA 在追加后与延迟返回后分别校验顺序，避免只检查瞬间成功。
- 新增 `comic_home.rs`、`get_comic_explore_home`、`list_comic_explore_section` 与 `comicExploreApi.home/section`。原生首页七组对应五项需求（排行榜含日／周／月）。真实键为 `rankDayComics/rankWeekComics/rankMonthComics`；推荐和榜单是 nested comic，热门／新上架是裸数组，完结是直接作品。章节名不覆盖作品标题，未知字段保持空值。
- 首页榜单与更多请求采用 `audience=male` 保持原生首页顺序；女频日榜也已实测。作品 `popular` 与榜单行 `popular` 单独暴露，不把榜单快照当榜期新增人数或评分。热门更新仅确认首页组，本轮 12 项，`supportsPaging=false` / `total=null`；不得拿普通更新时间列表充当更多。
- 复用 COPY 当前网络节点、请求与校验、SQLite `metadata_cache`、封面和本地收藏关联；首页与更多 TTL 1 小时，按来源／分组／榜期／受众／分页隔离，刷新失败保留缓存并标记 `stale`，无缓存报错。没有新增依赖或数据库迁移，没有请求章节内容、下载媒体或修改真实文件。Kira 仅为已有 MIT 协议参考，固定研究提交 `ac0a4db1d01f95d816d61a2960c48d5296a70c1b`。
- OpenDesign 接口／状态／示例及限制：`docs/android/DISCOVERY_FEEDS_CONTRACT.md`，并从 `OPENDESIGN_HANDOFF.md` 链接。更新 `PROJECT_CONTEXT.md` / `ROADMAP.md`。漫画五组正式布局尚未接入，不能声称图三页面已经实现。
- 自动检查通过：`pnpm check`、`pnpm test`（19 文件 / 78 项）、`pnpm build`；Windows 目标 `cargo check --manifest-path src-tauri/Cargo.toml --lib`，Rust 全套 299 通过 / 17 忽略 / 0 失败；新官网字段／排序／分页、COPY 分组／非法参数／个人记录与缓存失败测试通过。新增末次 P1 总页数回归断言单独测试通过；显式 `live_discovery_feeds` 两项在线测试通过，并核对全部支持的更多组首项与原生首页一致。
- 最终 x86_64 调试 APK 已用 `adb -s emulator-5554 install -r` 覆盖安装并启动；未卸载、清数据或操作一加 15。`scripts/verify-android-discovery-feeds.mjs` 完整通过：官网热度分页／缓存／末页、原评分榜独立、漫画七组与全部支持的更多分页／女频日榜／非法热门更多请求、UI 前五项与滚动追加顺序。延迟日历返回后仍保持 46 张卡片；412px 无横向溢出、无 JS 错误，安装前后 20 个作品的收藏／状态／评分摘要一致。测试只读取公开作品资料，不写用户作品或账户。
- 固定包 `D:\DevTools\Android\Build\apk\genzo-discovery-20261007-x86_64-debug.apk`，121,746,255 字节，SHA256 `0A4626649C64C04B6BF42422FE857FBC8B2938B2FE004EAC9808E7CA00083E74`，Genzo 库只有 `lib/x86_64/libgenzo_lib.so`；16 KiB zipalign 静态检查通过，未验收 16 KiB 页设备。结果、截图与 APK 校验在 `D:\DevTools\Android\Build\qa\discovery-feeds\result.json` / `anime-popular.png` / `apk-info.json`。Windows 完成本轮共享 Rust 编译／单元测试，未重新打安装器或做全部窗口人工回归。
- 用户随后要求先说明 Kazumi 热门排序。只读研究官方仓库提交 `11671bc0ec61727e99e34810f142a1b5e4121a8e`：官方模式用 `GET https://next.bgm.tv/p1/trending/subjects?type=2&limit=24&offset=0`，每次 24 项，按来源顺序追加／ID 去重，不按本地评分排序；镜像模式用 `api.kazumi.fyi/kazumi/v1/popular/subjects`。实测官方趋势接口前五项与本轮官网目录一致；响应 `count` 的统计窗口／权重未在 Kazumi 客户端确认，不宣称播放量或收藏量。标签推荐是另一条请求分支。本轮未因参考对比改换 Genzo 已确认的官网目录接口。

## 安卓 v0.2 发现、COPY 阅读与评论补充（2026-10-07）

- 当前工作树 `H:\二次元阅读器\.tmp\android-first` / 分支 `codex/android-first` 保留 HEAD `7982c3a` 及本轮 15 个有效未提交文件改动。本轮完成 OpenDesign 发现页的热门 Bangumi 默认内容、官方 / 镜像 / 自定义源选择、多标签筛选和滚动追加；动漫详情接入剧集、概览、吐槽 / 评论、角色、关联作品、制作人员、标签和资料，并为缺失数据提供空状态。
- 动漫卡片进入详情使用共享封面过渡，返回时反向恢复原卡片位置，兼容列表滚动、返回键和小屏布局；未改播放器视觉控件，仍保持播放、字幕、倍速和续播范围；未实现用户明确不需要的资料字段锁定。
- COPY 漫画和轻小说发现、详情、章节分页、应用内阅读和加入阅读书架已接入。列表、详情和章节目录支持滚动追加并保留筛选 / 搜索 / 滚动状态；下载沿用现有 COPY 阅读缓存接口，目标为应用缓存离线阅读，不导出文件。轻小说首次进入曾遇网络失败，点击重试后成功加载真实作品、34 个在线卷章节、正文和插图。
- 书架漫画章节在页数声明不完整时按实际返回页兼容处理，单页网络失败保留重试和明确错误状态。COPY 评论请求已按 Kira 协议补充 `Origin`、`Referer` 和 `sec-fetch-site` 来源头，漫画与轻小说分别调用评论接口；若服务端仍返回 HTTP 500，界面显示错误状态，不伪造评论，也不扩展为无授权抓取。
- 前端验证：`pnpm exec tsc --noEmit`、`pnpm test -- --run`（19 个测试文件、78 项通过）和 `pnpm run build` 通过；Rust 验证：`cargo test --manifest-path src-tauri/Cargo.toml --lib`（293 通过、15 忽略、0 失败）。Android x86_64 构建通过。
- 最新 APK 已覆盖安装到 `emulator-5554`，未清除应用数据、未卸载、未操作一加 15：`D:\DevTools\Android\Build\gradle-genzo\app\outputs\apk\universal\debug\app-universal-debug.apk`，大小 `121746255` 字节，SHA256 `5203B6A8ED8753F1B4DBF1EA4FE10326CB84D0AB62E0194BA563AAD99AAC9A15`。模拟器已验证轻小说真实列表、详情、34 个章节、章节阅读器正文和插图，以及重新安装后媒体库 / 书架数据保留。
- 本轮尚未宣称 COPY 评论接口在所有服务端节点可用；需要服务端实际返回成功数据后才能验证评论内容。后续仍可单独优化播放器视觉控件和更细的 OpenDesign 动效，不扩大本次范围。

## 安卓 v0.2 发现与阅读补充（2026-10-07）

- 当前工作树 `H:\二次元阅读器\.tmp\android-first` / 分支 `codex/android-first` 在上一版视频交付基础上新增 COPY 漫画与轻小说在线章节阅读、Bangumi 网络传输设置和发现页缓存 / 动效接入。用户明确不需要资料字段锁定，播放器正式控件仍留待后续。
- 发现页“热门番组”现在调用已有 `get_anime_ranking`（Bangumi 官方 `POST /v0/search/subjects`，`sort=rank`，本地 12 小时缓存），首屏再显示当季番组；热门条目按 Bangumi 返回的标签生成多选筛选。发现页模块级缓存保留排行、当季和放送表，返回页面不会重复等待网络；Bangumi 网络配置变化会清除缓存并重新加载。
- “我的 → 网络 → Bangumi 数据源”支持系统代理官方 API、官方直连和自定义镜像；自定义镜像增加 Kazumi 兼容镜像预设 `https://api.bgmapi.com`，也可输入兼容 `/v0` 与 `/calendar` 的 HTTPS 根地址。镜像设置按来源隔离探索缓存，不改变 Windows 默认行为。
- 模拟器 `emulator-5554` 覆盖安装并验收：发现页显示 20 部真实 Bangumi 热门条目和多选标签；COPY 作品“魔都精兵的奴隸”返回 100 个章节，打开第 01 话后阅读器加载 61 张页面图片。未清应用数据、未卸载、未操作一加设备。
- 前端 `pnpm exec tsc --noEmit`、`pnpm run build` 和 Vitest `19` 个文件 / `78` 项通过；Android x86_64 Rust 编译通过。由于中文路径下 Gradle loopback 启动异常，使用 `C:\genzo-android-copy` ASCII 构建副本完成 Gradle `:app:assembleX86_64Debug -x :app:rustBuildX86_64Debug`，生成包：`D:\DevTools\Android\Build\artifacts\Genzo-android-reading-bangumi-20261007-x86_64-debug.apk`，大小 `174,071,117` 字节，SHA256 `214EBA4EF14CA62CED1BACDBC0920E105DD3A2B9895353D8F8793A911112BC74`；`zipalign -P 16` 通过。

## 安卓设计 v0.2 视频接入交付（2026-10-06）

- 工作树 `H:\二次元阅读器\.tmp\android-first` / 分支 `codex/android-first` 已完成最新 OpenDesign 前端的视频业务接入。本轮只覆盖视频管理、SAF / WebDAV、所选文件整理、资料匹配 / 刷新、分集纠错、应用内播放与续播；阅读器、阅读统计、历史清理、跨设备同步和原生播放器正式控件留待后续。用户明确不需要“锁定资料字段”，安卓页面没有该入口，共享 Windows 接口保持兼容。
- WebDAV 添加 / 测试 / 逐级目录选择 / 凭据更新、SAF 重新授权、来源启停、失败重试、扫描状态和详情刷新已接入。待整理的候选确认、手动创建、归入已有作品都只处理勾选文件，未选文件保留待整理；`create_work_from_media` 的 `selectedMediaIds` 为兼容可选参数，Windows 不传时保留旧整组行为。
- 作品列表增加只读 `sourceScopes`：按实际关联文件归属本地 / WebDAV，混合来源同时出现在两类筛选，无关联文件只在全部，停用 / 离线 / missing 不改变归属，不新增数据库列。
- Android TMDB Token 使用现有 Keystore 凭据桥，保存并读回验证后才删除旧 SQLite 明文；设备数据库核对结果为 `plainTokenRows=0`、`keystoreMarker=1`、`integrity=ok`，未读取或回显 Token。动画 TMDB 补源改用影视模块的 reqwest 0.12 请求链路和现有类型解析，规避 Android reqwest 0.13 平台证书验证器初始化 panic；Windows 原链路保留。
- 验证：共享 Windows Rust `275 passed / 14 ignored / 0 failed`；前端 18 文件 / 74 项、TypeScript / Vite 构建通过；Android x86_64 Rust / Gradle、安装、启动通过。`scripts/verify-android-video-v02.mjs` 成功覆盖来源、所选文件整理、个人记录、WebDAV 原流播放 / 续播、筛选、重试、Bangumi、真实 TMDB 电影 / TV；布局脚本在 360 / 412 / 915 宽度共 15 个视图通过，无横向溢出、页面重叠或前端 pageerror。最终动画刷新结果为 22 集且第 7 / 8 集人工纠错保留，耗时 3518 ms。
- 最终调试 APK：[Genzo-android-design-v0.2-20261006-x86_64-debug.apk](D:\DevTools\Android\Build\artifacts\Genzo-android-design-v0.2-20261006-x86_64-debug.apk)，116,208,463 字节，SHA256 `330E14D3FF6C099DE901D63F3D4E51FB5013050B52A703FBBEBF07F653D91E59`；`zipalign -c -P 16 4` 通过。仅验证模拟器，未做 16 KiB 页设备实测。
- 尚未实际撤销系统 SAF 权限后重新授权；本轮也未覆盖大库、第三方真实 WebDAV、真机画质 / 硬件解码和长任务生命周期。模拟器中用户已配置的 TMDB Token 保留，QA 自建来源结束时停用并保留记录。

## 中转站后端续作提示（2026-10-06）

- 用户将把剩余安卓后端接口交给看不到本对话的中转站模型。已创建可整段转发的独立提示：[docs/android/CODEX_BACKEND_CONTINUATION_PROMPT.md](docs/android/CODEX_BACKEND_CONTINUATION_PROMPT.md)。提示要求按当前代码和 Git 状态核实，不照搬旧版后端 Prompt 中已过时的未实现清单。
- 当前安卓工作树 `H:\二次元阅读器\.tmp\android-first` / `codex/android-first` 在生成交接时干净，HEAD `bbe6afa`；后端核心已在 `3b754ca` 接入。主工作目录 `H:\二次元阅读器` / `main` 有用户和 OpenDesign 未提交内容，续作必须只在安卓工作树继续并保留主目录内容。
- 用户当前要求先在 `Genzo_Pixel9_API36` / `emulator-5554` 虚拟机观察，不要安装到一加 15。尚待完整验收的核心是实际识别 / 候选 / 纠错 / 刷新闭环、SAF 撤权恢复、扫描长任务及前后台生命周期等；共享作者、`sourceScope`、真实浏览时间字段仍未获批准，不得擅自改 DTO / 迁移。OpenDesign 新增的历史清理、阅读统计和跨设备同步预览不自动扩大后端范围。
- 产品数据方向：优先复用 PC，不更新 `bangumi-data`；本周日历保留已确认的实时 Bangumi `/calendar` + SQLite 离线缓存，历史季度不能伪造为实时结果。

## 安卓后端接入 / 模拟器验证（2026-10-06）

- 在 `H:\二次元阅读器\.tmp\android-first` / `codex/android-first` 承接 OpenDesign `4c96046`，起始只有其未跟踪的 `docs/android/CODEX_BACKEND_PROMPT.md`；原件保留且不纳入本轮提交。主 Windows 工作区的 UI / 文档草稿未触碰，版本仍沿用 v0.5.0 基线，没有发布 / 标签 / 推送或手机安装。
- 用户确认实时 Bangumi 日历 + 离线缓存，随后要求优先复用 PC、不要更新 bangumi-data。本轮只将 Android `get_weekly_calendar` 接 PC Bangumi 客户端 `/calendar` 星期分组与现有 SQLite metadata_cache（成功缓存 6 小时，失败保留旧成功时间 / stale，冷启动离线报错）；历史季度概览仍为 PC 旧索引，2026-10 可为空，不能称实时历史季度已实现。Windows 原有探索保留。
- 冻结的 `control_internal_player`、`pick_external_subtitle`、`list_subtitle_candidates` 已接；稳定媒体 ID 的 SAF / WebDAV 播放、显式字幕 ID、唯一自动关联 / 多候选人工选择、毫秒偏移、会话与参数验证、未知时长 null、SQLite 进度 / 续播均可用。远程字幕限制已索引 SRT/ASS/SSA、16 MiB 私有临时文件；视频没有完整缓存兜底或转码。
- 复用 PC WebDAV 添加 / 浏览 / 凭据更新 / 索引，Android 凭据仍在 Keystore 加密私有存储。严格原流代理检查 Range、记录连接故障；故障覆盖内核误报 ended，并避免接近片尾错误样本被标记看完。模拟器合成 Basic Auth 服务通过扫描只读 PROPFIND、原流播放 / seek / 1.5×、音轨 / 内嵌 ASS、外挂 SRT、401 / 无 Range、断线 / 重连续播、离线保留索引 / 收藏 / 笔记 / 进度及恢复复用。
- 四类事件已接：android-source-state / scan-task-updated / recognition-updated / player-state；共享识别 / 确认 / 纠错 / 撤销 / 手工整理 / 刷新通知重新读快照。前端按实体 revision 丢弃旧事件，监听后 / 返回前台读取快照，解除与部分注册失败清理有单测；正常扫描通知至少隔 500 ms，终态即时。大库长任务 / 取消竞态 / 前后台反复切换尚未完整验证，保留扫描 1 秒轮询。
- 原目录浏览继续沿用原型 `android_native(listTree,{sourceId,uri?})`，Rust 注入登记根，原生核对授权树；页面已传来源 ID。两个合成目录授权独立定位、切换后原根保留、跨树拒绝通过；新增 Nested QA 来源结束后停用，不撤销原授权。正式独立目录业务命令名称尚未冻结，不宣称原型方法已变成正式命令。
- 实际截图发现并修复两类原生问题：系统选择器销毁 surface 后只在 onCreate 绑定导致黑屏，改 onStart/onStop 重绑 / 释放；debug goldfish/ranchu 的硬解暂停 seek 保留旧帧，仅模拟器改软件解码。另定位暂停修改倍速会丢弃当前长字幕 cue，保存选定值并在 Playing 应用，不自动恢复播放。新包手选 SRT、ASS / SSA 基础样式、远程 seek + 倍速 + 偏移后字幕均实际查看截图。
- 后端 Prompt 的 category 缺失判断过时，现有 work_category.rs 已提供派生分类。作者 / sourceScope / 真实浏览时间与其“不改 DTO / DB”约束冲突，未扩大结构；网络范围仍回退 local，浏览排序仍 updatedAt。WebDAV 正式连接表单尚需 OpenDesign 接入；`我的 → 网络` 是阅读网络占位，不能冒称 WebDAV 表单。真实 Bangumi / TMDB 自动识别 / 候选 / 纠错 / 刷新闭环、撤权恢复、大库、复杂字幕 / 字体 / HDR / 音频输出仍待验收。
- 最终回归：Windows 共享 Rust 272 通过 / 14 忽略 / 0 失败，含存量迁移与原有远程缓存 / 下载；前端 18 文件 / 74 项、TypeScript / Vite 构建、Android x86_64 Rust / Gradle 打包通过。没有新增迁移 / 依赖，也未重新打 Windows 安装器或做全部原生窗口人工回归。现有 Vite chunk / Kotlin / Gradle 弃用提示保留。
- 最终固定包 `D:\DevTools\Android\Build\artifacts\Genzo-android-backend-20261006-x86_64-debug-preview.apk`，121,746,255 字节，SHA256 `28f83845af173b663d5aa4dd9da764addd265fb6b3c0db62a208815ec120e8ab`。源 .so 与 merged、APK 与 stripped 哈希相符（符号裁剪使源与 APK 不应直接比较）；zipalign 16 KiB 静态检查通过，无 16 KiB 页设备验收。较早同日非 preview 包含上述显示问题，保留但不用于修复验收。
- 新包五项实际 React 导航在 412px 无水平溢出，force-stop 后 SAF 授权 / 启停、观看进度、外观及日历缓存保留；模拟器停留首页。QA `scripts/verify-android-backend.mjs` / `verify-android-subtitles.mjs` 限定模拟器与自制样本；结果 / 截图 / UI smoke 脚本在 D:\DevTools\Android\Build\qa\backend。早期失败日志保留用于定位，最新 backend.json / subtitles.json / ui-smoke.json 为成功记录。
- 供 OpenDesign 的实际接入说明、缺口与验收边界见 `docs/android/BACKEND_INTEGRATION.md`，已同步桥接契约、设计回应、预览、播放器评估、上下文与路线。下一阶段先接正式 WebDAV 表单 / 错误入口及原生设计，继续验证真实识别与权限 / 生命周期；漫画 / 小说阅读、网盘账号直连、后台服务 / PiP / DRM 不在本轮交付。

## 安卓模拟器继续前端迭代（2026-10-05）

- 用户要求打开电脑虚拟安卓继续优化已有前端，仍只部署模拟器。本轮核对 `codex/android-first` / HEAD `8f3c146`，起始工作区干净；保留 OpenDesign 最新五项导航、首页分类滑轨及「我的」三段分页 / 外观控件，没有修改前端。主目录 Windows 与其他未提交修改未触碰。
- Studio 内嵌 Genzo 模拟器的 shell 再次超时，日志存在 getVmState DEADLINE_EXCEEDED。仅停止核对过的该 AVD qemu，用已有脚本 software / 关闭 Vulkan / 冷启动打开独立可见窗口。首次窗口启动后退出，日志为正常关闭信息，原因未确定；再次启动、安装与启动成功，没有 wipe-data、卸载或清除应用数据。
- TS / Vite 与 x86_64 Rust 编译通过。`build-android.ps1 -Studio -Target x86_64` 保持 IDE 桥后，发现两个 APK 输出仍为昨日时间；显式运行 Gradle `:app:assembleX86_64Debug` 成功，生成 `Build/gradle-genzo/app/outputs/apk/x86_64/debug/app-x86_64-debug.apk`。不得只据编译完成或旧 APK 文件存在判断最新前端已打包，需核对输出及安装后界面。
- 最新固定包 `D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-20261005-x86_64-debug.apk`，121,287,503 字节，SHA256 `fd1605433a1e5c8f182ddb399025aad628b6033b6b0d2bebf507c4e376073506`。旧包保留；本轮没有生成或部署手机包。
- 实际安装 / `am start -W` 返回成功；WebView 检查首页 / 媒体库 / 书架 / 发现 / 我的五导航，以及外观三个滑块显示。四作品、一 SAF 来源、available 目录授权与深色设置保留；用户已有色相208 / 模糊28 / 圆角8未重置。五页412px视口均无横向溢出，已查看首页和外观截图。结果 `Build/qa/frontend-20261005`；这只是新页面启动检查，没有重复上一阶段完整来源 / 播放 / Windows 回归，也没有验收热更新或 Studio GUI Run。
- Android Studio、独立模拟器窗口及 Tauri IDE 桥已保持打开。当前 React 修改仍通过构建 / 安装更新；`scripts/verify-android-ui.mjs` 的旧「我的 → 目录与来源」选择器需在后续完整回归前适配新的分页，不能据旧脚本断言新导航已经完整验收。

## 安卓可操作前端 / 模拟器优先（2026-10-04）

- 用户希望OpenDesign也能修改实际前端，边看边指挥迭代，要求生成可转发Prompt。已写 `docs/android/OPENDESIGN_ITERATION_PROMPT.md`，区分共享工作树直接修改与独立环境导出补丁；原生与后端由Codex维护，实时通道未验收，不声称OpenDesign已能访问本地目录。前端改动按实际接口，WebDAV是首版待接入目标、书架 / 探索为Future。后续优先核对OpenDesign访问能力与搭建模拟器热更新。
- 用户随后截图报告Studio无法终止旧app；日志已执行assembleX86_64Debug，但模拟器shell与console均5秒超时、gRPC getVmState超时。停止已核对属于Genzo_Pixel9_API36的失响应qemu进程后，用原脚本software / 关闭Vulkan / 禁止载入快照冷启动，没有wipe-data。冷启动时包未登记，重装固定前端APK后恢复4作品 /1来源 /dark /available授权；已有应用数据仍在。新app force-stop返回0、pid消失、am start -W返回ok、MainActivity前台，已验证ADB恢复，未宣称GUI Run已通过。脚本将该AVD默认设为冷启动，并明确拒绝暂未断开的旧ADB连接，避免空数组报错；快照是否为失响应根因仍未确定。
- 用户在Studio Run时截图报告选中 `armDebug` 与模拟器 `x86_64,arm64-v8a` 不兼容；实际ADB核对ABI相符，32位ARM变体选择错误。当前应在Build → Select Build Variant将app切为 `x86_64Debug`，目标选Genzo_Pixel9_API36；已通过ADB再次发起既有前端启动。尚未宣称切换后的GUI Run通过，说明见 `docs/android/ANDROID_STUDIO.md`。
- 用户最新要求先在电脑模拟器展示有前端的程序，便于继续设计与加功能；暂停实物手机展示 / 安装。本轮只对 emulator-5554 部署与测试，一加保留第二阶段原型。
- 阶段二已提交 `b384df7`；当前仍在同一独立工作树 / 分支。React 启动改为 AndroidApp，按 OpenDesign Android v1 接首页、媒体库、收藏、我的、来源、待整理、详情；深浅 / 系统主题保存共享设置，真实 DB 数据，无静态演示作品或角色资产。诊断页移到“我的 → 开发验证”。
- 已通过模拟器 UI 操作：来源启停 / 扫描、合成文件手动整理、搜索空态、收藏、评分 / 备注、原生系统返回、详情播放、SQLite 进度与首页续播。候选搜索 / 确认和资料刷新连接共享接口，但真实联网作品闭环未验收；WebDAV 页面 / 播放、原始目录分组 / 大库、自动字幕候选和原生正式控件仍待接入。
- `open_internal_player` 由稳定媒体 ID 查 SAF URI，不接受页面任意 URI；`get_internal_player_state` 返回规范快照。Rust 在 React 后台时每5秒及状态改变保存共享 playback_progress，原生私有偏好保留最后样本、返回 / 重启时恢复；陈旧 / 无效 / 未索引样本拒绝写入的单元测试通过。无新迁移，也不更改 Windows PotPlayer 写入逻辑。
- MainActivity 处理真实 systemBars / displayCutout / IME inset；返回先关闭键盘（系统行为）、再关闭抽屉、后退路由。PlayerActivity 使用 ComponentActivity 返回回调；Android16平台Activity返回失效的问题已修复并复测。模拟器首次全屏系统教学遮罩已手动确认，未把遮罩当播放错误。
- Windows Rust266通过 /14忽略 /0失败，前端72通过，TS / Vite / x86_64 APK构建通过。1024×640、1366×768、1920×1080浏览器模拟IPC的Windows首页 / 媒体库无横向溢出，min-width1024保留；不是Windows原生全面人工验收。旧capture-theme-preview的待整理选择器与当前入口不一致，本轮未改旧脚本。
- 已验证独立包 `D:\DevTools\Android\Build\artifacts\Genzo-android-frontend-x86_64-debug.apk`，SHA256 `65f7894aa3e89a43cf42ca9c26d9f5f3a6c505fe96f135cf6be321ff91f3d600`。模拟器原始 UI QA / 截图在 `Build/qa/frontend`，脚本 `scripts/verify-android-ui.mjs` 只操作本轮合成视频。
- 启动 / 编辑方式见 `docs/android/FRONTEND_PREVIEW.md`；独立 APK 无需开发服务器，当前修改 React 后重新构建安装更新。尝试独立1421开发端口后，安装的包仍加载tauri.localhost，热更新未验收；未保留未验证的Preview脚本 / 配置，Studio使用已验证的x86_64构建桥。新增工程 / 缓存仍 D，代码 H，主目录草稿未纳入提交。后续继续逐步接底层与正式控件，不将当前可操作前端称完整安卓首版。

## 安卓本地索引 / 电脑模拟器（2026-10-04）

- 第一阶段已提交 `dfdbe85`，后续仍在 `codex/android-first` / `H:\二次元阅读器\.tmp\android-first`；主目录其他修改与 Windows 发布标签保持。
- 增量 0025 新增 SAF 来源 / 文档定位表，保留既有根 / 媒体 / 作品模型及历史 CHECK / 迁移；虚拟 ID 字节编码与 URI / 相对目录分开，不将 Android URI 当 Windows 文件路径。目录只查询元数据，没有读取 / 下载完整视频。
- `authorize_video_source`、`get_video_source_states`、`scan_video_source` 已实现；可登记用户先前授权的最近目录。任务预先创建后异步执行，复用共享 list / cancel / retry、事务与元数据复用；失败不标记旧文件缺失。来源列表返回已知授权 / 扫描状态，不进行全树探测。重新授权限定原目录，停用保留数据，来源删除与挂载类型修改被拒绝。
- 一加原型从 24→25 迁移，持久化 / 缓存 / 凭据 marker 保留。真机与模拟器两层合成目录索引 4 视频 + SRT / ASS / SSA 三字幕，季集解析、重复扫描 ID / 文件更新时间戳与元数据复用、手工建作品 / 收藏 / 评分 / 状态 / 备注通过。队列取消、部分拒权 / 不可用保留由单元测试验证；手机实际撤权再授权和大库未验收。
- Windows Rust 265通过 /14忽略 /0失败，前端72通过，TypeScript / Vite及Android两个ABI编译安装启动通过。存量0024合成库升级校验历史checksums、个人记录、进度与外键；不是用户真实库测试。两个设备本地播放样本QA已复测，截图已检查，HDR / 字体附件 / 复杂字幕等范围不扩大。
- 用户要求电脑上也有可见模拟器，已创建并运行 `Genzo_Pixel9_API36`（Android16/API36、Google APIs revision7、x86_64、Pixel9、4GiB/4核），WHPX可用；一加同时在线。系统镜像 / AVD / emulator home在D；C盘三个本轮新建小元数据文件已移D，其余旧配置保留。自动GPU在VLC测试后有external memory import错误，现software并关闭Vulkan，重启后QA通过。
- 使用 `scripts/start-android-emulator.ps1`，构建 `build-android.ps1 -Target x86_64`；真机默认aarch64。ADB明确 `-s`；QA手机9226 / 模拟器9227。系统镜像WebView133需CDP noDefaults；启动PID短暂为空的QA竞态已处理，不是应用崩溃。
- Studio默认Universal限定两种已验证ABI，arm64 / x86_64 Rust构建任务均通过；普通CLI Android构建会覆盖IDE临时连接，需最后以 `-Studio -Target x86_64` 重新保持桥。目前构建桥存活，Studio与模拟器可见；GUI Run点击仍未验收。
- 安卓原型解除Windows全局1024px最小宽度，模拟器viewport412/scrollWidth412；Windows样式不变。仍显示明确验证页，没有把它当OpenDesign正式交付。
- 固定测试APK：D盘Build/artifacts/Genzo-android-stage2-arm64-debug.apk（SHA256 20c0ebb795708d83d30ab36f923e4d49a3364c5a86e3c69b494e259b657c94d8）与stage2-x86_64-debug.apk（b6dc261864d731d997c10545d0ce0c69f7e166ec0e310ce6f760d8687ad2aca9）；均已安装实测。QA结果在Build/qa/phone-stage2与emulator，不入Git。
- **后续工作**：原始目录层级与共享作品文件夹分组衔接，自动刮削 / 候选 / 人工纠错 / 刷新手机闭环，稳定媒体ID的SQLite观看记录 / 续播、自动字幕多候选、WebDAV鉴权 / Range / 中断恢复、正式OpenDesign页面 / 原生控件及主题安全区。当前 `android_native` 为QA；正式玩家业务接口仍未实现。参照 `docs/android/SAF_INDEX.md`、`BRIDGE_CONTRACT_V1.md` 与 `VALIDATION.md`，不能把当前测试包称完整首版。

## 安卓第一阶段：兼容性 / 真机原型 / 播放内核（2026-10-04）

- 用户已明确启动安卓视频首版：媒体管理 / 应用内播放，本地 SAF + 用户 WebDAV，动漫 / 电影 / 电视剧；漫画 / 轻小说阅读后续。此前仅兼容性审查 / 伴侣客户端讨论已被此次用户范围更新。保留 Windows 已有功能。
- 实际从发布 `v0.5.0` / `81b41d1ddb076cad784a9eb909fc147b2f3db538` 创建 `codex/android-first`；工作树 `H:\二次元阅读器\.tmp\android-first`。本地与 GitHub tag 对象 `82bc6d821c83b484fd9fc2782d69acc5c0535e15` / 解引用均核对，标签未移动。根目录 main 的 UI / 缓存 / OpenDesign 草稿等其他修改未纳入本分支，不覆盖它们。
- 新增 `src-tauri/gen/android`，包名 `com.genzo.android` 与 Windows 分开；React 按 Android UA 进入明确标注的诊断原型。Windows 保留原 App / 配置，Rust 桌面凭据逻辑未改。
- D 盘已有 SDK / NDK r27 / Java17 / Cargo / Gradle 可用；CLI2.11.4 / Rust Tauri2.11.5，Kotlin2.2.10 / AGP8.11.0 / Gradle8.14.3。构建 / cache / temp / 测试片均在 D 盘，代码 H 盘；脚本 `scripts/build-android.ps1`，中文路径 / 跨盘 Kotlin 增量问题已解决。
- 真机已验证：OnePlus PLK110（用户的一加 15），Android16 API36 arm64、4 KiB 页。编译 / 安装 / 启动、Rust invoke、24 迁移与 SQLite integrity、强制停止后的 DB / 图片缓存 marker / Keystore AES-GCM 凭据、SAF 持久访问和未授权 URI 拒绝通过。用户报告已授权目录，最新实际 URI 为 Download/GenzoPrototype 子树；仅测试合成文件，未索引或读取其他真实视频内容。
- LibVLC3.7.7 已作为首版主内核：合成 H264 MP4、H265 MKV，暂停 / seek / 1.5x、双 AAC 音轨、内嵌 ASS、外挂 SRT / ASS / SSA v4、偏移、方向、URI 哈希的原型续播通过。截图实际查看；缓冲完成状态不恢复的缺陷已修复并复测。字体附件 / 复杂特效 / HDR / 音频输出 / 远程业务仍未验收。没有转码或复制完整本地视频。
- ZIP16K 与四个原生库 ELF LOAD0x4000 检查通过，只是静态检查，尚无16K设备实测。debug 原型 APK 不等于正式发行 / 最终包体。
- 用户要求使用 Android Studio 方便查看，已重新显示工程；Studio实际日志确认 system/log 及 GradleJDK/syncTEMP在D。`build-android.ps1 -Studio` 保持 Tauri IDE桥，不关闭其后台命令就可继续Studio构建；本地配置传递 NDK 链接器等环境，`rustBuildArm64Debug` 实际通过。IDE用户配置小文件留原C位置，其余现有配置保留。启动错误定位为 IDE 安装 JAR CRC 损坏，已备份并从已校验官方安装包恢复，382 个 lib JAR CRC 检查通过。GUI Run 尚未记录为通过。
- Windows 回归 `cargo test` 260通过 /14忽略 /0失败，包含存量迁移测试；前端72通过、TypeScript/Vite构建通过。手机暂只初始化基线库，不能声称手机历史库升级已验。QA脚本 / 结果位置见 `docs/android/VALIDATION.md`。
- 已完整阅读 OpenDesign 手机 CODEX_PROMPT / HANDOFF / Token / 状态 / 导航 / 能力表，原件归档 `design/open-design/android-v1`（没有复制未授权角色资产）。七项回应与冻结桥接见 `docs/android/CODEX_RESPONSE.md`、`BRIDGE_CONTRACT_V1.md`；设计表旧 v0.1 判断不能覆盖实际v0.5.0。其 WebDAV Future 与用户范围冲突，按用户要求首版保留 WebDAV。正式页面 React，独立 native Activity 播放；用 Tauri invoke/listen，不新增手写JS接口。
- **下一阶段未完成**：SAF递归来源 / 增量索引 / 任务 / 取消重试，接共享候选 / 纠错 / 刷新 / 收藏，稳定媒体ID SQLite观看记录 / 首页续播、自动字幕候选、WebDAV鉴权Range断线、正式OpenDesign页面 / 原生控件、主题安全区与错误流程。当前 `android_native` 是QA入口，不能被当正式业务API。
- 第一阶段报告 / 包体依据：`docs/android/PLAYER_EVALUATION.md` 与 `VALIDATION.md`；Windows发布审查保留在 `docs/RELEASE_V0.5.0.md` / `ANDROID_BASELINE_V0.5.0.md`，后者是实现前快照，当前事实以上文与验证报告为准。版本仍保留发布基线号，无 Android 正式标签或公开Release。
- 固定测试 APK：`D:\DevTools\Android\Build\artifacts\Genzo-android-stage1-arm64-debug.apk`，153,817,025 字节，SHA256 `3304df1fcd14372654319b72c7cd0d5021cf873d4880e8e6343dbf269e61dc03`，已重新安装并完成真机 QA。凭据 JS 读取拒绝检查也已通过。APK / 本机 QA 原始结果不入 Git，不能将原型当作完整安卓首版。

## Windows v0.5.0 发布准备（2026-10-03）

- 发布分支 codex/release-v0.5.0，托管工作树 C:/Users/Administrator/.codex/worktrees/bookshelf-backend/二次元阅读器；主目录仍保留未完成草稿。已提交有效桌面集成 8297f4d、旧库兼容修复 68ea401 和用户指南 df147f4。
- 版本同步 0.5.0，Windows NSIS / WebView2 离线运行时构建通过。前端 72 项、Rust 260 项通过 / 14 忽略；Clippy 通过但有既有警告，rustfmt 既有差异未通过。详情见 docs/RELEASE_V0.5.0.md。
- 已备份并验证实际旧库 0008→0024，个人数据保留，原有外键异常不增加。安装 / 重新安装及程序正常启动通过；干净系统、WebView2 缺失和原生全部控件人工验收留待用户。
- 本节为发布提交前快照，正式源码提交 / 标签 / 安装器校验 / Release 链接将在发布后顶部新增交接记录，不能仅据本节推断已上传。


## 本轮交接：书架多选控件显示（2026-10-03）

- 用户要求多选选项仅在点击多选后出现。检查发现截图圆圈是常驻单卷已读 / 未读按钮，实际选择框已受 selecting 控制；本轮将单卷阅读状态操作移入更多菜单，平时保留打开 / 三个点，进入多选显示选择框和批量操作，取消沿用隐藏并清空选择。没有后端、数据或文件操作变更。
- 更新既有 check-book-volume-matching.mjs 检查普通模式隐藏、菜单内状态切换 / 自动收起、进入多选显示、取消隐藏及再次多选不残留选择；两边生产预览在 1024×640、1366×768、1920×1080 通过，批量已读 / 未读失败重试、所选识别、排序和移出仍通过。已查看主目录深色 1024 宽普通 / 多选截图。主目录 72 项前端测试、两边 TypeScript / 构建通过；模拟 IPC 未操作真实媒体，未人工验证原生 Tauri 窗口。
- 主目录仅同步相关组件、既有验证脚本和必要文档，保留其他未提交草稿；原子提交在 codex/resource-library-split 托管工作树，不发布 / 推送。测试预览 4187 / 4188，用户开发应用保留。

## 本轮交接：漫画详情封面比例（2026-10-03）

- 用户要求漫画详情封面框贴合实际图片比例，修正固定 2:3 外框 / 内框产生的留白。漫画探索及书架漫画详情使用局部 comic-detail-cover 样式解除固定比例，图片宽度沿用现有布局、高度按自然比例展开；缺图占位保持 2:3。探索列表海报、影视 / 小说详情、卷册和文件图片不变。
- 新 CSS 用 .detail-cover.comic-detail-cover 提高限定选择器优先级，避免后加载的共用 detail-cover 样式覆盖；书架仅在已确定 comic 品类时加入该类名。没有新增图片处理、接口、依赖或数据库变更，缓存 / 重试链路保持。
- 隔离与主目录 TypeScript / 生产构建通过，主目录 72 项前端测试通过。两边模拟 IPC 在 1024×640、1366×768、1920×1080 检查探索 / 书架的竖图、方图、横图、长竖图自然比例与边框贴合、缺图占位、列表 2:3 及影视 / 小说未改变；已查看 1024 宽浅色 / 深色截图。主目录另通过三尺寸 DPR 4 缓存回归。UI 使用合成封面，未人工验证原生 Tauri 窗口；没有重复后端测试，既有构建大 chunk 提示保留。
- 增量同步 H:/二次元阅读器，书架共用详情仅增加局部样式导入和漫画封面类名，保留其他草稿。交付原子提交在 codex/resource-library-split 托管工作树，仍为 Unreleased，不发布 / 推送；临时比例检查在 .tmp 目录，不纳入提交。测试预览 4187 / 4188，用户开发应用保留。

## 本轮交接：收藏页分类筛选（2026-10-03）

- 用户要求在收藏作品数量旁加入动漫、漫画、小说、游戏，随后补充电影 / 电视剧。本轮增加全部与六个品类标签，复用 matchesLibraryCategory；未分类视频 / 其他作品保留在全部，不猜作品品类。仅筛选已有收藏，分类与标题 / 原名搜索组合，数量反映当前结果，空结果提示切换分类或关键词。
- FavoritesPage 将分类 / 关键词写入 URL，进入媒体 / 书架详情后按钮返回、浏览器返回及直接链接可恢复选择；搜索修改当前历史项，分类切换可浏览器返回。样式限定新 favorites.css，沿用现有下划线标签、搜索和作品卡片，三个窗口尺寸内标签不重叠。
- 主目录 72 项前端测试通过；隔离与主目录 TypeScript / 生产构建通过，既有大 chunk 提示保留。两边生产预览模拟 IPC 在 1024×640、1366×768、1920×1080 验证六分类 / 全部、旧类型回退、排除未收藏、数量、联合搜索 / 原名 / 大小写、空结果、书架详情按钮 / 浏览器返回、直达 URL / 无效分类及布局；已查看 1024 宽浅色 / 深色截图。没有 Rust / 数据库 / 依赖变更，未重复后端测试或人工验证原生 Tauri 窗口。
- 增量同步 H:/二次元阅读器，仅更改收藏页、新局部样式与必要交接 / 变更记录；其他 Agent 未提交草稿保留。原子提交在 codex/resource-library-split 托管工作树，仍为 Unreleased，不发布或推送；临时模拟检查放在已有 .tmp 目录，不纳入交付。测试预览使用 4187 / 4188，保留用户开发应用。

## 本轮交接：安卓移植方向讨论（2026-10-03）

- 用户询问移植安卓并继续开发的可行性，随后提出安卓可能不需要外部调用，手机界面由其在桌面端基础上重新设计。仅记录规划，未确认安卓首版功能或启动实现；既有 Windows 范围保持。
- 已核对当前 Tauri 2 / React / Rust / SQLite 技术栈、移动入口声明、普通路径扫描、Windows 默认打开与凭据实现，以及 Tauri / Android 官方文档。判断具备复用基础，安卓文件访问、内容消费与系统能力仍需适配；尚未进行 Android 编译或真机验证。
- 本轮仅新增路线讨论与本交接记录，检查文档增量及 Git 提交范围；未运行代码测试、安装工具链或修改应用代码。主工作区已有大量其他修改，本轮提交仅包含这两处新增记录。

## 本轮交接：漫画探索封面缓存（2026-10-03）

- 用户选择优先优化缓存，本轮限定漫画探索列表 / 详情的封面链路，未改变海报框、图片裁切方式或章节阅读范围。新 ComicCover 在可见 / 临近可见时调用 Rust 缓存命令，前端合并请求并保留最多 128 项结果；列表 / 详情复用，返回不再下载同图。已有缓存路径立即显示，依据显示尺寸乘 DPR 选择 600×900 缩略图或保存的原图。
- 新 comic_cover_cache 在 covers/comic-explore 保存由来源 ID / URL 散列命名的图片对，磁盘命中不联网、并发下载最多四路、同图普通请求串行核对去重；来源 URL 改变生成新缓存。复用现有图片下载校验与原子写入，JPEG 源字节不再重编码。后台按 256 MiB 目标淘汰较旧图片对，只处理专用目录中生成的文件，保护正在处理的封面；清理是尽力执行，忙文件可能暂时超额。不清理长期封面或用户媒体。
- 加入书架优先复制临时原图 / 缩略图到既有长期封面目录，不为已经缓存的原图再次联网；复制不可用才沿用既有下载回退。手动封面、已有作品及个人数据继续受原逻辑保护。无数据库迁移或新依赖，旧元数据 JSON 新字段缺省为 None；列表 / 详情只补入现有本地路径，不为返回整页而下载所有封面。
- 本地图片缺失 / 损坏会回退来源图片，缓存请求失败不循环下载；重试图片 / 恢复网络只重新请求失败封面，有效图片不重新读取。ResilientImage 增加可选错误回调，其余调用不变；主目录已有图标重试入口保留。
- 隔离 / 主目录前端 68 / 72 项通过，两边 TypeScript / 生产构建通过；完整 Rust 257 / 258 项通过，两边各 14 项忽略。另在隔离工作树显式运行真实公开封面 smoke，验证实际封面下载及解码、缩略图尺寸、断网式磁盘复用和永久复制字节一致。没有使用真实用户库或请求漫画章节资源。
- 两边生产预览在 1024×640、1366×768、1920×1080 通过原漫画展开 / 详情 / 返回位置回归；新增模拟 IPC / 磁盘回归在 DPR 4 验证按可见性缓存、无浏览器重复远程下载、列表详情复用、像素选图、失败项恢复、损坏缓存回退 / 重试、离线重载与淘汰后只重下缺图。隔离浅色与主目录深色通过，截图检查未见溢出。未人工验证原生 Tauri WebView2 或真实封面视觉质量；既有大 chunk / Windows linker 提示保留。
- 已增量同步 H:/二次元阅读器，保留其他未提交草稿；原子 Git 提交在 codex/resource-library-split 托管工作树，不创建发布版本或推送。新 Rust 命令需要完整重启开发应用，单独刷新前端不足；测试预览端口 4187 / 4188，用户 1420 开发应用保留。

## 本轮交接：漫画展开列表与完整详情（2026-10-03）

- 用户要求漫画探索沿用动漫的点击展开形式，并进入完整作品详情。列表改为每次追加一批，保留已展示作品，跨批次按来源 ID 去重；显示已展示数量，全部读取后隐藏展开入口。展开 / 刷新失败保留原列表并可重试，切换查询 / 筛选后旧请求不追加到新列表。
- 漫画条目由弹窗改为共用 detail-page / detail-hero / detail-body 的完整页面，展示封面、作者、别名、简介、题材、连载状态、章节数量、最新章节和更新日期；保留加入 / 收藏到书架、打开书架详情及刷新资料。没有真实横图时使用中性氛围背景，不增加章节正文或阅读能力。
- 查询 / 筛选仍保留 URL；展开批次不创建分页历史，前端最多保留 8 个筛选列表快照。详情返回及浏览器前后退恢复已展开列表和列表位置，书架详情卸载后返回也复用快照。来源详情入口改用 comicDetail 历史标记，无站内入口直达时回漫画列表；漫画分类继续不运行动画请求。列表滚动保存阻止离开后的延迟事件覆盖旧位置，并在外壳滚动重置后恢复。
- 隔离工作树 64 项 / 主目录 68 项前端测试通过，两边 TypeScript / 生产构建通过；大 chunk 提示仍为既有问题。生产预览模拟 IPC 在两边 1024×640、1366×768、1920×1080 验证追加 24→48→60、失败重试、末批停止、查询 / 展开乱序隔离、详情 / 加入重试、书架高亮及 Bangumi 候选入口、原筛选 / 展开 / 滚动前后退、直接链接、过期缓存和缺图。已查看浅色三个详情尺寸及主目录深色详情与展开列表截图。
- 本轮只改前端及相关文档，没有数据库迁移、依赖或 Rust 变更；未重复后端 / 真实接口测试，也未操作真实媒体、用户库或人工验证 Tauri WebView2。本轮浏览器回归使用合成资料 / 封面和模拟 IPC，不能据此声称真实平台兼容性或实际封面观感已验证。
- 已同步 H:/二次元阅读器，仅修改独立漫画文件、书架来源链接的一处状态标记及必要文档；其他 Agent 草稿保留。Git 交付提交位于 codex/resource-library-split 托管工作树，仍为 Unreleased，不发布版本或推送。独立预览使用 4187 / 4188，保留用户 1420 开发应用；新增 UI 只需前端更新。

> 最近核对：2026-10-03。本文按实际代码、Git 状态和测试结果整理；交接时仍须重新检查代码与状态。

## 本轮交接：漫画探索第一阶段（2026-10-03）

- 用户确认分工后已实施：拷贝兼容目录负责漫画搜索、分页、题材 / 完结 / 韩漫 / 美漫筛选、热度 / 最近更新排序，以及封面、作者、简介和连载信息；Bangumi 可选补充复用书架既有手动候选核对，Genzo 保存收藏与个人记录。Kira 仅作第三方接入参考，没有作为外部阅读器调用。内置章节阅读仍未实现，不读取章节正文 / 页面图片，不接登录、下载或账号同步。
- 新 comic_explore 模块独立命名 copymanga 来源 ID，复用既有作品、来源和元数据缓存表，无新增迁移 / 依赖。加入书架在写事务中创建 comic 作品并缓存封面，重复加入返回原作品，不覆盖评分、备注、阅读状态和人工资料。实际调用书籍匹配事务的临时数据库回归验证 Bangumi 补充后拷贝 ID、锁定标题及个人数据保留。
- 参考 Kira 19a17c5 的请求约定，目录使用 api.copy202601.com、详情使用 mapi.hotmangasg.com；同一目录域名的 comic2 虽 HTTP / 业务成功但 results 为 null，适配器拒绝该响应，不缓存空资料。新源码及 Kira MIT 版权 / 许可一并入库；没有执行 Flutter 上游或使用上游图标 / 素材。仅放行实际验证的 mangafunb.fun 封面子域，沿用图片校验 / 缓存与 CSP。目录一小时、详情 / 题材一天，失败回退旧缓存并提示；不存在短篇专用筛选，不把完结 / 一话必然当短篇。
- 漫画列表和详情通过 URL 保存查询 / 筛选 / 页码，详情关闭、浏览器返回与书架返回保留原子界面；漫画分类不运行动画探索请求。主目录已有 useSessionState 草稿保留，动画标签 URL 与会话状态衔接，验证推荐 / 动漫 / 漫画之间前后退；书架的关联文件等其他草稿入口保留。
- 前端隔离 62 / 主目录 66 项通过，两边 TypeScript / 生产构建通过。最终主目录完整 Rust 252 通过 / 13 忽略，漫画模块在两边定向 6 通过 / 1 忽略；另显式运行真实公共元数据 smoke，验证 24 条实际页大小、题材、组合筛选、详情、搜索及临时数据库建书。没有用真实用户库或请求章节内容。既有构建大 chunk 与 Windows linker 提示保留。
- 生产预览模拟 IPC 在两边 1024×640、1366×768、1920×1080 通过搜索乱序隔离、筛选分页、详情 / 加入失败重试、书架高亮及 Bangumi 搜索入口、过期缓存提示、缺图占位和漫画 / 动漫浏览器返回；已查看隔离浅色和主目录深色的 1024 宽列表 / 详情截图。最初脚本遗漏既有播放状态字段导致进入详情失败，补齐测试夹具后通过，并非应用缺陷。验证没有覆盖真实 Tauri WebView2 人工操作或真实封面观感。
- 增量同步 H:/二次元阅读器，其他 Agent 的未提交草稿保留；交付提交位于 codex/resource-library-split 托管工作树。仍为 Unreleased，无版本号变更、发布或推送。新 Rust 命令及 CSP 需要完整重启开发应用生效，单独刷新网页不足；独立预览端口 4187 / 4188，不停止用户的 1420 开发应用。

## 本轮交接：漫画探索与 Kira 数据源调研（2026-10-03）

- 用户提出完成漫画探索、覆盖短篇并研究拷贝接入，补充常用第三方客户端 caolib/kira 为参考；进一步明确是学习其拷贝第三方接入方式，不能把 Kira 当成要调用的阅读器。用户接受作品资料和 Genzo 内在线阅读两种方向，但担心当前没有阅读后端。代码确认漫画探索仍禁用 Future、AniList 固定 ANIME、书架刮削使用 Bangumi 书籍 API。
- 已检查 Kira README、MIT LICENSE、API / 缓存分层及漫画接口；本地只读参考位于忽略目录 .research/kira，核对版本 19a17c5（2026-10-02）。其首页 / 推荐 / 更新 / 排行 / 搜索 / 筛选与阅读模块分离，可研究独立数据源及缓存设计；Flutter 界面不能直接嵌入现有 React。未执行上游代码、安装依赖、登录或调用拷贝内容接口。
- 调研阶段当时仅记录需求与建议，尚未实现漫画探索、拷贝兼容性或内置阅读；后续实施结果见本文件顶部的第一阶段交接。AniList 支持 ONE_SHOT，但其列表 / 追踪服务限制需核对适用性；未找到并确认拷贝官方开放 API 文档。该阶段仅文档增量并检查 diff，不重复运行代码测试；主目录其他草稿保留，调研提交在 codex/resource-library-split。

## 本轮交接：书架详情导航、卷册封面与排序修复（2026-10-03）

- 用户报告书籍详情高亮媒体库、部分卷册封面每次进入重新加载、切换升降序忽略手动调位。修复前模拟生产页面分别复现了错误导航、重复内嵌资料读取及排序回到原编号顺序；数据库实际已经保留自定义 ID，排序根因在前端展示。
- 漫画 / 小说共用既有详情页，使用 /bookshelf/:id 并高亮书架；旧 /library/:id 阅读物链接 replace 到书架详情，影视保留媒体库路由。通用卡片、建书入口以及主工作区既有书架网格 / 列表入口同步；返回按钮和鼠标侧键继续保留上一个子页及筛选。
- 手动条目 ID 始终作为排序基准，单按钮显示当前顺序 / 倒序；切换只改变方向，倒序下拖动按显示位置保存并保留方向，刷新 / 重新进入沿用。沿用原排序表和命令，无 Rust 或迁移修改。
- 内嵌资料采用最多 128 条的应用会话缓存，按文件 ID、路径、大小、扫描修改时间及指纹区分版本，并合并并发读取；失败不缓存，可重新进入或刷新重试。卷册封面复用 ResilientImage，关联封面失败回退内嵌封面，并沿用图片重试 / 网络恢复，缺图保留固定占位。重启应用后首次仍需读取，未新增永久缓存或检查真实书籍。
- 隔离前端 59 项、主工作区前端 63 项及两边 TypeScript / 生产构建通过，既有大 chunk 提示保留。既有存量数据库排序升级回归 1 项通过；没有重复完整 Rust 检查。模拟页面在两边 1024×640、1366×768、1920×1080 通过单按钮切换、双方向调位 / 刷新、原有批量操作、重复进入封面复用、失败读取重试、图片回退、文件版本失效、书架高亮和返回导航；已查看两边 1024 宽深浅色排序截图。
- 修复增量同步 H:/二次元阅读器，其他 Agent 未提交草稿保留且未纳入提交；原子提交位于托管工作树 codex/resource-library-split。本轮没有真实媒体 / 用户数据库操作、Tauri WebView2 人工验收、正式发布或推送；验证预览使用独立端口，未停止用户开发应用。

## 本轮交接：海报墙留白回归修复（2026-10-03）

- 用户截图显示上一轮改动使竖版海报出现边缘留白、横版封面在竖卡片中间形成窄条。根因为 MediaVisual 对所有视频封面统一使用 contain，海报墙与详情没有区分用途。加入横版封面后，修复前的生产页面在填满卡片检查中失败，截图复现了相同留白。
- 海报墙恢复 cover 填满既有 2:3 卡片，详情封面继续 contain 完整展示；分集 / 文件图片、高 DPI 原图选择、下载与缓存、TMDB 候选选择均保留。仅改显示 CSS，无需重新刮削，不改 Rust、数据库或真实图片文件。
- 回归夹具补充横版封面，等图片成功加载后检查与截图，覆盖每张卡片填满、详情完整、原图 / 缩略图选择、失败回退 / 重试及尺寸变化。隔离和主工作区均在三窗口尺寸 × DPR 1 / 2 / 3 通过，DPR 2 使用深色，另外两组使用浅色；已查看修复前 / 后和主工作区深浅色海报墙截图。
- 隔离前端 57 项、主工作区前端 61 项、两边 TypeScript 与生产构建通过；既有大 chunk 提示保留。Rust 未修改，本轮未重复上一轮完整 Rust 检查。修复增量已同步主目录，其他 Agent 草稿保留，独立提交位于 codex/resource-library-split，未发布或推送。
- 本轮修复的是显示回归。横版原图填入竖框仍会裁切，要减少裁切需取得合适竖海报；没有替换用户实际作品图片或改变 Bangumi 来源优先级，合成夹具不能代替真实作品的观感验收。

## 本轮交接：影视图片用途、候选选择与高 DPI 显示（2026-10-03）

- 用户确认在现有结构上优化影视图片。影视海报保持 2:3 框并完整显示构图，分集 / 文件图保持现有 16:9 框并完整显示；普通视频文件卡片改用已有文件缩略图链路，详情缺少横背景时使用中性背景。未改首页结构、书架功能、用户模糊设置或播放调度。
- 海报组件测量实际尺寸乘 DPR，超过 600×900 缩略图预算时优先原图，尺寸 / DPI 改变后重新选择；已有失败回退与重试保留。TMDB 海报及剧照改存原尺寸，原有图片下载限制、JPEG 原字节保存和缩略图处理沿用。旧作品需要刷新元数据升级图片，未批量改写旧缓存。
- 新 tmdb_artwork 模块复用 film_tv 请求的重试 / 七天缓存与过期回退，读取 movie / tv / season 图片候选，按用途、比例、足够像素、语言及带票数权重的评分选择。本季只选择本季海报，横背景来自系列；候选读取失败保留默认路径。动漫补源在身份校验后选图，Bangumi 主锚点和已有封面优先级保持。字段锁定和 UUID 文件名的历史人工导入封面得到保护，并有临时数据库回归。
- 隔离工作树 Rust 245 通过 / 12 忽略、前端 57 通过；主工作区组合草稿 Rust 246 通过 / 12 忽略、前端 61 通过。两边 TypeScript 和生产构建通过，既有 >500 kB chunk 提示仍在。生产模拟页面均在 1024×640、1366×768、1920×1080 和 DPR 1 / 2 / 3 验证海报比例、原图选择、回退 / 重试、尺寸变化、视频帧、缺图与无水平溢出；已查看两边 1024 宽 DPR 3 截图。
- 既有播放入口回归在两边三尺寸通过。既有分集剧照脚本在隔离开发页面通过；主工作区开发页面初始导航超时且无 IPC 调用，改用临时目录中的生产预览适配脚本后，原有缓存 / 缩略图 / 占位、来源预览确认及迟到请求隔离在三尺寸通过。不能把开发页面超时写成通过。
- 验证使用合成图片、模拟 IPC 与临时数据库，未使用真实 TMDB 账号 / 图片、用户媒体或 Tauri WebView2 人工验收，不能据此声称真实颗粒感已解决。候选请求沿用设置中的 TMDB token；仅用环境变量配置动漫补源时仍可能回退默认图片。无新增迁移、依赖、图片服务或真实媒体操作。
- 本轮增量已同步主开发目录，其他 Agent 未提交草稿保留；原子提交只在托管工作树 codex/resource-library-split，仍为 Unreleased，未发布或推送。验证预览使用独立端口，未停止用户开发应用。

## 本轮交接：Windows 书架拖动配置修复（2026-09-30）

- 用户报告仍不能拖动卷册。书架使用 HTML5 拖放手柄，但主窗口和独立 E2E 窗口都未显式关闭默认开启的 Tauri 原生拖放接管；[Tauri 官方配置说明](https://v2.tauri.app/reference/config/#dragdropenabled) 要求 Windows 的 HTML5 拖放关闭该接管。两处现在设置 `dragDropEnabled: false`，未改排序算法、数据库、真实书籍或窗口标题栏拖动。
- 浏览器卷册回归新增两处窗口配置断言：修复前因缺少 false 失败，修复后隔离与主工作区均在 1024×640、1366×768、1920×1080 通过原有排序、批量识别 / 状态和移出流程。默认桌面构建通过；前端与 Rust 业务代码未改变，未重复上一轮完整单测。
- 新 `scripts/e2e-book-drag.mjs` 只接受独立 `com.genzo.desktop.book-drag-qa-*` 数据目录和 9225 调试端口，使用生成的 3 个 TXT、真实扫描 / 建书 / SQLite 命令验证上下拖动、刷新后顺序及文件 / 阅读状态保留。修复后在实际 1352×761 WebView2 视口通过；CDP 视口模拟不能稳定改变宿主窗口，因此三尺寸布局仍由浏览器回归覆盖。
- 验证边界：修复前 CDP 自动化拖动也能成功，未复现用户的实际鼠标阻断；不能用该自动化结果代替物理鼠标验收。配置由新建 WebView 读取，需要完整重启开发应用 / 重建桌面版本，刷新页面不生效。主工作区仍保留其他 Agent 草稿，修复单独提交在托管工作树；未操作用户的真实库、发布或推送。

## 本轮交接：书架批量阅读状态与识别对照（2026-09-30）

- 用户授权开始本轮优化，范围为此前建议的第 1、2 项：多选工具栏新增已读 / 未读图标和“识别所选”；全作品和所选卷共用识别预览。预览逐行显示原文件 / 图片文件夹、卷号、Bangumi 单册与封面；无封面有占位，可靠候选默认勾选，可取消部分后统一确认，待核对项保留具体原因。
- `save_book_read_state` 在一个写事务中验证作品与当前卷册代表 ID，只更新阅读状态及时间；单卷图标也复用此命令，不再顺带保存解析标题 / 卷号。过期、重复、其他作品及图片目录非代表 ID 整体拒绝，实际写入中断整体回滚；人工标题、编号、匹配、文件路径和未选卷保留。没有新增迁移、依赖或真实媒体操作。
- 批量识别先按整部作品核对唯一卷号与占用，再缩小到所选范围；只选择一个重号文件也不能自动通过。确认重新读取候选，只允许预览中的有效子集并拒绝重号选择 / 候选变化；只对勾选卷读取单册详情与写入，已有匹配保留。
- 隔离工作树定向 Rust 19 项通过；主工作区完整 Rust 回归 241 通过 / 12 忽略。前端隔离 56 / 主工作区 60 项、TypeScript 与生产构建通过，既有 >500 kB chunk 提示仍在。生产页面模拟 IPC 在两边的 1024×640、1366×768、1920×1080 验证排序、批量状态 / 失败重试、所选卷识别、候选取消 / 部分确认、缺封面、待核对项和移出流程；隔离浅色与主工作区深色均通过，已查看两种 1024 宽截图。
- 功能代码已同步主工作区，提交保存在托管工作树 `codex/resource-library-split`；主工作区其他 Agent 未提交草稿保留且未纳入本轮提交。未用真实用户书籍、真实 Bangumi API 或 Tauri WebView2 手动验收；旧导入脚本入口问题沿用上一轮记录，本轮未重新声称其通过。仍为 Unreleased，未发布或推送。

## 本轮交接：书架卷册 / 章节排序（2026-09-30）

- 用户要求作品详情中的卷册 / 章节可升序、降序，并能自己调整位置。详情工具栏新增两个小图标按现有卷号 / 话数与标题顺序升降序；拖动手柄可调位，聚焦手柄后上下方向键也可微调。手动调整切为自定义顺序；新条目在末尾按原编号顺序补入。
- 新迁移 `0024_book_entry_order.sql` 按作品保存排序模式和自定义条目 ID 顺序，旧 0023 数据库升级测试通过。保存自定义顺序时在事务中核对当前卷册集合，缺失、重复或过期选择整体拒绝；不改原始书籍、文件路径、单册匹配或阅读状态。
- 隔离与主工作区书架 Rust 测试各 12 项通过；主工作区完整 Rust 回归 239 项通过 / 12 忽略。前端分别 56 / 60 项、TypeScript 与生产构建通过。构建后的模拟页面在 1024×640、1366×768、1920×1080 验证升降序、拖动、键盘微调、重新加载后的顺序及无横向溢出；已查看主工作区 1024 宽截图。尚未以真实用户数据库、书籍或 Tauri WebView2 手动验收；主工作区保留其他 Agent 的未提交草稿。
- 额外运行旧 `check-book-import.mjs` 脚本：主工作区在查找 `Books` 文件夹入口、隔离工作树在查找“识别并整理”按钮时超时，均未进入书籍详情，不能算作本轮排序回归失败或导入流程通过；脚本入口与现有页面需另行核对。

## 本轮交接：卷册操作收纳与多选移出（2026-09-30）

- 用户要求书架详情卷册行只直显打开与已读 / 未读按钮，其他操作放入三个点；卷册工具栏加入多选删除。现有“阅读中”记录仍展示独立图标，点击标记已读；点击已读图标可恢复未读。编辑、单册识别 / 清除匹配、本地资料仍可从更多菜单使用。
- 多选后可全选、取消和确认移出。后端按卷册 ID 在单一事务中解除当前作品的文件关联，图片目录整卷处理；若列表已变化或含无效卷册则整体拒绝。不删除磁盘书籍、扫描文件记录、阅读状态或单册匹配；移出的文件回到书架待整理。无需数据库迁移。
- 隔离工作树定向 Rust 1 项、前端 56 项、TypeScript 与生产构建通过；主工作区组合草稿书架 Rust 11 项、前端 60 项、TypeScript 与生产构建通过。两边构建后模拟页面均在 1024×640、1366×768、1920×1080 验证更多菜单、状态切换、匹配、批量移出及无横向溢出，已查看 1024 宽菜单和多选截图。尚未使用用户真实数据库、真实书籍或 Tauri WebView2 手动验收；主工作区其他 Agent 的未提交草稿保留。

## 本轮交接：书架编号文件整套归档与卷册批量匹配（2026-09-29）

- 用户给出 `败犬女主太多了！ 03 (雨森たきび) (Z-Library).epub` 样本，希望像视频季集一样用数字划分卷册，不逐本选择。已对这类有明确卷号的文件解析作品标题与卷号，同一目录范围、品类和标题的卷册在待整理合为一个系列建议；四位年份仍不猜卷号。主工作区书架待整理增加“归档整套”，只选择卷号唯一的文件，重号、无编号与缺失文件留给人工核对。
- 作品详情新增“批量识别卷册”：要求作品先关联 Bangumi 系列，只对本地与系列“单行本”关系中均唯一的卷号给出预览，一次确认。保存时复核单册类型与卷号，以单个事务写入全部有效匹配；跳过不明确的卷，保留已有手动匹配、封面回退与阅读状态。
- 隔离工作树书架 / 刮削定向 Rust 15 项、前端 56 项通过，TypeScript 与构建通过；完整 Rust 回归有 19 项动画索引相关测试因内置 bangumi-data 解析错误失败，其他 217 项通过。主工作区组合草稿完整 Rust 237 项通过 / 12 忽略，前端 60 项、TypeScript 与构建通过；用构建后的页面模拟在 1024×640、1366×768、1920×1080 验证整套选择、批量卷册预览 / 确认和无水平溢出。隔离工作树已检查 1024 宽批量预览截图。主工作区仅同步相关增量并保留其他 Agent 草稿；未用用户真实书籍或 Tauri WebView2 验收。

## 本轮交接：书架逐卷 Bangumi 单册匹配（2026-09-29）

- 在隔离工作树 `codex/resource-library-split` 实现并提交 `fde5764`。迁移 0023 新增按媒体文件 ID 关联的单册 Bangumi ID、标题、卷号和缓存封面；作品级 Bangumi 关联保留，卷册手动标题、卷号和阅读状态不被覆盖。图片文件夹作为一卷时可从任一成员读取已存匹配。
- 详情页“识别此卷”优先读取已关联系列的 Bangumi“单行本”关系，候选按本地卷号排序；无关系时或输入搜索词时查询书籍候选。确认前重新读取单册详情，拒绝系列条目、品类或明确卷号不符及同作品重复关联；无封面时回退本地封面。关系查询复用 7 天缓存及过期回退。未标卷号、番外和不同译本仍由用户核对，不自动批量关联。
- 旧版 0022 数据库升级到 0023、错卷与系列条目、图片文件夹成员读取均有回归。隔离工作树 Rust 233 通过 / 12 忽略、前端 56 通过；主工作区组合草稿 Rust 234 通过 / 12 忽略、前端 60 通过；两边 TypeScript 与生产构建通过。隔离工作树模拟桌面 IPC 在 1024×640、1366×768、1920×1080 验证候选、错卷禁用、确认 / 清除及无水平溢出；主工作区混合草稿的相同页面检查在加载时超时，未算通过。真实用户书籍与 Tauri WebView2 尚未验收。

## 本轮交接：书架目录选卷与逐卷本地封面（2026-09-29）

- 用户截图中的多卷 EPUB 被“一个文件一个作品组”拆开，真实路径还有一至两层子目录。已把书架待整理改为真实目录逐级导航：文件左侧勾选可跨子目录保留，面包屑末尾“识别当前目录”递归加入目录内文件；右侧只归档勾选文件，混合漫画 / 小说拒绝建立同一作品。不移动或修改原媒体。
- 文件名解析新增明确的“-07”及中文“第八卷”等卷号，普通年份仍不猜卷号。右侧归档列表和作品详情对本地 EPUB / CBZ 逐册读取内嵌编号及封面；封面沿用应用缓存，书籍本身不改写。WebDAV 未缓存文件和缺少内嵌资料的格式仍需手动核对。
- 隔离分支 Rust 229 通过 / 12 忽略、前端 56 通过，主工作区前端 60 通过；两边 TypeScript 与生产构建通过。模拟桌面 IPC 在 1024×640、1366×768、1920×1080 验证多层目录、跨组选择、逐卷封面、取消一册和归档参数，无水平溢出；主工作区书架定向 Rust 7 项通过。尚未用用户真实 EPUB 或 WebView2 手动验收。
- 隔离分支提交本轮代码、脚本和文档。主工作区保留其他 Agent 未提交页面及设计草稿，只同步本轮功能；没有发布、推送或改动用户真实文件。

## 本轮交接：作品详情返回上一个界面（2026-09-29）

- 用户报告从书架作品详情返回时进入媒体库，并要求页面返回与鼠标侧键都回到先前的小界面。已复现左上角按钮硬编码 `/library`；模拟 Edge 侧键本身使用浏览器历史，但媒体库和书架的部分子范围原为本地状态，返回后会丢失。
- 详情按钮现在有站内历史时返回上一条；直达详情无站内历史时阅读物回书架、其他作品回媒体库。媒体库与书架页签、范围由 URL 参数维护，其他既有会话筛选保持原实现。
- 隔离分支前端 56 项、主工作区 60 项测试通过；两边 TypeScript 与生产构建通过。`scripts/check-navigation-back.mjs` 在 1024×640、1366×768、1920×1080 用模拟作品验证书架 / 收藏 / 媒体库返回、模拟 Edge 鼠标侧键、子范围及待整理页签、直达详情回退，无水平溢出；主工作区原有目录归属回归也在三种尺寸通过。未在用户实际鼠标驱动或 Tauri WebView2 中验收。
- 功能提交保存在托管工作区分支 `codex/resource-library-split`；主工作区其他 Agent 的未提交设计及页面草稿继续保留，本轮导航增量接入但不把其整体纳入提交。未推送或发布。

## 本轮交接：首页海报排除书架作品（2026-09-29）

- 用户确认书架作品不在首页海报展示。首页横幅轮播和最近添加按现有书架归类规则排除漫画 / 小说，包括画集、轻小说；首页媒体计数及分类按钮同步调整。主工作区现有观看记录海报也排除书架作品。只有书籍时保留无作品海报的首页状态，书籍仍在书架中。
- 隔离分支前端 56 项测试、TypeScript 检查与生产构建通过。主工作区当前混合草稿 60 项前端测试、TypeScript 检查与生产构建通过；模拟媒体和书籍混合数据及仅书籍数据在 1024×640、1366×768、1920×1080 验证首页内容和无横向溢出，并查看截图。未用真实用户媒体验收。
- 本轮功能提交保存在托管工作区分支 `codex/resource-library-split`；主工作区其他 Agent 的未提交设计和页面草稿继续保留，本轮首页与观看记录改动仅接入该混合草稿，不将其整体纳入提交。仍为 Unreleased，未推送或发布。

## 本轮交接：书架待整理识别与核对（2026-09-28）

- 用户选择下一轮同时优化漫画 / 小说识别匹配和书架待整理体验；另询问手机阅读器封面来源。本轮仍是 Windows 本地书架功能，不含移动端客户端或同步。扫描目录的媒体库 / 书架归属规则保持不变。
- 待整理按实际书籍所在目录分组，深层“合集 / 系列”不再被首层合集目录混并；漫画与小说保持分开。组内展示文件、缺失状态、自然顺序与勾选范围，从书架目录行可直达核对面板。确认前可预览 CBZ ComicInfo / EPUB OPF 标题、作者、系列、编号及本地封面，也可搜索并人工选择 Bangumi 书籍候选；PDF / TXT 等资料不足时仍可手动建立。
- EPUB 封面优先按 OPF 的 cover-image、EPUB 2 cover ID 或 guide 声明定位，旧文件名回退保留。建立作品时可保存已预览的本地封面。Bangumi 候选详情在提交前重新核实品类与单册 / 多卷；建书、文件关联与元数据写入同一事务，候选已占用或文件归属变化时整体回滚。无新迁移，不读取远程 WebDAV 书籍正文，不移动真实文件。
- 独立工作区 Rust **229 通过 / 12 忽略**、前端 **56 通过**、TypeScript 检查和构建通过；主工作区组合草稿 Rust **230 通过 / 12 忽略**、前端 **60 通过**、TypeScript 检查和构建通过。模拟桌面 IPC 在 1024×640、1366×768、1920×1080 验证深层目录入口、文件子集、本地资料、候选选择、目录分流和无页面水平溢出，并查看截图。未用真实 Bangumi 条目、用户书籍或手机端验收。
- 功能提交保存在托管工作区分支 `codex/resource-library-split`；主工作区中其他 Agent 尚未提交的页面 / 设计草稿原样保留，本轮仅把功能接入其书架页面。仍为 Unreleased，未创建发布标签或推送。

## 本轮交接：资源库与双待整理入口（2026-09-28）

- 用户确认媒体库、书架、资源库分为三个入口；资源库统一管理目录 / 扫描，媒体库和书架分别展示作品与待整理文件。以 `8f5450f` 为起点，在托管工作区分支 `codex/resource-library-split` 实现，主工作区的其他 Agent 草稿须保留。
- 用户补充指明资源库中每个扫描目录的下拉框应选择“媒体库 / 书架”，两个待整理区按目录隔离。迁移 `0022_root_destinations.sql` 给 `library_roots` 增加目录归属；旧漫画 / 小说专用目录默认书架，其他旧目录默认媒体库。保留既有 0021 迁移文件以维护已运行迁移校验，但其作品组路由表不再参与分流。
- 本地 / 挂载及 WebDAV 目录均可选择归属；扫描文件类型移入目录展开设置，仍独立控制索引格式。待整理作品组和文件列表按目录归属读取；建书时重新核对文件确属书架目录。切换归属及重扫不会改动媒体路径、作品、阅读 / 观看记录或真实文件。
- 分支自带独立书架、媒体库、资源库页面。主工作区另有尚未提交的丰富书架 / 资源库页面草稿，集成时只接入本轮目录归属能力，不覆盖或纳入提交其他 Agent 的页面内容。
- 目录级调整后独立工作区 Rust 回归 **226 通过 / 12 忽略**、前端 **56 通过**、TypeScript 与 Vite 生产构建通过。模拟桌面 IPC 在 1024×640、1366×768、1920×1080 走通目录改选、媒体库和书架待整理，无页面水平溢出。尚未用用户真实目录 / WebDAV 验收。
- 已将目录级改动合入主工作区现有未提交界面草稿并保留其他 Agent 的改动。组合状态下 Rust 回归 **227 通过 / 12 忽略**、前端 **60 通过**、TypeScript 检查及生产构建通过；生产预览的三个窗口尺寸目录分流流程通过。主工作区 Vite 开发预览初次加载超时，不能据此声称该模式已验收；主工作区混合草稿没有纳入本功能分支提交。
- 仍是 Unreleased 开发，未改变 0.4.4 版本字段、创建发布标签或推送；下次启动 Tauri 时应用迁移 0021 和 0022。

## 本轮交接：漫画与小说书架开发（2026-09-28）

- 用户确认书架为下一功能版本。基于 `dce01b7` 在独立托管工作区开发，以避开主工作区已有的设计、影视评分、导航和书架页面等未提交草稿；主工作区的这些改动不得覆盖或混入本功能提交。
- 新增迁移 `0020_bookshelf.sql`，仅保存卷册显示标题、显式卷 / 话编号及手动阅读状态；不修改旧迁移、原始文件或用户数据库。已有 0019 数据库升级到 0020 的测试通过，保留原作品、文件和卷册状态。
- 图片目录按文件夹聚成卷册，CBZ / EPUB 等压缩或单文件读物按文件列出；只解析明确的“第 N 卷 / 话”等标记，不把普通年份误认作卷号。未归档文件按媒体源首层目录提供待整理候选，由用户核对类型和标题后事务建立作品。PDF 可人工归为漫画；CBR、RAR、7z、TXT、MOBI 等仍索引并交给外部阅读器，首版不解析其内嵌资料。
- CBZ / ZIP 按需读取 ComicInfo.xml 和首张图片，EPUB 按需读取容器 OPF 和本地封面；预览后可将标题 / Number 人工核对为卷册信息。Bangumi 搜索限定书籍类型，展示候选和缓存失效回退；确认时复查详情、品类和单册 / 多册冲突，再复用现有字段锁定与元数据来源逻辑。在线查询失败不会删除本地资料。远程 WebDAV 读物内嵌分析仍需缓存能力，当前只给出明确提示；自动页码和 EPUB 阅读位置未实现。
- 详情页加入卷册表、手动阅读状态、内嵌资料和 Bangumi 匹配；打开卷册复用现有结构化外部工具启动，图片目录交给漫画阅读器或系统打开文件夹。书架首页当前由主工作区未提交草稿提供，导入组件已在该草稿工作树接入。
- 独立工作区完整 Rust 回归 **225 通过 / 12 忽略**，书架定向 **8 通过**；前端 **56 通过**、TypeScript 检查与 Vite 构建通过。主工作区组合草稿的完整 Rust 回归 **226 通过 / 12 忽略**、前端 **60 通过**、TypeScript 检查与 Vite 构建通过；模拟 Tauri 数据在 1024×640、1366×768、1920×1080 检查书架页面、导入面板和书籍详情，无水平溢出。`cargo fmt --check` 因仓库原有大量未格式化代码未通过，未批量重排无关文件。尚未使用用户真实媒体或真实 Bangumi 条目做人工验收。
- 主工作区已有未提交的书架导航和页面草稿，本轮仅在其工作树中接入导入面板并保留该草稿为未提交；功能提交只包含本轮后端、详情卷册和文档，不把其他 Agent 的页面 / 设计改动纳入提交。详情页使用索引分离提交，只暂存书架相关增量。
- 开发时版本仍为 0.4.4，路线图将下一功能版本列为 v0.5；未创建发布提交、标签或推送。完成界面集成与验收前，不把功能开发视为正式发布。

## 本轮交接：漫画与小说书架调研（2026-09-27）

- 用户询问下一步书架实现、开源参考与漫画 / 轻小说刮削可行性。已读取引用聊天和项目文档，检查实际扫描、分组、类型及 Provider；现有漫画 / 小说分类和筛选不代表已有书籍刮削，Bangumi 搜索当前仍固定动画类型，PDF 默认归为小说。
- 查阅官方仓库与文档，确认 Komga、Kavita、Komf 可分别参考书架组织、本地元数据与联网匹配；Bangumi API 有书籍类型和系列标记，AniList 轻小说使用 MANGA 类型下的 NOVEL 格式。方案及来源记入 ROADMAP.md，明确为待确认，未改长期架构决策。
- 本轮仅修改路线图和交接文档，不改运行代码、迁移、用户数据库或真实媒体；未执行功能测试。验证文档差异与 Git 空白检查，只提交这两个文件，保留现有设计、Cargo、元数据与 UI 未提交草稿。
- 后续实现前明确主要文件格式、目录样本及外部阅读器；建议先本地书架 / 卷册整理，再 Bangumi 候选确认，自动阅读位置单独适配。不得把调研结论当作真实用户资料覆盖率或已完成功能。

## 本轮交接：统一分集核对、可靠批量确认与流程回归（2026-09-27）

- 起点 `32709ae`，分支 `codex/anime-metadata-v02`。用户确认四项同时实施，仍为 Unreleased：统一对应预览、减少人工操作、可处理的错误提示及识别到续播的回归；保留此前交接信息和其他 Agent 草稿。
- `inspect_media_correction` 使用批量索引查询重新解析文件名 / 目录，按行返回季集、主源官方分集、可选择 / 可靠状态与原因。诊断不读取媒体正文、不联网、不写关联；原严格预览 / 保存校验继续复用同一准备逻辑，混季、冲突、未知单集和过期状态不能绕过确认。
- 按文件名模式默认勾选可靠正片，可筛选可靠 / 待核对并按季度处理；特别篇、缺失路径、无唯一官方分集、已有人工关联及季度未明不自动选中。明确单集仍允许显式人工确认；复合集号切换人工编号单独核对。每批 500 个，诊断只读前 500 个，余项须单独选择预览。人工勾选在重新诊断后保留，迟到结果不会覆盖另一目标作品。
- 每行统一显示文件解析 → 主源季度 / 分集 → 独立 TMDB 剧照对应，读取现有剧照绑定和有效 / 过期元数据缓存；第二季第 1 集可显示 TMDB 同季第 13 集。图像可用性依据已核对的映射，不按固定 12 集猜测；缺图回退文件缩略图且不影响关联。图片缓存读取失败仅警告。
- 提供主源分集刷新、剧照更新、重新诊断及按错误类型的处理建议；季度冲突核对目标 / 分批，主锚点无效先识别，未知编号转人工，502 等失败保留选择与旧资料。保存仍保留媒体 ID、原始路径、未选文件、个人数据和观看记录，可事务撤销。没有新依赖或迁移。
- 排除未提交草稿的独立 HEAD 快照：完整 Rust **217 通过 / 12 忽略**；前端 **56 通过**，TypeScript 与 Vite 构建通过（既有约 552 kB chunk 提示）。当前含草稿工作区 `cargo check --locked --offline`、TypeScript 与前端测试也通过。
- 新后端回归覆盖只读诊断、混季 / NCED / 范围 / 人工关联分离、离线路径与主锚点缺失、严格保存不能绕过。跨模块回归调用实际本地候选确认 → 第二季归属 → 批量关联 → 过期缓存剧照跨源对应 → UNC 启动参数与续播位置 → 撤销，保留第一季、原始路径和进度；不启动真实播放器。
- 扩展 `scripts/check-recognition-preferences.mjs`，三个 Windows 尺寸（1024×640 / 1366×768 / 1920×1080）深浅主题验证逐行对应、可靠优选、全选清空、异常筛选、离线显式选择、502 保留、预览确认及迟到诊断保护，最终截图已查看。影视 / 作品播放入口 / 续播 / 剧照已有 UI 回归也通过；影视旧夹具遗漏新识别记忆空列表导致超时，修正模拟响应后重跑通过。临时脚本复制最初工作目录写错，已纠正并重跑，不是业务故障。
- 没有访问真实数据库、TMDB 账号或真实网盘媒体；真实服务的具体条目、实际图片下载与 PotPlayer 运行仍需日常验收。只提交本轮范围，不创建发布标签或推送。未提交的 Cargo、评分 / 中文资料、设计、导航、图片和其他 UI 草稿保留；`.tmp/episode-verification/` 仅隔离测试快照，不纳入 Git。
- 额外检查当前混合草稿工作区时，UI 测试页面导航超时 / 长时间未完成；限定依赖发现、关闭测试监听仍未完成验证。相同最终脚本在隔离快照通过，当前工作区类型 / 编译检查通过；原因尚未确认，不能据此声称当前草稿 UI 验收通过，也不能断言应用运行故障。只终止本轮测试会话，未停止用户的开发进程。接手时可优先检查大工作区下 Vite 夹具加载及未提交 UI 草稿。
- 下一步重启 `pnpm tauri dev`；详情未匹配列表用“批量按文件名关联”，先保存可靠正片，再筛选待核对文件。第二季换正确主源作品，不把 TMDB 剧照季度填成主源季度。网络失败可稍后刷新，无需重扫描或删除记录；按用户实际媒体检验跨季及续播效果。

## 本轮交接：动漫批量分集误校验 TMDB 补源（2026-09-27）

- 起点 `692e2ab`，分支 `codex/anime-metadata-v02`。用户在按文件名季集标记的批量预览中看到“影视条目 ID 无效”。未访问用户真实数据库；临时数据库加入 Bangumi 主锚点与 `tv/42` 补源后，旧逻辑已复现同一报错。
- `recognition_preferences::prepare` 已选择 Bangumi 主源，却随后无条件用 `Anchor::parse` 校验任意 TMDB TV ID；系列级补源没有季度会报无效，带不同季度的补源会错误限制动漫季度。本轮仅将此校验限制为 TMDB 主源，不放宽 TMDB 电视剧锚点格式，也不把补源季度当作动漫主季度。
- 新增 2 项回归（其中一项覆盖两种补源形式），使用截图样式中文 S01E05 / S01E06 文件名验证重新解析、只关联 Bangumi 官方分集、预览不写入、保存保留观看进度和补源 ID；另验证 TMDB 主源仍拒绝季度冲突与缺失季度的主锚点。
- 独立快照完整 Rust 回归 **214 通过 / 12 忽略**，当前工作区 `cargo check --locked --offline` 通过。旧逻辑的新增用例预期失败后，切换修复版并强制更新时间重新编译验证通过；首次复制保留旧时间导致 Cargo 使用旧复现二进制，已纠正并重跑。前端没有变更，不重复 UI / 前端构建。
- 没有新依赖、迁移或真实数据 / 媒体修改；只提交本轮后端修复、测试及文档，其他 Agent 草稿保留，仍为 Unreleased。下一步重启 `pnpm tauri dev` 后重新点击“预览调整”，核对分集再保存；不需要重命名、重新扫描或删除已有记录。混季与复合集号的必要校验仍生效。

## 本轮交接：TMDB 剧照搜索与拆季 / 合季对应修复（2026-09-27）

- 起点 `c4c6926`，分支 `codex/anime-metadata-v02`。用户报告 TMDB 有剧照但更新找不到，以及 Bangumi 分开的两季在 TMDB 合为一季时只能补第一季。代码确认旧实现仅用既有站点关联，且要求全季集数及集号相同；未用真实账号或数据库验证具体作品的实时 TMDB 结构。
- 无关联或旧关联无法核实时，按当前 Bangumi 条目的原名、中文名、别名及本地作品名称主动搜索；去掉明确中 / 日 / 英季度后缀，至少 90% 标题相似度再核对分集日期。查询与候选数量受限，命中强候选后不继续请求其他别名；刷新复用既有重试及有效 / 过期缓存。
- 两源季度独立：保持 Bangumi 作品与官方分集，核实恒定集号偏移后允许第二季第 1 集对应 TMDB 同季第 13 集，也支持绝对编号转分季编号。至少两集有效播出日期，各已知日期均须吻合（最多 7 天），选择唯一最小日期误差；不用固定 12 集或相同整季集数推断。无日期分集不自动补图，特别篇及歧义回退文件图片。
- 新增迁移 `0019_episode_artwork_offset.sql`，仅给独立剧照绑定增加偏移字段；旧绑定默认 0，历史迁移与校验和不变。旧自动绑定可重新核实偏移；人工绑定保留，发现日期冲突提示用户重新预览，不自动改写。
- “选择剧照来源”支持按名称搜索、点选候选、读取 TMDB 实际正片季度；仅一季自动选择，预览展示逐集对应和缺图回退。TMDB ID 与显式偏移收进高级选项；日期不足时需明确设置并预览确认。未扩展真人电视剧主源的作品身份模型或任意多段重排；动漫识别仍以 Bangumi 独立季度条目为准。
- 独立快照完整 Rust 回归 **212 通过 / 12 忽略**（新增 7 项），前端 **53 项通过**、TypeScript / Vite 构建通过；既有约 547 kB chunk 提示仍在。当前含其他草稿的工作区 `cargo check --locked --offline` 与 TypeScript 也通过。
- 新回归覆盖拆季 / 合季前后区间、绝对编号、日期不足 / 歧义 / 重复集号、无关联主动搜索、旧关联不适用后搜索、旧自动偏移修复、人工对应保留、播出中未来分集不阻断已播剧照、v18 存量升级及历史校验和保留。临时数据库断言作品主锚点、手动媒体关联和观看进度保留。
- 更新 `scripts/check-episode-artwork.mjs`：模拟 IPC / 图片，在 1024×640、1366×768、1920×1080（深浅主题）验证搜索、实际季度、跨源对应预览、确认前不写入、偏移保存、图片回退与过期请求不覆盖另一作品；最终截图已查看。首次误从快照目录调用根目录脚本导致夹具未更新，已更正工作目录并重新通过，不是应用故障。
- 不改真实媒体、真实数据或凭据，不新增依赖，仍为 Unreleased。按要求仅提交此修复及必要文档；其他 Agent 的 Cargo、设计、导航、评分、中文资料和 UI 草稿原样保留。没有正式发布、标签或推送。
- 下一步重启 `pnpm tauri dev` 应用迁移 0019；进入 Bangumi 对应季的作品详情点“更新剧照”。自动对应不足时用“选择剧照来源 → 点选作品 → 实际季度 → 预览对应 → 使用此来源”，日期不足再展开手动对应。无需重新扫描、合并第一 / 第二季或删除旧分集；真实服务返回结构仍需用户日常验收。

## 本轮交接：多源分集剧照与文件缩略图回退（2026-09-27）

- 起点 `77531a5`，分支 `codex/anime-metadata-v02`。用户确认优先 TMDB 分集剧照，没有时用文件缩略图；沿用 Bangumi 主身份和官方分集，未扩展到逐字段元数据编辑、豆瓣或漫画刮削。
- 新增 `episode_artwork.rs`，复用影视请求的重试、有效 / 过期缓存及空分集保护。自动补图只取当前 Bangumi 的明确站点关联或重新校验后的既有 TMDB 补源；全季唯一集号及日期（允许 7 天偏差）核对出唯一季度才保存。不按 Bangumi 季序号直接套 TMDB 季号，不猜绝对集号，特别篇 / 重复分集继续用文件图片。
- 新迁移 `0018_episode_artwork_sources.sql` 独立保存人工 / 已核实剧照绑定，保留历史迁移。主锚点变化后旧绑定不再使用；保存时再次校验，后台自动结果不覆盖人工选择。预览后明确确认，只修改剧照绑定；不写官方分集、媒体归属、作品更新时间或观看进度。
- 详情先读本地绑定与图片缓存，后台补源不阻塞本地作品与文件。可见卡片才请求图片缓存，最多两路并发；先 TMDB 剧照（含本地缓存），再文件缩略图、按需提取及中性占位。手动入口“选择剧照来源”输入 TMDB TV ID / 正片季度，预览前无法保存；“更新剧照”可重新联网尝试。
- 挂载文件自动缩略图仍仅查 Windows 缓存，显式重试才完整提取。WebDAV 仅读取已完整下载且版本匹配的应用媒体缓存，不为缩略图启动传输；生成期间 href / ETag 改变时不写旧图。修复损坏本地缩略图的循环加载 / 重试仍返回损坏缓存，以及卡片回退缩略图缩成小图的问题。
- 排除其他 Agent 草稿的独立快照：完整 Rust 回归 **205 通过 / 12 忽略**；新增 10 项后端用例覆盖跨季、旧补源再校验、重复 / 特别篇 / 绝对编号、离线人工绑定、预览不写入、主锚点失效、TMDB 主源及 v17 存量升级保留校验和，另覆盖 WebDAV 缓存版本与显式缩略图重试。前端 53 项测试、TypeScript 和 Vite 构建通过（既有约 544 kB chunk 提示）。
- `scripts/check-episode-artwork.mjs` 使用隔离 IPC 与本机模拟图片，在 1024×640、1366×768、1920×1080（含深浅主题）验证 TMDB 缓存避免挂载提取、图片失败回退 / 占位、回退填满画面、预览后才写入、后台补源及迟到人工确认不覆盖另一作品；最终截图已查看。早期 UI 夹具的图片路由 / 页面状态和数据库夹具字段问题均修正后重跑，不是对真实服务的验收。
- 没有新依赖、真实媒体修改或真实数据库访问；没有使用用户 TMDB 凭据实测，直播服务 / Windows 解码器不支持格式等仍需日常验收。没有可靠季度对应时显示文件缩略图，可手动指定来源；手动补图目前仅同号正片，不按固定 12 集偏移。
- 本轮仍为 Unreleased，不改版本、打标签、发布安装包或推送。按项目要求只提交本轮增量，其他 Agent 的设计、导航、评分、中文资料、Cargo / UI 草稿继续保留。下一步重启 `pnpm tauri dev` 应用迁移 0018，进入已识别作品详情等待后台剧照补源；没有对应时用“选择剧照来源 → 预览剧照 → 使用此来源”。无需重新扫描或删除原分集关联。

## 本轮交接：明确季集标记与批量分集关联（2026-09-27）

- 起点 `fc25161`，分支 `codex/anime-metadata-v02`。用户报告 S01E05 等文件归档后未关联分集，手动逐集处理繁琐。隔离测试确认截图样式 UNC / Season 目录可解析；代码仍会在条目季度未知且混季时暂停自动分集。未读取用户真实数据库，不能断言截图所有文件失败原因相同，继续保留未知季度的保守行为。
- 修复两个已验证规则缺陷：季集标记的 Unicode 单词边界阻止紧邻中文的 S02E05 读取季度；后续普通数字会覆盖已明确的集号。Bangumi 原季度提取只支持 Season / S，现复用中文、英文序数规则；旧缓存季度为空时可从中文 / 原名恢复明确季度，不把所有未知条目默认为第一季。
- 批量纠错新增 `parsed` 模式，重新解析文件名及目录，支持同作品的未匹配文件，预览后保存独立人工季集。直接入口仅提供未匹配文件，默认勾选可用项（最多 500）；混季可“仅选第 N 季”。拒绝目标季度冲突、混季、多集范围和未知编号；特别篇 / NCOP / NCED 按类型隔离，无唯一官方分集时只保留人工编号，恢复后自动关联，不生成占位。
- 未选视频、原人工映射和观看记录保留；显式勾选文件按预览结果更新，复用事务、过期预览保护和识别撤销。没有新依赖、数据库迁移、真实媒体修改或新 Provider。
- 独立快照完整 Rust 回归 195 通过 / 12 忽略，前端 53 项通过、TypeScript / Vite 构建通过（既有约 539 kB chunk 提示）；当前工作区 `cargo check --locked --offline` 和 TypeScript 通过。6 项新增 Rust 测试覆盖 UNC 命名、中文季锚点、原人工关联、旧解析列重新读取、混季 / 范围拒绝、离线恢复及进度保留。扩展 UI 模拟 IPC 在 1024×640、1366×768、1920×1080 验证按季勾选、默认 parsed、季集预览与显式保存，截图已查看；图片回退测试预期产生 404，不是真实网络错误。
- 首轮完整测试有一项临时夹具重复文件路径，已修正并重新完整通过。其他 Agent 的设计、导航、评分、中文资料、图片及页面草稿保留，详情页只提交本轮增量。下一步重启 `pnpm tauri dev`，已有未匹配文件用“批量按文件名关联 → 仅选对应季 → 预览调整 → 核对并保存”；明确官方季度的作品可刷新资料重新自动分集，无需重新扫描或删除数据。仍为 Unreleased，不打标签或推送。

## 本轮交接：迁移 0016 导致的启动失败（2026-09-27）

- 起点 `fdc6231`，分支 `codex/anime-metadata-v02`。用户报告启动时 `migration 16 was previously applied but has been modified`。前轮开发时先创建 0016 的两个表，再追加两个索引；已执行早期 SQL 的数据库与最终 SQL 校验和不同。已用临时数据库复现相同报错，前轮仅验证新数据库，遗漏存量升级。
- 保持已提交迁移 0016 不变，冻结早期 SQL 到 `src-tauri/migration_compat/0016_initial.sql`，启动仅兼容早期 / 最终版本及 LF / CRLF 的精确 SHA-384 值。差异版本还须核对两个表完整定义与已有索引定义；未知校验和、异常表结构及其他迁移修改仍拒绝。只调整本次运行的迁移描述，不改写历史 `_sqlx_migrations` 校验和。
- 新迁移 0017 用 `CREATE INDEX IF NOT EXISTS` 补齐两个索引；生产初始化和测试夹具使用同一兼容入口。没有重建数据库、覆盖作品或删除文件。AGENTS.md 补充迁移不可修改与存量升级验证规范。
- 排除其他 Agent 草稿的独立快照完整 Rust 回归 189 通过 / 12 忽略，当前工作区 `cargo check --locked --offline` 通过。新增 6 项测试覆盖报错复现、作品 / 来源 / 文件 / 观看进度 / 确认规则 / 人工集号 / 撤销历史保留、已知四种 SQL 字节版本、未知校验和、其他迁移校验、表结构异常、不完整迁移、新数据库及磁盘数据库关闭后重复启动。此轮不修改前端，不重复前端测试；未实际启动用户数据目录或写入真实数据库。
- 其他 Agent 的设计、导航、评分、中文资料、Cargo 与 UI 草稿继续保留，不纳入本轮提交。仍为 Unreleased，不改版本、打标签或推送。下一步从项目根目录重新运行 `pnpm tauri dev`，启动时自动兼容历史 0016 并应用 0017；不要删除数据库或手工改校验和。

## 本轮交接：识别记忆、批量纠错与图片恢复（2026-09-27）

- 起点 `d2c8d7c`，分支 `codex/anime-metadata-v02`。用户确认前三项优化；新增 `recognition_preferences.rs`、迁移 `0016_recognition_preferences.sql`、批量纠错弹窗与独立人工分集覆盖表，没有新依赖，不接入豆瓣、漫画刮削或新播放器。
- 仅明确人工候选确认、关联已有作品及纠错学习；按来源 ID、原始文件解析标题、季度、特别篇与品类推荐。自动匹配不学习，来源或类型不同不套用，多结果保留冲突提示，可删除；不改写真实文件或通过搜索词污染标题记忆。
- 详情可选 1–500 个视频，目标为既有视频作品，保留集号 / 连续编号 / 清除关联，按自然排序预览、勾选确认后事务保存。SHA-256 核对输入、文件归属 / 路径、官方分集、锚点和旧映射等，变化后拒绝过期预览；稳定媒体 ID、观看进度、未勾选文件与个人笔记保留。字幕不自动跨作品移动。
- 无官方分集或同号不唯一时存人工集号，恢复唯一分集后映射为 manual，不创建多余占位。取消关联持续生效；后来的单文件人工映射清除此前覆盖。新表进入识别撤销快照，旧历史缺少新表键的兼容性已测试；后续数据变更不直接覆盖。
- 图片失败尝试同作品缓存缩略图 / 原图，媒体库与详情可“重试图片”，网络恢复重试；有效图片不重载，URL 不加鉴权破坏性参数，源变更立即清除旧失败状态。不新增元数据下载循环；全部图片不可用仍占位。
- 排除其他 Agent 草稿的独立快照最终完整 Rust 回归 183 通过 / 12 忽略；7 项新增专项覆盖规则隔离、撤销兼容、原映射保留、离线恢复、过期预览及合并集数不误映射。前端 53 项、TypeScript、Vite 构建通过；当前工作区 TypeScript 通过。新增 `scripts/check-recognition-preferences.mjs` 使用独立模拟 IPC，在 1024×640、1366×768、1920×1080 验证预览 / 显式保存 / 冲突推荐 / 忘记及图片缓存回退、源变更、失败重试和有效图不重载，截图已查看。构建保留既有约 537 kB chunk 提示。
- 测试使用临时 SQLite、本机服务、随机 Windows 测试凭据与模拟图片；未访问真实媒体库、网盘账号或真实媒体。仍为 Unreleased，只提交本轮范围，不发布版本、安装包、标签或推送；其他 Agent 的设计、导航、中文资料、评分、Cargo 和 UI 草稿保留。
- 下一步重启更新后的 Tauri 后端应用迁移 `0016`，以少量混季视频验收批量纠错及后续刷新；先明确目标季度，再检查预览。旧确认不会自动生成记忆，新人工确认开始学习。官方分集缺失时查看保存提示，不把离线未关联当成恢复失败。

## 本轮交接：扫描任务与增量索引（2026-09-27）

- 起点 `e2e22c9`，分支 `codex/anime-metadata-v02`。用户确认先做实时扫描任务和增量扫描，未扩展识别源、漫画 / 轻小说、豆瓣或播放器。新增 `scan_tasks.rs`、迁移 `0015_scan_task_state.sql`、`ScanTaskPanel` 及三个查询 / 取消 / 重试命令；旧扫描 API 保持兼容，WebDAV 也可从共享面板取消。目录扫描没有可靠总量，不显示假百分比；写入索引显示已处理 / 已发现进度，识别与图片按独立实际流程说明。
- 排队、遍历、写入可取消，原子提交边界拒绝取消；事务回滚保留旧索引。Windows 阻塞调用不可强杀，通过丢弃接收端阻止返回后继续遍历；仍限制最多四个阻塞读取。任务在内存更新，仅开始 / 结束持久化，保留最近 50 次完成摘要；应用异常退出的未完成摘要显示中断，重新完整扫描，不冒充成功。
- 失败目录以结构化路径保存，支持仅重试失败范围；根配置签名、路径边界 / UNC 扩展前缀和写入前配置核对防止跨来源。WebDAV 单目录失败保留已发现文件并继续；局部、失败、取消不标整来源缺失，也不猜测不可见旧路径的指纹迁移。
- 增量仍枚举文件属性，按可信大小 / 修改时间复用解析与指纹，覆盖本地和系统挂载；WebDAV 同时核对定位和 ETag，缺失 ETag / 修改时间时不假定未变。未变行不重写、不重置缩略图、确认信息或更新时间；全量成功只更新确实未出现的旧文件。没有新增依赖，没有访问真实媒体库或账号。
- 排除其他 Agent 草稿的独立快照：最终完整 Rust 回归 176 通过 / 12 忽略，前端 51 项通过，TypeScript / Vite 构建通过（约 529 kB 既有 chunk 提示），当前工作区 TypeScript 也通过。WebDAV 回归仅本机 HTTP 和随机临时 Windows 测试凭据，包含 ETag 复用 / 变化、子目录 503 / 定向重试；新增排队取消、写入中取消整笔回滚、缓存保留、目录边界、局部扫描不接管不可见旧记录和未变行不写测试。任务摘要与开始 / 失败状态均走已有写入队列，避免与索引事务竞争。
- `scripts/check-scan-tasks.mjs` 模拟 IPC 在 1024×640、1366×768、1920×1080（含深浅主题）验证实时进度、取消、重试、离开返回和宽度布局；截图已检查。不替代真实 AList / RaiDrive / NAS 验收，不能保证慢服务器的目录枚举本身加速。
- 本轮仍为 Unreleased，只提交本轮代码及文档，不改版本号、发布、打标签或推送。其他 Agent 的设计、导航、网络评分、中文资料、Cargo 配置及 UI 草稿继续保留。下一步重启更新后的 Tauri 后端，用小范围来源验收扫描 / 取消 / 重试，再重复扫描观察复用计数。

## 本轮交接：媒体库检查与路径恢复（2026-09-27）

- 起点 `b1fb7ac`，分支 `codex/anime-metadata-v02`。用户确认先做路径恢复与异常检查；入口在媒体库，检查最近扫描索引，来源不可用与缺失分开，另列疑似重复、未关联分集和明确季数混放。每类显示最多 200 项，不进行全盘网络探测、不自动删除重复文件。
- 从已扫描来源选择单文件或子目录，按相对路径预览候选并勾选确认。每批最多 1000 个，来源列表最多 10000 个；目录批量仅处理已归档 / 缺失旧记录，无唯一目标保留。SHA-256 预览签名及确认时重新校验，写入使用排队事务，失败整批回滚；稳定原媒体 ID 保留作品、手动分集、字幕、缩略图和观看进度。目标已有归档 / 候选 / 映射 / 进度、已知指纹不同、远程缓存、扫描 / 播放及远程租约保护均拒绝覆盖；不清理真实文件或缓存。
- 更新本地自动合并以保留原媒体 ID，已验证同一资源时合并较新的播放进度，手动映射优先。原路径仍存在、候选不唯一或关联冲突继续保留。WebDAV 定位更新 remote_files，数据库保存原虚拟路径、界面显示解码路径；没有新增迁移或依赖，不改来源配置 / 凭据。
- 隔离快照完整 Rust 回归 165 通过 / 12 忽略，涵盖稳定身份、手动分集、字幕、观看进度、WebDAV 定位、旧记录保留、过期预览、目标保护、扫描冲突、整批失败回滚和异常分类；默认沙箱的 Windows 测试凭据失败，授权环境中的随机临时凭据用例通过。测试夹具媒体 ID 已隔离，避免与播放器测试全局租约冲突；最终远程定位与自动合并保护另经专项回归确认。
- 前端 51 项测试、TypeScript 与独立快照 Vite 构建通过（约 526 kB 的既有 chunk 提示）；新增模拟 IPC 检查在 1024×640、1366×768、1920×1080 验证离线分类、目录预览、部分勾选确认、单文件搜索及过期预览，含深浅主题，截图已查看。所有 SQLite / IPC / HTTP 使用隔离夹具，未访问真实媒体或用户数据库。
- 本轮仍为 Unreleased，未发布安装包、打标签或推送。需要重启更新后的 Tauri 后端加载新命令；下一步用少量真实移动资源验收路径预览。已有远程缓存资源暂不迁移，原来源保留；其他 Agent 的导航、设计、中文资料、网络评分与 UI 草稿继续保留，只提交本轮范围。

## 本轮交接：识别记录时间范围（2026-09-27）

- 起点 `5ea6353`，分支 `codex/anime-metadata-v02`。用户报告记录混入久远操作；现有实现只有最近 50 条限制，无时间范围。检查代码确认 `created_at` 来自识别确认时的 UTC 时间，后台补源不会重置它；没有检查真实数据库，不能声称所有存量时间均正确。
- 前端默认最近 7 天，可选 24 小时 / 30 天 / 全部保留记录；按实际时间戳排序，按本机日期分组，识别 / 撤销分别标注到秒。过滤采用过去连续时长，未知 / 未来时间不进入近期范围，未知时间仍可在全部中查看。全库 50 条保留、作品 ID 范围和撤销事务不变；没有迁移或改写旧记录。
- 工作区及排除其他 Agent 草稿的独立快照均通过 47 项前端测试与 TypeScript 检查；独立快照 Vite 构建通过，既有约 515 kB chunk 提示非阻断。模拟 IPC 在 1024×640、1366×768、1920×1080 验证默认范围、久远记录、范围切换、排序、撤销时间、作品隔离和全局入口，截图已查看。未改 Rust，因此未重复后端测试；未访问真实媒体或数据库。
- 本轮仍为 Unreleased，未制作安装包、发布或推送。下一步在日常识别记录中验收时间范围；其他 Agent 的设计、导航、元数据与评分未提交草稿继续保留。

## 本轮交接：作品详情的识别记录范围（2026-09-27）

- 起点 `4b2ffd0`，分支 `codex/anime-metadata-v02`。用户要求详情页只显示本作品识别记录；采用目标作品 ID 查询，避免同名作品混入。待整理的全局记录和全库最近 50 条保留策略保持。
- `list_recognition_history` 新增可选 `workId`，数据库参数化筛选；详情页传入当前 ID 并以 ID 重置组件，撤销后的刷新也传入同一范围。没有新增迁移，不改撤销事务、真实文件或用户数据。
- 独立快照保留详情页识别记录入口并排除网络评分 / 中文简介等既有草稿；TypeScript、Vite 构建和 44 项前端测试通过。新增模拟 IPC 三尺寸检查通过：同名作品隔离、切换作品、已撤销记录、撤销后查询范围和全局待整理入口；截图已查看。
- Rust 识别历史专项 7 项测试通过，包括新增作品 ID 筛选、未知作品空结果及全局查询兼容；本轮只改查询范围，未重复整个后端回归。未执行真实媒体库验收、安装包发布或推送；运行新命令参数需更新 Tauri 后端。
- 下一步：在日常作品详情页验证只出现当前作品的记录；继续保留其他 Agent 的未提交设计、导航、中文资料及网络评分草稿。

## 本轮交接：识别预览、撤销与批量整理（2026-09-27）

- 起点 `ec55c44`，分支 `codex/anime-metadata-v02`。用户确认先做识别文件范围预览 / 撤销和待整理批量 / 连续处理，未扩展扫描任务、豆瓣、漫画或播放器。
- 沿用现有预览，增加按季度、特别篇分组勾选及固定底部确认。没有季度信息的连续编号不猜季数；已关联到其他作品的文件保留。手动搜索 / 按文件名查找均仅生成候选，确认前不改归属。
- 「批量预览与确认」在当前目录及子目录查找，最多 50 组 / 批；候选默认未勾选，核对后可统一确认，选择范围可调整。逐组事务保存，失败可重试，成功项不重复提交。「关联已有作品」也需核对文件并二次确认。连续队列按季度组去重，刷新只保留当前位置及之后的待整理项，避免回到已跳过项；后台刷新保留目录列表。收藏 / 标签不再隐藏待整理文件。
- 验证并完善原撤销草稿：迁移 0013 内容保持不变（已有 0014 的库可补应用 0013，隔离回归通过），最近 50 条记录覆盖 Bangumi / TMDB 确认和批量关联已有作品。计数按实际勾选文件而非整个作品；后台补源更新撤销预期状态，已撤销的后台操作不会再次写入。相关作品、分集或文件有后续变化时拒绝撤销，避免覆盖用户数据；播放进度、远程缓存和真实文件不改写。
- 独立快照排除了其他 Agent 的导航记忆、中文资料、网络评分、设计与 UI 草稿：`cargo test --locked` 156 通过 / 12 忽略（包括三个需要临时 Windows 测试凭据的远程存储用例）；前端 44 项通过，TypeScript / Vite 构建通过。既有约 513 kB chunk 提示非阻断。
- `scripts/check-recognition-organizer.mjs`：1024×640、1366×768、1920×1080（包含深浅主题）通过，覆盖确认前无关联写入、分季文件范围、部分失败重试、成功不重复提交、撤销刷新、选择文件关联已有作品、跳过后不返回旧项及目录保留；截图已查看。所有数据库 / HTTP / IPC 为隔离夹具，未访问真实媒体库、媒体或账号。
- 本轮交付仍为 Unreleased；未改版本号、制作安装包、打标签或推送。新增命令与迁移需运行更新后的 Tauri 后端；真实 Bangumi / TMDB 账号及媒体库验收尚未执行。
- 下一步：用少量日常混季资源验收「分组勾选 → 预览确认 → 识别记录撤销」，再尝试一批待确认资源；后续其他 Agent 先核对当前 Git 状态，未提交的其他草稿继续保留。

## 本轮交接：WebDAV 点击选择文件夹（2026-09-27）

- 起点 11d9313，分支 codex/anime-metadata-v02。用户确认不希望手填扫描目录；添加流程现默认从根目录连接，点击文件夹进入、路径导航/返回上级，在固定底部核对完整目录并确认扫描（包括子文件夹）。目录输入仅在折叠高级选项保留。
- 成功浏览才允许扫描；失败或服务器/凭据改变使旧选择失效，改名称不清除目录。浏览时禁用连接输入防止过期结果；保存仍传递已成功打开的 directory，沿用既有 add/browse/scan API，未改 Rust 或数据库。
- Modal 新增可选 footer，只有此次 WebDAV 添加使用固定底部，其他弹窗不变。小窗口底部显示完整选中路径和确认按钮，长路径区域可滚动。
- 工作区及排除其他草稿的独立快照：39 项前端测试、TypeScript 和 Vite 构建通过，既有约 504 kB 包大小提示。verify-remote-storage.mjs 三尺寸 1024×640 / 1366×768 / 1920×1080（含深浅主题）通过；覆盖多级目录、空目录、根/上级导航、高级路径、失败禁用、名称/凭据变化、确认前不扫描及正确目录提交，保留原停用/待整理/离线入口检查。截图已查看并核对固定确认区。使用模拟 IPC，未访问真实凭据、媒体或库；未重跑后端测试，因为本次仅前端交互变动。
- 保留其他 Agent 的 UI、识别和 Cargo 配置草稿，只提交本轮交互、验证及说明。不生成安装包或发布；真实服务需更新前端后验收。

## 本轮交接：AList WebDAV 目录解析（2026-09-27）

- 起点 f6fbbfc，分支 codex/anime-metadata-v02。用户报告 localhost:5244/dav 的目录浏览提示无法解析；按 AList 官方 prop.go 的不适用目录属性响应构造隔离 XML，修复前准确复现同一错误。未读取用户密码、真实响应、真实媒体或真实库，故不能断言真实服务已验收。
- 根因：所有 propstat 在反序列化时将 getcontentlength 直接转成 i64，目录 404 属性组的空标签让整份响应失败。改为先读取文本、筛选成功属性后校验文件大小；目录为 0，空/未提供大小为未知 0；成功属性非数字、负数、溢出仍返回错误保留旧索引。认证、路径范围、DTD 与失败状态检查保持。
- 新增三项解析回归，原失败用例修复后通过；中文目录、空 404 属性、大小边界和既有路径约束共五项通过。模拟 HTTP 的远程存储夹具加入相同 AList 根目录响应；排除其他草稿的独立快照 cargo test --locked 完整回归 149 通过、12 忽略，包括扫描/断线保留/缓存回退的三项远程存储测试。测试凭据仅为临时 Windows 凭据。未修改前端，因此未重复 TypeScript/Vite 检查。
- 本轮只提交 webdav.rs、remote_storage_tests.rs 和配套文档；其他 Agent 未提交 UI/识别/Cargo 配置继续保留。未制作安装包或发布，实际用户 AList 仍需更新运行程序后验收。

## 本轮交接：媒体库分类筛选（2026-09-26）

- 起点 4401454，分支 codex/anime-metadata-v02。本次按已有 category 筛选动漫、电影、电视剧、漫画、小说、游戏、未分类视频及其他，并提供全部视频。未知视频不猜测分类，不修改数据库或真实媒体。
- 替换媒体库文件类型下拉；待整理保留原文件类型，两者独立。分类存入 URL 查询参数，刷新及历史返回可恢复；支持既有搜索、标签、收藏和范围筛选，网格/列表共用结果。
- 工作区及排除其他草稿的独立快照：39 项前端测试、TypeScript、Vite 构建通过；构建有既有约 502 kB 包大小提示。模拟 IPC 的三尺寸（1024×640、1366×768、1920×1080）检查通过，涵盖分类、全部视频、搜索空结果、列表、刷新、待整理隔离及溢出。未改 Rust，未重复后端测试；真实桌面库仍待用户验收。
- 保留其他 Agent 的导航、识别历史、海报性能及 UI 草稿；只提交本轮分类和文档。未制作安装包、发布标签或推送。漫画/小说筛选不代表已实现其自动刮削。

## 本轮交接：PotPlayer 启动误判与连续换集

- 起点 `794168b`，分支 `codex/anime-metadata-v02`。用户确认刚打开就提示“已切换文件”，并要求在 PotPlayer 内点下一集后继续记录。旧逻辑一次路径差异便退出采集；现改为持续等待确认、绑定后连续两次有效样本才切换唯一匹配的库内视频。
- 支持 PotPlayer64.exe / PotPlayer.exe，保持 Mini 版本兼容；流式工具识别同步补齐。路径比较补上大小写扩展 UNC、file URI 与 Windows 登记的网络盘映射。只比较完整资源身份，不按同名/集号猜测；首个请求未确认时不采集其他文件。
- 上一集与下一集按独立 ID 缓存/保存，未知文件、歧义路径、临时读取失败继续等待；不同进程的记录由会话所有权隔离。旧样本保留采样时间，迟到重试不覆盖较新记录；数据库失败仍保留待写样本。
- 独立快照 Rust 完整回归 146 通过、12 忽略；前端 36 通过，TypeScript 和 Vite 构建通过（约 502 kB 的非阻断包大小提示）。工作区默认沙箱测试曾因 Windows 凭据权限导致 3 个远程存储用例失败，独立快照在授权环境完整通过。
- 使用 D:/potplayer/PotPlayer64.exe 和合成 AVI 验证真实路径/跳转、暂停写入及重开续播、同窗口下一集切换；新换集用例验证 Unicode 文件名与最近记录媒体 ID。三项实机测试最终分别通过（最终暂停/重开专项耗时约 42 秒）。实机测试曾暴露启动等待与关键帧时间断言过严：现在明确等待有效文件/位置再暂停，续播检查使用实现既有的 2 秒跳转容差；换集仍严格检查上一集位置不回退及下一集独立记录。
- 此次没有读写真实用户媒体和媒体库数据库，没有制作安装包、打标签或推送。源程序启动仍要求 Genzo 保持运行；非库内文件、无法映射的 WebDAV 重定向/外部 URL 不推测归属。用户实际 RaiDrive 服务器与播放器组合仍需更新后验收，不能将合成视频测试等同于所有挂载环境通过。
- 其他 Agent 的导航缓存、UI、元数据和识别撤销草稿继续保留；只提交本轮播放器链路与文档差异。相关长期边界与协议核对来源已同步 ROADMAP.md 和 docs/PLAYBACK.md。

## 本轮交接：作品播放入口与首页海报

- 修复主按钮无记录时会选到字幕/附件的问题：先按官方正片顺序找可用视频，未提供结构时按视频类型、正片和已解析集号选择；既有续播优先级不变。
- 首页海报栏和列表显式按 createdAt 排序，不因 updatedAt 变化把旧作品当作最近添加。底层通用作品列表仍保留原排序语义。
- 首页向 MediaVisual 传原始图片路径，避免重复转换 asset URL；coverUrl 对已转换 URL 保持不变。缩略图失败回退原图，原图也失败显示占位。不会伪称损坏/缺失的缓存图片已恢复。
- 36 项前端测试、TypeScript 与 Vite 构建通过（非阻断 chunk 大小提示）；check-work-entry 和既有 check-episode-progress 三尺寸通过。模拟字幕/OP/正片混合、旧作品新更新时间、图片缓存失败及续播，不读取或修改真实媒体和数据库。
- 保留其他 Agent 的首页/详情/观看记录样式等未提交改动；此次不包含后端修改、安装包或发布。PotPlayer64.exe 兼容和播放器内部换集追踪仍未完成。

## 本轮交接：紧凑观看记录

- 用户要求仅显示上次观看，现已将首页/详情记录限制为按时间选择的一条，缩小标题、间距与进度条，说明折叠。完整历史未删除，各分集进度保留。
- TypeScript 与三种尺寸 UI 检查通过，新增多集历史仅渲染一条及紧凑高度断言。未修改播放采集后端；PotPlayer64.exe 名称兼容仍是前轮发现的待处理项。

## 本轮交接：续播集数与分集进度

- 起点 `2d6691c`，分支 `codex/anime-metadata-v02`。已确认原详情主按钮按文件名选择第一个可用文件，没有消费播放记录；分集卡片此前没有进度显示。
- 首页选中作品与详情主按钮现在按最后观看时间选择具体文件；默认打开曾记录的 PotPlayer 工具。详情与分集卡片、观看历史共享轮询结果。初次读取失败不误开第一集，后续失败保留旧数据；切换作品立即隔离前一作品记录。
- 分集封面新增底部蓝色进度条（含可访问时间描述）；多版本默认使用上次观看版本，显式切换版本优先。无官方分集时的文件卡片也显示各自记录。不推测未观看文件的进度，不改真实媒体或真实数据库。
- 验证：工作区和排除其他草稿的独立快照均为前端 32 项通过、TypeScript 通过；Vite 构建通过，有约 501–505 kB 的非阻断包大小提示。新 `scripts/check-episode-progress.mjs` 在 1024×640、1366×768、1920×1080 验证首页/详情续播第 7 集、50% 底部进度、失败保留与无记录行为，截图已查看。既有 `check-playback.mjs` 三尺寸通过。本轮未改 Rust，因此未重复执行后端/实际播放器测试；使用模拟 IPC，不据此声称真实媒体已验收。
- 已向用户询问是否在 PotPlayer 内自动换集，尚未收到回答。现有采集器在播放器切换文件后仍停止追踪；用户需从 Genzo 打开下一集。本次修复已保存记录的消费链路，没有实现播放器内自动换集追踪，也无法恢复此前未采集的观看位置。
- 不包含安装包、正式发布、推送或其他 Agent 草稿。后续先请用户验收日常视频续播；若主要依赖 PotPlayer 自动换集，应单独补充对库内新文件身份的可靠追踪。

## 本轮交接：PotPlayer 观看记录与续播

- 起点 `f78f78f`，分支 `codex/anime-metadata-v02`。用户确认先验证播放链路，前端后续再优化；本轮仍属 Unreleased，没有安装包、版本标签或远程推送。
- 新增 `playback.rs`、Windows `potplayer.rs` 和迁移 0014，按媒体 ID 保存实际位置。只采集由 Genzo 启动的 PotPlayer 独立实例，核对当前文件路径；支持原打开链路的本地、UNC/RaiDrive 和 WebDAV 资源身份。没有改写真实媒体或操作真实库数据库。
- 首页/详情新增基础观看记录、继续观看、从头播放入口；其他播放器仍只打开。需要在 Genzo 中选择 PotPlayer（或设为默认视频工具），系统默认打开不记录。约每 5 秒写入；正常关闭播放器补存最后样本，Genzo 退出后停止采集。播放器换集停止原文件记录，下一集从 Genzo 打开。
- 文件重新关联作品/扫描保留 ID 的移动不丢失记录。数据库错误、无效时间、初始跳转未就绪保留旧位置；近片尾不修改用户手动作品完成状态。原有识别撤销/中文资料/评分/设计草稿保持独立，不纳入本轮提交。
- 实际安装的 `D:/potplayer/PotPlayerMini64.exe` 已用生成的无声 60 秒 AVI 验证：返回正确文件、10 秒跳转、暂停位置写入临时 SQLite、关闭重开续播、重复启动保护。两个按需测试通过；测试结束后测试播放器已关闭。该程序文件版本字段为 0，故不推测正式版本号。
- 工作区回归：Rust 146 通过、11 忽略（其中 2 个播放器测试已单独通过）；Windows 凭据测试在沙箱外运行通过。前端 27 通过，TypeScript/Vite 构建通过（有大于 500 kB 的非阻断 chunk 提示）。新 UI 脚本验证三种尺寸、按钮参数、活动会话禁用、读取错误保留旧内容，并检查截图。
- 2026-09-26 按用户截图加大首页横幅右下海报栏；通过 1024×640、1366×768、1920×1080 的宽度、标题避让和页面溢出检查。该前端细化另记独立提交。
- 播放功能提交 `60aed45`；独立暂存快照 Rust 143 通过、11 忽略，Windows 合成媒体 PotPlayer 两项实际测试通过；前端 27 通过、TypeScript/Vite 构建通过。环境快照测试与日常工作区存在用户并行改动时应使用提交/暂存代码复核。
- 真实用户 WebDAV/RaiDrive 视频续播仍待逐服务验收。实现接口与 Open Design 后续对接说明见 `docs/PLAYBACK.md`。下一步优先用日常视频验收；豆瓣和其他播放器不属于本轮范围。

### 工作区接力提示

- 当前分支 `codex/anime-metadata-v02`，播放记录提交为 `60aed45 feat(playback): add PotPlayer resume tracking`；首页海报尺寸调整单独提交。其他 Agent 未提交的 UI/识别草稿继续保留；开始后先运行 `git status --short` 并辨认暂存、工作区改动，不要覆盖或一并提交它们。
- 可见的其他未提交内容包括设计令牌 v1.1.2、探索页/首页推荐卡片、中文资料与网络评分、识别历史撤销迁移 0013 及其命令、组件。它们不是 `60aed45` 的一部分。

## 本轮交接：品类标签与图片质量

- 起点提交 `d574612`，分支 `codex/anime-metadata-v02`。本轮为 Unreleased 修复，未生成安装包或推送发布。
- 新增只读作品 `category`：根据既有主源区分动漫、电影、电视剧；漫画/小说/游戏沿用原作品类型，未知视频不推测。Bangumi 主源优先于 TMDB 动漫补源。不改媒体文件类型、原始文件、手动关联或用户标签；媒体库品类筛选入口留待后续。
- 品类显示覆盖媒体库海报/列表、关联作品列表、首页轮播/书架和详情页。作品列表只批量读取本地分类，不逐卡请求元数据接口。
- 已定位影视背景模糊原因：旧代码统一请求 TMDB `w780` 并按默认 JPEG 质量二次编码。现在横幅请求 `original`，已验证的 JPEG 原样缓存，其他格式与平滑缩略图采用质量 95 编码，首页背景去除额外对比度滤镜。
- 新缓存按来源 URL 和编码版本生成独立文件；**旧作品需进入详情点“刷新元数据”升级图片**。失败保留原图；影视图片失败会提示警告。海报墙与首页优先用平滑缩略图，缩略图加载失败回退原图。没有直接操作真实用户数据库或媒体。
- 用户已明确选择“先修标签和画质，豆瓣稍后接入”，不新增豆瓣接口或伪装已可用的数据源。
- 原有未提交的网络评分/中文简介、识别历史撤销、样式及设计草稿按本轮开始时的状态保留，不纳入本轮提交。
- 最终独立提交快照（导出至 `.tmp/film-tv-validation`，不含旧草稿）验证：`cargo test --locked` 141 项通过、9 项需要外网/真实媒体的用例忽略；`pnpm test` 26 项通过，`pnpm run build` 的 TypeScript/Vite 构建通过。`check-library-artwork.mjs` 和 `check-film-tv.mjs` 均在 1024×640、1366×768、1920×1080 通过；覆盖品类标签、缩略图回退、原尺寸背景显示和既有跨季关联。图片测试使用合成图片，尚未在真实账号中比对升级前后海报的主观观感。

## 本轮交接：电影与电视剧识别

- 用户确认先完成电影和电视剧；漫画与轻小说后续单独做。本轮为 Unreleased 功能提交，三个发布版本字段仍为 v0.4.4，没有创建发布标签、推送远程或生成安装包。
- 新增 `film_tv.rs`：TMDB 中文搜索、分类型候选、片名/年份与季集解析、持久缓存和过期回退、网络重试、独立季度锚点、分集映射与剧照。共享原有作品、文件和个人记录表；本轮影视功能不新增数据库迁移。
- 待整理和识别弹窗可选择动漫/电影/电视剧；新增凭据设置入口。电影默认只勾选当前文件；电视剧确认拒绝明确属于其他季的视频。候选先预览范围再确认，后台补齐资料。已有 TMDB 季度复用，同目录原作品及个人记录保留。
- 官方分集为空或失败时不删除旧分集；手动关联优先。中文资料缺失时保留已有非空简介；不承诺 TMDB 所有条目都提供中文。
- 批量影视识别只生成候选，不自动确认；无法确定季度、合并多集的文件仍需人工核对。已入库季度可以在详情跳转。未做真人影视探索榜单、演员专题页、内置播放器、漫画/小说刮削。
- 全程使用隔离 SQLite、模拟 HTTP/Tauri 和测试媒体记录，未运行用户数据库迁移，也未改写真实媒体文件。

### 工作区和验证边界

- 分支仍为 `codex/anime-metadata-v02`，本轮起点为 `3c34e45`。影视改动按独立提交保存；提交后以 `git log`、`git diff` 为准。
- 原有中文简介/网络评分以及识别历史撤销草稿继续留在工作区，未随影视提交纳入：`metadata_aggregator.rs`、`providers/tmdb.rs`、`recognition_history.rs`、迁移 0013、`RecognitionHistory.tsx` 及相关共享文件中的片段。识别预览前端经复核后复用于本轮，撤销后端保持独立。
- 修复了既有撤销草稿中 Rust 临时 SQL 字符串借用导致的编译错误，该草稿的两个测试通过，但不代表本轮正式发布撤销功能。`.tmp/` 和 `design/open-design/v1.1-draft/` 保留。
- 工作区 Rust 完整回归曾通过 141 项、9 项依赖外网/真实媒体的测试忽略；沙箱内 Windows 测试凭据不可写导致 3 项现有 WebDAV 用例失败，沙箱外运行同一组测试通过。最终暂存代码导出到 `.tmp/film-tv-validation` 独立验证（不包含原有草稿）：`cargo test --locked` 通过 138 项、忽略 9 项，0 失败。
- 最终提交快照的 `pnpm test`：26 项通过；`pnpm run build`：TypeScript 与 Vite 构建通过。`scripts/check-film-tv.mjs` 与 `scripts/check-season-split.mjs` 均在 1024×640、1366×768、1920×1080 通过，覆盖电影文件展示、TMDB 剧照、季度勾选、确认参数及保留第一季范围；截图在验证目录被忽略的 `artifacts/screenshots/`。
- 尚未验证真实 TMDB 凭据、用户网盘服务和 Windows 桌面壳内的影视端到端流程；需要用户配置 Token 后用自己的目录验收。不要仅凭隔离测试声称真实媒体库已识别完成。

### 下一步

1. 先检查未提交草稿，保留它们；不要把旧草稿当作本轮影视交付的一部分。
2. 启动桌面开发版本，在设置中保存 TMDB Read Access Token，分别验收一部电影、同目录两季电视剧和 WebDAV/RaiDrive 路径。核对原作品、私人笔记与文件关联仍保留。
3. 确认范围和真实环境验收后，再单独同步版本字段、打包与发布；不要直接将当前混合工作区打包发布。

---

以下为 2026-09-24 的历史交接快照，保留有效背景；当前状态以上文和实际代码为准。

## 1. 项目整体进度

- 项目为 Genzo：Windows 优先、本地优先的 ACGN 统一媒体库，使用 Tauri 2、React、TypeScript、Rust 和 SQLite。产品及技术边界以 `PROJECT_CONTEXT.md` 为准，版本计划以 `ROADMAP.md` 为准，界面以 `DESIGN_DIRECTION.md` 和已确认的 Open Design v1.1.1 为准。
- 最新已有发布标签及三个版本字段（`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`）均为 v0.4.4。`CHANGELOG.md` 另有 `[Unreleased]` 条目；这些条目不代表已经生成或发布了下一个版本。
- v0.4.4 已涵盖大目录与挂载路径扫描稳定性修复。此前路线文档记录了 WebDAV、系统挂载目录、远程播放和缓存的 v0.4 范围；真实服务兼容性仍须按用户环境验收。

## 2. 当前正在推进的功能

同目录跨季重新识别（本轮已修复并通过隔离回归，待真实媒体库验收）：

- 根因：候选确认使用整个展示范围判断是否复用原作品，未按实际勾选范围判断；同目录已有作品还会未经条目校验被复用，导致第一季锚点被第二季覆盖。
- 现在按实际勾选文件拆分；同目录不同 Bangumi 条目分别归档，已有目标作品则复用其 ID。从未匹配文件发起识别时，排除已关联官方分集或手动分集的文件及其字幕，保留原作品标题、锚点、笔记和收藏。
- `[NCED01]` / `[NCOP02]` / `[OAD01]` 与 `[12.5]` 保留特殊类型，不再混进正片重新识别范围。用户确认该例是连续编号，不应一律按每 12 集猜季度。
- 不自动恢复此前已经覆盖的作品；不改写真实媒体文件、用户数据库或数据库迁移。

分集与缩略图（本轮已实现，待用户验收）：

- 自动分集：正片按季度 + 集号、特别篇按文件序号、OP/ED 按类型对应官方分集；`match_method='manual'` 始终优先，匹配不唯一或缺少序号时留给手动。
- Bangumi 分集不再只抓正片：新增 `anime_episodes.episode_type`（迁移 0012），分集区按「正片」/「特别篇 / OP / ED」分组。**旧作品需要点一次「刷新元数据」补齐类型并重算关联。**
- 同一作品里混装其它季度时不再完全放弃自动分集：有 Bangumi 季度信息时只关联本作品季度的文件，没有则退回保守做法（不猜集号）。
- 挂载网盘缩略图：自动加载只查 Windows 已缓存缩略图，`get_media_thumbnail` 新增 `force`，只有「重试缩略图」才做完整提取。
- 待整理页的识别范围与连续处理（上一轮已完成，见 CHANGELOG）。
- 仍未实现：待整理目录层级响应鼠标侧键/返回操作（见第 4 节）。

## 3. 已完成的相关工作

- 已有的 v0.4.4 发布可由版本字段、Git 标签和 `CHANGELOG.md` 相互核对。
- 当前 `CHANGELOG.md` 的 `[Unreleased]` 记录了待整理作品组排序、直接打开识别/候选、确认后留在当前列表刷新等改进；当前 `LibraryPage.tsx` 和 `RecognitionDialog.tsx` 中也能看到对应入口及确认后的列表刷新处理。
- 项目已有 `.agents/skills/project-builder`、`bug-hunter` 和 `project-maintainer` 三个技能；根目录 `AGENTS.md` 已列出其适用场景。
- 本次新增 `AI_HANDOFF.md` 并补充 `AGENTS.md` 的跨 Agent 接力规则；这两项仅属于协作文档修改，不代表媒体库功能已更改。

## 4. 尚未完成的工作

1. 让目录层级导航响应返回操作：在子目录返回上一级，在根层级退出待整理页面；有弹窗时优先关闭最上层弹窗。具体适配 Windows WebView 的鼠标侧键行为仍需实测。
2. 待整理的连续处理目前只覆盖当前层级；跨层级队列、批量自动处理仍未设计。
3. 在常用 Windows 窗口尺寸下实测本次新增的待整理分组区、季度列表与连续处理弹窗布局。
4. 浏览器预览（`pnpm dev`）走 `mockProvider`，新后端命令只能在 Tauri 桌面壳里验证；需要重新构建或 `pnpm tauri dev` 后实测。

## 5. 当前存在的问题

- **用户报告，尚未在本轮复现：** 鼠标侧键返回会跳出当前大界面（本轮未处理）。
- **已验证修复（有回归测试）：** 字幕多于视频的作品组被判成「其他」；待确认没有确认入口；大文件夹里先前识别过的文件另建重复作品；同目录连续编号文件拆第二季时覆盖第一季。
- 工作区中存在与本轮无关、由本会话较早回合产生的未提交改动（网络评分展示、中文简介保留，见第 8 节），本轮未纳入提交，也未验证其功能完整性。

## 6. 重要技术决策

- 沿用 Tauri 2、React/TypeScript、Rust、SQLite 和本地优先的产品架构；Windows 为首要平台。不要仅为本次 UX 改进引入新框架或重写导航系统。
- 动画识别以 Bangumi 为主锚点；季度、特别篇和类型有冲突或歧义时继续要求用户确认，不能为减少点击而自动关联不确定候选。
- 媒体文件和用户数据按现有模型管理；不得移动、删除或改写真实媒体文件。扫描/识别失败也不能清除有效索引和手动关联。
- 详细产品、远程存储、数据库与交互决策以 `PROJECT_CONTEXT.md`、`ROADMAP.md`、`DESIGN_DIRECTION.md` 和现有实现为准。

## 7. 下一步建议

1. 开始代码工作前检查 `git status` 与 `git diff`，阅读 `AGENTS.md`、本文件及三个项目决策文件；保留已有未提交文件。
2. 真实桌面验收本轮跨季修复：从第一季下方未匹配文件进入识别，核对第二季文件范围后选择第二季，确认第一季仍保留。已经被旧逻辑覆盖的作品需要用户重新确认归属。
3. 后续在隔离前端夹具中复现鼠标侧键和常规返回键行为，确认 WebView 实际事件路径及 Modal/Drawer 的覆盖顺序。
4. 实现目录导航历史和弹窗返回优先级；连续处理已可用，扩展跨层级队列时保持「候选确认由用户明确执行」。
5. 扩展功能后重新运行适用检查，并更新本文件。

## 8. Git 分支与未提交状态

本次核对的代码快照：

- 分支：`codex/anime-metadata-v02`。
- 本轮修复基于 HEAD：`bc4321f`（`feat(anime): auto-link episodes by installment and stop slow mount thumbnails`）；当前修复以独立提交保存，准确提交号以 `git log` 为准。
- 工作区还有本会话较早回合留下、与本轮无关的未提交改动：`src-tauri/src/metadata_aggregator.rs`、`src-tauri/src/providers/tmdb.rs`、`src/pages/WorkDetailPage.tsx`，以及 `metadata.rs`/`commands.rs`/`models.rs`/`types.ts` 中网络评分与中文简介相关的片段。这些改动未经验收，未被本轮提交包含；不得丢弃或覆盖。
- 已有未跟踪目录：`.tmp/`、`design/open-design/v1.1-draft/`，保留。构建产物 `dist/`、本轮截图 `artifacts/screenshots/season-split-*.png` 由 Git 忽略。

## 9. 已执行的测试与结果

- `cargo test --locked --manifest-path src-tauri/Cargo.toml`：131 通过，0 失败，9 个需要联网或真实媒体文件的用例被忽略。沙箱内三个远程存储测试因无法保存 Windows 测试凭据失败，放宽沙箱后完整通过。
- 最终调整后重跑 `cargo test --locked --manifest-path src-tauri/Cargo.toml metadata::tests::mixed_folder_confirmation -- --nocapture`：通过，覆盖 UNC 同目录连续集号、部分勾选、官方/手动关联保留、已有第二季复用和未归档文件确认。
- `pnpm test`：4 个测试文件、22 个用例通过。
- `pnpm run build`（`tsc -b && vite build`）、`git diff --check`：通过。
- `node scripts/check-season-split.mjs`（先在 4175 端口启动 Vite）：1024×640、1366×768、1920×1080 均通过。模拟 Tauri 返回值，验证识别弹窗仅包含第二季待拆分文件、取消勾选后只提交选择项，并检查横向溢出；截图位于 `artifacts/screenshots/`。
- 未运行：Windows 桌面壳内的真实交互实测、鼠标侧键返回行为、真实媒体库上「刷新元数据 → 自动分集」的端到端验收（需要联网与用户媒体库）。
