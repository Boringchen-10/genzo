import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/common";
import { ScanPage } from "./ScanPage";

export function LibrarySourcesPage() {
  return (
    <div className="page workspace-page page-library-sources">
      <Link className="sources-back" to="/library"><ArrowLeft size={15} />返回媒体库</Link>
      <PageHeader
        title="媒体源与扫描"
        description="管理本地文件夹并查看最近扫描结果；删除目录配置只会移除 Genzo 中的记录，不会改动磁盘上的文件。"
      />
      <ScanPage />
    </div>
  );
}
