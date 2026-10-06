# 漫画与轻小说内容 V1 验证

日期：2026-10-05。源码从 a86f94e 的独立 codex/book-content-v1 工作树开发，沿用 Tauri 2 / React / Rust / SQLite。当前为开发版增量，无正式 Release / 标签 / 新安装器，v0.5.0 不变。

## 已执行

| 验证 | 结果 |
| --- | --- |
| TypeScript / Vite 生产构建 | 通过；保留既有约 645 kB 主包体积提示，无构建错误 |
| 前端单元测试 | 76 项通过（新增目录拼接、重复 / 缺页 / 分组变化拒绝、小说路由隔离） |
| Windows Rust 回归 | 274 项通过、14 项既有外部环境测试忽略；没有数据库迁移改动 |
| 正文 / 包格式 | UTF-8 / GBK、BOM、混合换行 / 空行、目录区间、未知目录索引、XML 转义、EPUB mimetype / OPF / spine / nav / 插图、CBZ 页序通过 |
| 网络隔离服务 | 真实本机 HTTP 字节读取：认证失败、重定向拒绝、Content-Length 超限、chunked 超限、断传、重新请求成功；检查不发送来源认证 / Cookie / API headers |
| 完整缓存保护 | 临时目录不开放，错身份 / 损坏清单不开放，插图中断不写完整清单；新请求失败保持旧完整版本可用 |
| 小说加入书架 | SQL 事务与既有表，重复加入保留 ID / 笔记 / 评分 / 收藏；同源字符串的漫画与小说不混合 |
| 模拟 IPC 界面 | 漫画 / 小说获取、失败重试、缓存后打开、清理、顺序切换、更多菜单、展开列表返回；1024×640、1366×768、1920×1080 的深浅主题六种组合通过，无横向溢出 / 页面异常 |
| 漫画原有探索回归 | 三尺寸：查询 / 筛选、点击展开 / 重试、详情、书架 / Bangumi 入口、滚动恢复与浏览器前后退通过 |
| Windows 原生构建 | x86_64-pc-windows-msvc debug 可执行文件构建通过；只创建独立 QA 产物，未替换用户正在运行的 genzo.exe |
| 真实 Tauri IPC | 独立资料目录：漫画 / 小说来源身份、重复入库、完整缓存复用 / SHA-256 验证、结构化参数实际启动合成外部阅读器、打开不改状态、缓存清理保留作品 / 收藏通过 |
| 原生详情互切 | 验证发现旧作品使新详情路由回跳；已增加当前 route ID 与 Work ID 校验，漫画 / 小说书架详情互切及书架导航通过 |
| 实际来源元数据 | Rust IPC：小说详情、34 卷目录、漫画默认组 214 章及第二批目录读取通过；非正文下载验证 |

原生测试标识：com.genzo.desktop.book-content-qa-9c1522657569413ab5a71850d2910a22。应用启动后先验证 get_app_info.dataDirectory 的唯一 QA 名称；合成 SQLite / 章卷缓存 / 阅读器均在此独立目录，不在普通 Genzo 资料库中注入测试作品或凭据。未修改用户真实媒体。

## 可复跑

- 前端：pnpm check、pnpm test、pnpm build。
- Rust：cargo test --manifest-path src-tauri/Cargo.toml --lib。
- Vite preview 监听 127.0.0.1:4187 后运行 scripts/check-book-content.mjs 和 scripts/check-comic-explore.mjs；可用 GENZO_TEST_URL 改测试地址。
- 原生：创建全新 com.genzo.desktop.book-content-qa-<32 位 UUID> 配置，devUrl 指向测试前端、additionalBrowserArgs 指定 CDP 9237；独立 target 编译、首次启动后关闭，再用 scripts/book-content-native-fixture.py <独立资料目录> 写合成夹具。重新启动后 scripts/check-book-content-native.mjs 校验真实 IPC；中断后的合成夹具才使用 --resume，脚本拒绝普通资料目录及非合成库。
- 本轮记录 / 截图位于工作树 artifacts/book-content（忽略，不上传真实数据）；原生合成正文不属于第三方作品。

## 边界与日常验收

- 未下载实际第三方漫画页面或小说 TXT / 插图。合成 HTTP / 格式 / 原生缓存测试证明代码链路；实际来源元数据通过不等于所有作品、章节和账号权限下的正文均已可访问。用户可在有权访问的作品中点获取验收，受限 / 失效接口保留旧缓存并报错。
- 只支持匿名访问，没有 COPY / HOT 账号登录、会员绑定或权限绕过；API 不属于官方稳定契约，HTTP / 锁定 / 缺少内容及不支持的 CDN 地址均明确失败。
- 实际用户的外部阅读器、长篇超大文件、完整 EPUBCheck 和 Android ABI / 真机尚未验证；Windows 已实测结构化启动合成阅读器和路径存在。系统没有 CBZ / EPUB 关联时在工具中心配置阅读器。
- 不内置阅读器，不采样外部阅读器页码，不把打开当作已读；影视 WebDAV 同步协议不包含阅读正文 / 缓存。
- 本次无新增迁移；旧库升级 / ID / 个人记录保留由既有迁移回归及新增合成库入库测试覆盖，不重建或替换用户数据库。
