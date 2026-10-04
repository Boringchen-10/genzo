# 个人 WebDAV 同步 V1 验证与测试版使用

2026-10-04，本轮按用户“先实现第一版 WebDAV”交付共享协议、Rust 核心、Windows 验证入口和部署准备。不是正式版发布，也不代表 Android 应用接入或两端实机验收完成。

## 源码与产物

- 分支：`codex/personal-sync-v1`，基于主目录 `a38a9e36c19a9182b8534db54f78d6b06977acd4`；独立托管工作树 `C:/Users/Administrator/.codex/worktrees/personal-sync-v1/二次元阅读器`。主目录及 Android 工作树的未提交修改均保留，未合入本轮。
- 协议初始提交：`27a1113`；共享核心初始提交：`9dde815`；Windows 接入：`1fb1eb8`。IPC 错误和 Android 夹具修复 `07fb891`、JSON 数值等价修复 `d10c551` 必须一起获取。
- **测试安装包源码**：`d10c551e203b600e9529ce1d6ab3f584dad0baca`。其后的部署/验收文档不改变此包内代码。核心接入以这一提交或本分支后续提交为准。
- 安装包：`H:/二次元阅读器/artifacts/sync-v1/0.6.0-alpha.1/Genzo Sync Test_0.6.0-alpha.1_x64-setup.exe`，225,561,621 字节。
- SHA-256：`c5835b73314005c504bf5b01c98c7332a200d66aa23eae51952fdb0b02da35f1`。同目录有 `SHA256SUMS.txt`、`build-manifest.json`、原生验证结果与三尺寸截图；这些生成文件不提交 Git。
- 编译 EXE SHA-256：`b8bbc98ec3ed5ede8fa435757b5a4dffe2ab824b4d505c75af9a3f919ffd74ec`；安装 EXE：`eb3a01c428eb23499e2f4909d90706fe030d582a12ee8a8e3aab62ed5baa4032`。逐字节比较只有 Tauri NSIS 的 UNK→NSS 三字节打包标记不同。
- 应用 ID `com.genzo.desktop.sync-test`，产品名 `Genzo Sync Test`，版本 `0.6.0-alpha.1`；Windows x64 NSIS，WebView2 x64 离线运行时随包，未签名。正式 `v0.5.0` 标签、源码、安装包和 Release 未覆盖。

## 已运行检查

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| TypeScript、Vite 生产构建 | 通过 | 既有大 chunk 提示保留 |
| 前端单测 | 73 通过 | 包括真实 Tauri 字符串错误转换回归 |
| 共享 Rust 核心 | 15 通过 | 3 个协议测试、12 个 SQLite/隔离网络集成测试 |
| Windows Rust 回归 | 264 通过、14 忽略 | 忽略项为既有外部运行环境测试，不能算通过 |
| v0.5.0 存量磁盘库升级 | 通过 | 新增 0026、再次打开、原作品/文件关联/ID/收藏/评分/笔记/锁定/标签/观看与书籍记录保留；1–24 迁移不改写 |
| Windows x64 NSIS | 构建成功 | 来自上述源码；安装 EXE 与构建产物逐字节核对 |
| 实际 Windows 安装/启动/重装 | 通过 | 安装与卸载退出 0，真实 WebView2/Tauri/SQLite/凭据管理器；重装前待传 3 条与资料保留，升级后重试归零 |
| 原生同步流程 | 通过 | 错误认证、能力探测、创建、另一协议设备修改收藏、两份并发笔记、合写、重复同步及未保存草稿保护 |
| 三种 Windows 视口 | 通过 | 实际 WebView2 的 CDP 1280×800、1440×900、1920×1080；抽屉无水平溢出，已查看小/大尺寸截图；不冒称物理窗口拖动验证 |
| Android 原生核心交叉编译 | 通过 | `x86_64-linux-android` 单测及集成测试 `--no-run` 编译成功；没有执行测试或接入 APK |

共享核心测试覆盖：强锚点独立建库去重及本机 ID/路径保留；同名无锚点不合并；空设备加入不清空远端；离线字段合并与笔记冲突/解决；删除对旧离线修改优先、来源离线不视作删除；成功上传但响应丢失/认证失效仍保留待传；重复同步/重启恢复；事务回滚不上传；首次创建失败与创建竞争；弱/过期 ETag 和不支持条件写拒绝；不兼容协议不改写；人工字段锁定与私人图片保护；观看会话倒退/重看、同版本续播和不同版本拒绝。

测试只使用合成数据库/作品/文件和本机隔离服务，未读写用户真实媒体与正式数据目录。原生 UI 的“另一设备”是协议兼容的测试客户端，不是 Android 应用。测试结束后备份合成库与截图到工作树 `artifacts/sync-v1`，关闭并卸载本轮测试实例、移走合成测试资料目录、移除对应测试凭据和停止隔离服务。正式版资料与凭据未清理。

