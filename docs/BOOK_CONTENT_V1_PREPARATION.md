# 漫画与轻小说来源内容 V1

日期：2026-10-05。开发分支 codex/book-content-v1，基于桌面 / 同步 a86f94e。文件名保留以兼容准备阶段引用；本次用户已确认漫画、轻小说一起完成，状态以验证记录为准。

## 使用

1. 在真实桌面客户端启动 pnpm dev:desktop；单独 pnpm dev 是浏览器预览，没有 Rust 文件与阅读器能力。
2. 探索 → 漫画 / 轻小说。搜索作品，按题材 / 热度 / 更新筛选；底部点击展开。漫画保留完结 / 韩漫 / 美漫目录。
3. 点击作品进入详情。漫画选择章节分组并展开章节；小说显示来源完整分卷目录。加入书架后在书架详情继续使用同一来源目录，即使随后补充 Bangumi 资料，来源 ID 仍保留。
4. 对有权访问的章卷点击获取，完成后点击打开。工具中心配置对应漫画 / 小说的默认外部阅读器，或配置系统 CBZ / EPUB 文件关联。打开不自动更新已读状态；外部软件阅读位置不回传。
5. 更多菜单提供打开缓存目录、重新获取和清除此章卷缓存。小说缓存同时含 EPUB、UTF-8 TXT 与章节目录快照；EPUB 按原始目录加入独立插图，未知条目保留原位置并显示提示。

## 能力 / IPC

| Command | 输入 | 结果 |
| --- | --- | --- |
| list_novel_explore / get_novel_explore_themes | ComicQuery / 无 | 独立书籍目录、搜索、题材；Comic DTO 只复用字段形状 |
| get_novel_explore_detail / save_novel_explore_work | pathWord、refresh / favorite | 小说详情 / 本地 Work ID |
| get_book_reading_source | workId | kind + pathWord，或无来源 |
| get_book_source_entries | kind、pathWord、group、offset、refresh | entries、total、offset、group、groups、stale |
| list_cached_book_content | kind、pathWord、entryIds | 完整文件存在的缓存摘要；打开前另做 SHA-256 验证 |
| cache_book_source_content | kind、pathWord、entryId、group、refresh | 完整缓存摘要；失败保留旧版 |
| open_cached_book_content | kind、pathWord、entryId、folder | 启动默认阅读器 / 系统关联，或打开缓存目录 |
| clear_cached_book_content | kind、pathWord、entryId | 仅删除当前生成缓存，不操作作品 / 用户媒体 |

kind 仅 comic / novel；来源作品、章卷 ID 限 ASCII 字母数字、下划线和连字符。前端不能传任意打开路径、shell 命令或下载 URL。所有失败返回真实错误，未连接后端不能展示成功。

## 数据与缓存

- 小说 copynovel、漫画 copymanga 分开保存到既有 work_external_ids，来源标识而非标题去重。加入操作使用既有事务，重复加入保留收藏、笔记、个人评分和现有 Work ID；不新增数据库迁移，不更改用户的文件关联与卷册排序。
- 缓存位于应用私有 reading-cache/v1/<kind+作品+章卷 SHA256>/complete-<时间>-<UUID>。pending 临时目录不公开为成功；文件、SHA-256 清单与目录完全匹配才可打开。刷新产生新不可变快照，失败 / 重启保留旧完整快照；缓存不存在或损坏时明确要求重新获取。
- 同一章卷请求互斥并复用已完成结果，最多两个章卷同时获取。目录漫画每批 100 项，小说验证完整列表；重复或错作品 ID 拒绝。正文获取重新读取访问资料，不缓存临时签名 URL、不向图片 / TXT CDN 发送账号凭据、Cookie 或来源 API 请求头，不自动跟随重定向。
- 仅支持 HTTPS *.mangafunb.fun 内容地址、JPEG / PNG / WebP 图片、UTF-8 / GBK（含 GB2312 / CP936）文本。整卷文本上限 32 MiB，单图 20 MiB，单章卷输入 / 展开内容上限 512 MiB、漫画最多 1000 页；超限或 HTML 错误页失败，不静默生成乱码 / 缺页。
- 严格按零基半开区间 [start_lines,end_lines) 取小说章节，保留空行、CRLF / LF / CR 分隔及原始目录索引；TXT 与同版本 TOC 一起保存。插图不猜测段内位置。
- 没有自动后台全站下载或正文缓存自动淘汰，旧刷新版本保留供故障回退；需要释放空间时在更多菜单清除该章卷，外部阅读器正在占用时 Windows 可能拒绝，关闭阅读器后重试。
- 正文、路径、缓存和来源凭据不纳入影视个人同步 V1；不会把打开当作已读，也不会改写真实 EPUB / 漫画文件。

## 来源与限制

接口契约参考 Kira 固定提交 [8a7b3f0](https://github.com/caolib/kira/tree/8a7b3f060ef521f0cbeda719bf0931e9af5ed89e) 的 manga_api.dart、novel_api.dart、novel_text.dart 与章节 / 小说模型，MIT 声明见 THIRD_PARTY_NOTICES.md。Genzo 独立实现 Rust 核心与 React 界面，不启动 Kira。

当前只接匿名可访问内容；账号登录、会员、手机绑定等限制遵循来源响应，不绕过。第三方客户端接口并非官方开放 API，兼容性可能变化，代码许可也不代表作品授权。内置阅读器、来源账号、自动外部阅读进度、全站下载、正文分享和 Android 实机阅读未交付。

实际验证与未验证项见 [BOOK_CONTENT_V1_VALIDATION.md](BOOK_CONTENT_V1_VALIDATION.md)。v0.5.0 正式标签 / 附件保持不变。
