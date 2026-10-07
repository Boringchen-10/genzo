# 模拟器前端自动预览（2026-10-07）

用户当前先在电脑模拟器观察和修改前端，效果确认后再安排实体机。本流程只重建 React 页面，不构建或安装 APK；SQLite、原生接口和阅读缓存仍来自模拟器中已安装的 Genzo 调试包。仅面向 `emulator-5554`，不会选择同时连接的一加设备。

## 启动

先在现有 `Genzo_Pixel9_API36` 模拟器打开已安装的 Genzo。在 Android Studio 的终端或 PowerShell 中切到安卓工作树：

```powershell
Set-Location -LiteralPath 'H:\二次元阅读器\.tmp\android-first'
pnpm exec vite build --watch --outDir D:/DevTools/Android/Build/frontend-preview
```

等首次前端构建成功，在第二个终端同样切到工作树后运行：

```powershell
node scripts/preview-android-frontend.mjs
```

两个终端保持运行。保存 `src/android/` 下的 React 或 CSS 后，Vite 重新编译；第二个终端输出「前端重建完成，模拟器已刷新」。代码仍在 H 盘，预览构建输出在 D 盘，不占用现有 Windows 开发服务端口。

## 实现边界

- 脚本通过 ADB 将模拟器当前 Genzo WebView 的调试套接字映射到本机 `9228`，使用已有 `playwright-core` 接入 CDP。须使用已开启 WebView 调试的现有调试包，并先启动应用；关闭／重新启动应用后需要重新运行预览脚本。
- 页面继续运行在已安装应用的 `http://tauri.localhost` 源下，执行当前 Vite 构建的 JavaScript 并内联 CSS，因此可以调用现有 Tauri 后端。没有改应用权限／capability／正式 CSP。CDP 只为当前调试会话设置 CSP bypass，不能作为生产加载方式。
- 当前构建只有一个 JavaScript 入口，脚本对此作检查；以后若拆出动态模块，需要重新评估预览方式。图片仍用既有封面接口／应用资产，新增随包静态文件或原生接口不保证立即可用。
- 这是调试资源预览，不是官方 Tauri Android HMR。刷新会重置页面内的临时筛选、弹层和下载选择；数据库中的作品、收藏、状态、评分与既有缓存保留。操作仍会调用真实后端，点击下载会写入应用阅读缓存。
- 重新启动应用或手动重载 WebView 会回到 APK 内置前端，需要再次启用预览。只有后续另行构建 APK 才能将修改永久装入应用。Rust／Kotlin／迁移／原生播放器修改仍需构建，本轮未做这些修改。
- 用 `Ctrl+C` 停止预览终端。关闭窗口不会清除应用数据；如果应用进程重启导致调试连接断开，先确认 Genzo 已打开，再重启第二个终端脚本。

## 本轮验证

`scripts/verify-android-comic-detail.mjs` 检查模拟器当前预览与已有测试作品「魔都精兵的奴隸」：三行简介展开／收起，默认 214／单行本 20／其它汉化版 1 的实际分组，100 条分页及末页 14 条，全目录倒序，多选下载，发现页封面进入／返回动画和滚动恢复。三个样本章节实际缓存成功；下载中途失败及剩余选择重试使用独立 iframe 夹具验证，没有用夹具替换生产原生接口。

快速缓存响应与转场初始化的覆盖竞争已修正；QA 在两次进入发现详情后逐项对比原生 DTO 的简介、作者、状态与标签，避免把简略列表资料当成完整详情。结果中 `cachedDetailPreserved=true`。

360／412／915 宽度无横向溢出，20 个作品的 ID／收藏／状态／评分摘要前后相同，未操作原始媒体文件。结果与截图在 `D:\DevTools\Android\Build\qa\comic-detail-20261007`；`watch-preview.json` 记录保存 CSS 后自动应用并恢复的验证。

```powershell
pnpm check
pnpm test
node scripts/verify-android-comic-detail.mjs
```

QA 脚本需要这份已有的模拟器测试数据和三个已缓存章节，不是空数据库通用测试。目录分页边界另由 `OnlineChapters.test.ts` 的八组样本覆盖；前端全套共 20 文件／86 项通过。Windows 共享前端编译通过，未重新打 Windows 安装器或完成全部窗口人工回归。
