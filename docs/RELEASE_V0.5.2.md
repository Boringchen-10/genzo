# Android v0.5.2 发布记录

日期：2026-10-09。用户指定将当前安卓程序打包为 v0.5.2，供实际用户安装使用。本版沿用 v0.5.1 的固定发布签名与包名，可覆盖升级并保留普通包数据；只交付正式 APK，不携带测试数据。Windows 安装器保留 v0.5.0。

## 产物

- 文件：`Genzo_0.5.2_android_arm64-v8a.apk`，Android 8.0 及以上 / 64 位 ARM，包名 `com.genzo.android`。
- versionName `0.5.2`，versionCode `5002`；Release / 非 debuggable，R8 与资源收缩开启。
- 文件大小：74,936,537 字节（约 71.5 MiB）。SHA-256：`0ec1456354f755d827e5acb27e28c6bb703d950623d22827e9574f6f19c4af05`。
- 固定发布签名证书 SHA-256：`cee90e5f49edc18217ec2d1f7cdf360f50b61af1e99e4eefdb0837b549c13cdb`（与 v0.5.1 相同）。签名私钥与密码文件只在仓库外的本机签名目录保存，不纳入源码、APK 或发行附件。
- 发布附件仅 APK 与 `SHA256SUMS.txt`；截图、日志、样本与中间调试包不分发。

## 本轮内容

自 v0.5.1 以来的用户可见变化（含已提交提交 `d97f60f` / `74ee68d` 与工作树中尚未提交的验收轮次）：

- 严重崩溃修复：修复「下载一话 → 退出 → 重新进入详情 → 点章节」即闪退的问题。根因是启动界面品牌化把 `<application>` 主题改成了 `Theme.genzo.Starting`（`parent="Theme.SplashScreen"`，非 AppCompat），导致 `ReaderActivity`（`AppCompatActivity`）继承到非 AppCompat 主题，任何一次打开阅读器都启动即崩，与是否下载无关。修复为 core-splashscreen 标准写法：`<application>` 恢复 `@style/Theme.genzo`，`Theme.genzo.Starting` 只挂在启动 `MainActivity`；品牌启动屏行为不变。
- 评论面板：漫画与轻小说作品评论统一为同一原生底部面板（标题 / 来源 / 时间 / 展开全文 / 分页 / 返回顶部 / 关闭，系统返回优先关闭）；无来源关联时如实说明，不伪造评论、不声称站点级排序。
- 启动页选择：我的 → 通用新增「进入程序首界面」，可在 首页 / 媒体库 / 书架 / 发现 / 我的 之间选择冷启动落点，持久化保存、下次启动生效。
- 启动界面品牌化：新增品牌原生启动屏（字标居中于应用底色），深浅色自动适配，消除冷启动纯白帧。
- 阅读器交互：章节「目录」由白底系统弹窗改为主题化底部弹层；「阅读设置」界面按分组卡片重排并限制为部分高度、修复拖拽卡死、自动滚动详细设置按需展开。
- 阅读器阅读：漫画滚动模式支持跨话连续阅读与章间操作条（目录 / 本话评论 / 下一话状态）；轻小说工具栏恢复进度条并保留百分比与拖动跳转。
- 阅读器外观：漫画工具栏改为图标按钮，修复底部导航区漏出，新增工具栏呼出 / 收起过渡动画。
- 轻小说详情「继续阅读」并入漫画同款右下角浮动胶囊入口，两种类型形态一致。
- 封面：轻小说封面按原始比例展示、不再裁切；漫画 / 轻小说作品详情封面消除留白；首页「书籍」封面条与动漫 / 漫画对齐。
- 布局：书架 / 媒体库 / 发现网格在窄屏恢复三列；书架漫画 ↔ 轻小说分区切换加入过渡动画。
- 底层性能（v0.5.1 内核延续）：漫画当前页优先、渐进整话预取、话末准备下一话前 6 张、在途复用与及时取消、Kira 适配、Bangumi 封面 / 分类 / 评论缓存。

## 验证

| 项目 | 结果与边界 |
| --- | --- |
| TypeScript / 前端 | 类型检查通过，23 文件 / 96 项单元测试通过。Android 生产前端约 414 kB JS（gzip 126 kB），仅入口 / CSS / 图标资源；不含原型页面与 mock 作品文本。 |
| Android 构建 | arm64 Rust release / Kotlin release / R8 / lintVital / 资源收缩通过；使用固定签名生成正式 APK。 |
| APK 元数据 | aapt 确认包名 `com.genzo.android` / 5002 / 0.5.2 / min26 / target36 / arm64-v8a / Genzo 标签；`application` 主题恢复为 AppCompat 基主题、`MainActivity` 单独使用启动主题（崩溃修复已入包）。 |
| 签名与对齐 | apksigner 验证通过，签名证书 SHA-256 `cee90e5f…13cdb`；16 KiB ZIP 对齐检查通过。 |
| 实体机正式包 | 一加 PLK110 / Android 16 以 `install -r` 覆盖安装成功（同签名，保留普通包数据），versionName 0.5.2 / 5002，冷启动进入首页正常（继续观看 / 动画 / 书籍 / 电影分区渲染，无 FATAL）。 |
| 各轮回归 | 崩溃修复的完整用户路径、评论面板、启动页、章节目录弹层、阅读设置、连续跨话、封面与网格等改动，均在此前同内核 / 同代码的独立 QA 包（`com.genzo.android.readerqa`）上按实体机截图 / CDP 断言验收，详见 `docs/android/FRONTEND_PREVIEW.md`。这些是独立包证据，不冒充正式包全套自动化。 |

尚未覆盖所有厂商 / Android 版本、真实 16 KiB 页设备和所有外网服务。首次未缓存内容仍受网络影响；Bangumi 账号同步与 Kazumi 规则播放未实现。正式包关闭 CDP 与 QA 控制入口，测试数据与测试状态不发布。

## 升级与构建

- 本版沿用 v0.5.1 固定签名证书，普通包 `com.genzo.android` 可 `install -r` 覆盖升级并保留数据。
- `com.genzo.android.readerqa` 独立测试包与正式包数据不同，本版不将其数据打入普通包；早期普通调试原型签名不同，不能直接覆盖，也不自动卸载旧包丢弃数据。
- 本机使用 `./scripts/build-android-release.ps1`；签名目录须提供已有 `genzo-release.p12` 与 `store-password.txt`，脚本不自动更换签名。
- 构建过程中生成的 QA APK 只用来编译共享优化内核，不安装、不发布；最终正式包使用 Release / 普通包名 / 固定发布签名。版本字段与生成的 Android 版本同步（`package.json` / `Cargo.toml` / `tauri.conf.json` / `tauri.properties` 均为 0.5.2 / 5002）。
- 本次正式包由当前工作树（含尚未提交的验收轮次）直接打包；发布 / 提交状态以 `codex/android-first` 分支 Git 状态为准。