## 安装与试用

1. 关闭正在运行的 Genzo，双击测试 `.exe`。NSIS 会处理同名进程；测试版为单独产品和数据目录，普通用户不需要 Node/Rust/Android Studio。
2. 首次启动使用空的独立资料库，位于 `%APPDATA%\com.genzo.desktop.sync-test`。通过资源库扫描/识别少量自己的影视作品进行测试，原始文件不上传或改动。切勿将已升级的测试数据库复制回旧正式版。
3. 有自己的 HTTPS WebDAV 服务时，为同步选择专用可写目录，在“设置 → 个人同步”填写 URL、账号和密码，先测试连接。服务必须正确支持强 ETag 和条件写；测试失败不能强行覆盖远端。账号密码只存 Windows 凭据管理器。
4. 第一台“创建同步空间”，另一台“加入同步空间”；首次加入先读并合并。空库加入会拉取远端作品，但本机仍需独立关联媒体才可播放。两台不能复制一个已经连接的设备数据库来冒充不同设备。
5. 收藏、标签、个人资料/笔记修改后可立即同步，或启用自动同步；暂停时仍保留待传。并发笔记在面板保留双方，可选择一份或合写。更新密码后可重试，失败不会清空待传。
6. 跨设备续播前，两端须同一公共作品/分集，Windows 面板选择对应本地媒体并计算完整 SHA-256；大视频可能耗时。只有同字节版本才应用续播，未确认版本仍保存会话。需要新一次真实播放采样来产生带版本的会话；历史未绑定会话不反向推测版本。

本轮验证界面不支持切换已绑定空间、恢复永久删除、重绑主锚点或手动选择观看会话；相关错误会停止同步并保留待传。协议允许 `manual:<UUID>`，但未交付手工跨端版本绑定入口。书架、探索和外部工具继续使用原有实现，书籍/游戏资料不参与 V1 同步。单文档上限 16 MiB，保留操作历史和删除记录，尚不提供压缩。

测试版配置有本机 WebView2 调试端口，仅供验证，不作为正式版本配置。正式 OpenDesign 界面尚未接入。需要测试现有正式库时，应先关闭两个程序、保留完整正式数据目录备份，只向独立测试目录复制副本；本轮没有替用户执行该操作。

## 可复现的开发检查

```powershell
node node_modules/typescript/bin/tsc -b
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
cargo test --locked --manifest-path crates/genzo-sync/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
node node_modules/@tauri-apps/cli/tauri.js build --config src-tauri/tauri.sync-test.conf.json --bundles nsis -- --locked

# 仅本机隔离验证服务，固定 u/p 为公开测试凭据；绝不部署到公网
python scripts/sync-isolated-dav.py --port 18485 --directory artifacts/sync-v1/isolated-dav
# 启动独立 Sync Test 产品且数据目录为全新合成测试库后，在另一终端运行
node scripts/sync-windows-smoke.mjs
```

`--resume` 只用于本文所述中断合成夹具，不能用于普通已连接资料库。脚本会核对测试数据目录，合成作品不混入用户库。运行后的输出在忽略目录中。

## 未验证与下一步

- 阿里云真实服务器、域名、HTTPS、已有端口及备份恢复未核对/部署。本机无 Docker，Apache/Caddy 容器启动与配置校验没有运行；[部署文件](../deploy/webdav/README.md) 是待审阅准备，客户端隔离验证不能替代生产验收。
- Android 已有 SAF/Keystore 的分支只读检查；未接入共享核心、未运行 APK，也未完成电脑整理手机可见、收藏/笔记双向及同版本续播的两端验收。接入顺序见 [Android 指南](SYNC_ANDROID_INTEGRATION_V1.md)。
- 已有 PotPlayer 真实采样链路已接入核心并经过 Rust 回归，但本轮未启动真实 PotPlayer 播放媒体；跨端续播仍需实机验收。未确认版本的分集已看/会话详情展示和手动会话选择等待正式设计接入。
- 干净 Windows 10/11 无 WebView2 的离线安装、SmartScreen、人工完整安装向导未验证；测试包未签名。当前系统有 WebView2，不能把安装成功当作缺失运行时验收。
- 启动 Android 模拟器的操作被自动审批拒绝，未返回具体原因，没有绕过或重试启动；仅交付 Android 目标编译结果。

下一阶段先在实际 WebDAV HTTPS 服务完成能力/并发/断网/备份恢复验收，再让 Android 用同一协议与核心接入并联调，最后接入 OpenDesign 界面和正式发布配置。
