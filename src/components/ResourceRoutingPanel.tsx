import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api as tauriApi } from "../api";
import { dataProvider } from "../data";
import type { ResourceDestination, UnassignedMediaGroup } from "../types";
import { getErrorMessage, mediaLabels } from "../utils";
import "../resource-library.css";

export function ResourceRoutingPanel() {
  const [groups, setGroups] = useState<UnassignedMediaGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const [nextGroups, roots] = await Promise.all([dataProvider.listUnassignedGroups(), dataProvider.listRoots()]);
      const rootIds = new Set(roots.map(root => root.id));
      setGroups(nextGroups.filter(group => group.representative.libraryRootId !== null && rootIds.has(group.representative.libraryRootId)));
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadGroups(); }, [loadGroups]);

  const route = async (group: UnassignedMediaGroup, destination: ResourceDestination) => {
    if (group.destination === destination) return;
    setBusyKey(group.key);
    try {
      await tauriApi.setResourceGroupDestination(group.representative.id, destination);
      setGroups(current => current.map(item => item.key === group.key ? { ...item, destination } : item));
      setError("");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusyKey(null); }
  };
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    return groups.filter(group => !needle || `${group.title} ${group.folderPath ?? group.representative.path}`.toLocaleLowerCase("zh-CN").includes(needle));
  }, [groups, search]);
  const mediaCount = groups.filter(group => group.destination === "media").length;
  const bookCount = groups.length - mediaCount;

  return <section className="resource-routing" aria-label="扫描文件分流">
    <div className="resource-routing-head">
      <div><h2>扫描文件分流</h2><p>按文件格式默认进入媒体库或书架的待整理区。需要时可逐组改选，真实文件不会移动。</p></div>
      <button type="button" className="button compact secondary" onClick={() => void loadGroups()} disabled={loading}>{loading ? "读取中…" : "刷新列表"}</button>
    </div>
    <div className="resource-routing-tools">
      <span>媒体库 {mediaCount} 组 · 书架 {bookCount} 组</span>
      <input aria-label="搜索待整理文件组" placeholder="搜索文件组或路径" value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    {error ? <p role="alert" className="gnz-inline-error">{error}</p> : null}
    {!isTauri() ? <p className="quiet-inline">示例模式仅展示分流结果；在桌面应用中可改选目标。</p> : null}
    {visible.length ? <div className="resource-routing-list">
      {visible.slice(0, 100).map(group => <div className="resource-routing-row" key={group.key}>
        <div><strong>{group.title}</strong><small title={group.folderPath ?? group.representative.path}>{mediaLabels[group.mediaType]} · {group.fileCount} 个文件 · {group.folderPath ?? group.representative.path}</small></div>
        <label>待整理去向<select aria-label={`${group.title}的待整理去向`} value={group.destination} disabled={!isTauri() || busyKey !== null} onChange={event => void route(group, event.target.value as ResourceDestination)}>
          <option value="media">媒体库</option>
          <option value="bookshelf" disabled={group.mediaType !== "comic" && group.mediaType !== "novel"}>书架</option>
        </select></label>
      </div>)}
      {visible.length > 100 ? <p className="quiet-inline">仅显示前 100 组，请搜索定位其余文件组。</p> : null}
    </div> : <p className="quiet-inline">{loading ? "正在读取待整理文件组…" : "没有符合条件的待整理文件组。"}</p>}
  </section>;
}
