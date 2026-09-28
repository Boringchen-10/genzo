import { useState } from "react";
import { PageHeader } from "../components/common";
import { LibraryMaintenance } from "../components/LibraryMaintenance";
import { ScanPage } from "./ScanPage";
import "../resource-library.css";

export function ResourceLibraryPage() {
  const [revision, setRevision] = useState(0);
  return <div className="page workspace-page page-resources">
    <PageHeader title="资源库" description="统一管理本地、挂载和远程目录；扫描只建立文件索引。" actions={<LibraryMaintenance onChanged={() => setRevision(value => value + 1)} />} />
    <ScanPage key={revision} />
  </div>;
}
