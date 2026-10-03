import { ScanPage } from "./ScanPage";

/**
 * 资源库：媒体源的一级入口。
 *
 * 媒体源（本地文件夹 / 挂载目录 / WebDAV）不再是「媒体库」里的标签页，而是侧栏的一级
 * 页面——它同时为「媒体库」（影视）与「书架」（阅读物）提供内容。这里原样复用既有的
 * `ScanPage`（来源列表、扫描任务、扫描记录），与它在「媒体库 · 媒体源」标签页里的界面
 * 完全一致；不新增后端命令、字段或迁移。
 */
export function SourcesPage() {
  return (
    <div className="page workspace-page page-sources">
      <ScanPage />
    </div>
  );
}