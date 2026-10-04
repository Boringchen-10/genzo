# Genzo 贡献与版本管理

## 提交原则

- 每个功能更新、Bug 修复或独立维护任务使用一个范围清晰的原子提交。
- 提交前运行与改动风险相称的检查，不提交未验证的构建产物、数据库、测试媒体或本地工具。
- 不覆盖或夹带他人的未提交修改；确实相互依赖时，在提交说明中明确记录。
- `main` 保持可构建、可测试。较大工作使用功能分支和 Pull Request，紧凑且已验证的本地修改可以直接提交到 `main`。

提交信息采用 Conventional Commits：

```text
feat(library): add metadata candidate confirmation
fix(scanner): preserve missing-file state after rescan
docs: clarify external player setup
test(matcher): cover ambiguous title candidates
refactor(db): isolate metadata cache queries
build: update Tauri packaging configuration
chore: refresh development tooling
```

允许的主要类型为 `feat`、`fix`、`docs`、`test`、`refactor`、`build`、`perf`、`style`、`ci`、`revert` 和 `chore`。

## 版本规则

Genzo 使用 Semantic Versioning，版本格式为 `MAJOR.MINOR.PATCH`：

- `PATCH`：向后兼容的 Bug 修复，例如 `0.2.0` 到 `0.2.1`。
- `MINOR`：向后兼容的新功能，例如 `0.2.1` 到 `0.3.0`。
- `MAJOR`：不兼容的公开接口、数据格式或产品行为变更。

开发提交不要求每次都修改应用版本号。只有形成正式可分发版本时，才集中更新版本文件、变更日志并打标签。

## 发布流程

1. 确认工作区只包含本次发布内容。
2. 运行前端类型检查、测试与构建，以及 Rust 格式、测试和 Clippy 检查。
3. 同步更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本。
4. 将本版本用户可见变化写入 `CHANGELOG.md`，使用 `Added`、`Changed`、`Fixed`、`Security` 等分类。
5. 创建发布提交：`chore(release): vX.Y.Z`。
6. 创建带注释标签：`git tag -a vX.Y.Z -m "Genzo vX.Y.Z"`。
7. 将提交和标签推送到 GitHub；确认远程标签指向发布提交。

紧急 Bug 修复同样走完整流程，不跳过测试、变更日志或标签。

## 当前开发基线与本地文件

后续优化从 `main` 的 v0.5.0 发布基线继续；复核已发布安装包时使用 `v0.5.0` 标签。早期版本可通过 Git 历史取回，不在工作目录保留旧版源码副本，也不再使用 v0.1 / v0.2 的实施 Prompt。

- `src/`、`src-tauri/`、`public/` 和 `scripts/` 保存现行实现、资源及可重复运行的验证工具。
- 全部数据库迁移和 `migration_compat/` 继续保留，它们用于升级已有用户数据。
- `design/` 保存设计交付记录；应用以现行 React / Tauri 代码及 `DESIGN_DIRECTION.md` 为准，不运行旧 HTML 原型。
- `.tmp/`、`artifacts/`、`dist/`、`node_modules/` 和 Rust `target/` 是忽略目录。临时验证结束后清理旧快照和产物；保留当前发布安装包、校验信息及必要验证记录。
- 进行中草稿和私人数据库恢复资料须单独保留，不能因清理缓存而丢弃，也不上传到公共仓库。
