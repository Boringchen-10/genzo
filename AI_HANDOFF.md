# Codex 与 DeepSeek Harness 项目交接记录

> 最近核对：2026-09-24。本文按实际代码、Git 状态和测试结果整理；交接时仍须重新检查代码与状态。

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
