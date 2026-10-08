import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

type Work = { portableId: string; title: string; existing: string | null; ambiguous: boolean };
type File = { work: string; name: string; candidates: {id:string;fileName:string;path:string;workTitle:string|null}[] };
type Preview = { works: Work[]; files: File[]; reading:number; bookmarks:number };
export function PortableDataPanel({ connected = false }: { connected?: boolean }) {
  const [data, setData] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState<string[]>([]);
  const [bindings, setBindings] = useState<Record<number,string>>({});
  const [includeReading, setIncludeReading] = useState(false);
  const [overwriteReading, setOverwriteReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const android = document.documentElement.dataset.platform === "android";
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await operation(); } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const exportFile = async () => {
    if (android) {
      const result = await invoke<{status:string}>("export_personal_data_file");
      if (result.status === "saved") setMessage("资料包已保存，可传给其他设备导入。");
    } else {
      const path = await save({defaultPath:"Genzo-personal-data.json",filters:[{name:"Genzo 资料包",extensions:["json"]}]});
      if (path) { await invoke("save_personal_data_file",{path}); setMessage("资料包已保存。为保护已有文件，请使用新的文件名。"); }
    }
  };
  const selectFile = async () => {
    let text: string | undefined;
    if (android) {
      const result = await invoke<{status:string;data?:string}>("pick_personal_data_file");text = result.data;
    } else {
      const path = await open({multiple:false,filters:[{name:"Genzo 资料包",extensions:["json"]}]});
      if (typeof path === "string") text = await invoke<string>("read_personal_data_file",{path});
    }
    if (!text) return;
    await previewData(text);
  };
  const previewData = async (text: string) => {
    const result = await invoke<Preview>("preview_personal_data",{data:text});
    setData(text);setPreview(result);setSelected(result.works.filter(work=>!work.ambiguous).map(work=>work.portableId));setOverwrite([]);setBindings({});setIncludeReading(false);setOverwriteReading(false);
  };
  const importFile = async () => {
    const result = await invoke<{created:number;preserved:number;updated:number;matchedFiles:number;reading:number;bookmarks:number}>("import_personal_data",{
      data,choices:selected.map(portableId=>({portableId,overwriteExisting:overwrite.includes(portableId)})),
      bindings:Object.entries(bindings).filter(([index,id])=>!!id&&selected.includes(preview?.files[Number(index)]?.work||"")).map(([index,mediaFileId])=>({fileIndex:Number(index),mediaFileId})),
      includeReading,overwriteReading,
    });
    setMessage(`导入完成：新增 ${result.created} 部，保留本机记录 ${result.preserved} 部，更新 ${result.updated} 部，关联文件 ${result.matchedFiles} 个，阅读位置 ${result.reading} 条，书签 ${result.bookmarks} 条。`);
    setPreview(null);setData("");
  };
  return <section className="personal-sync-panel" aria-label="离线资料包">
    <h2>离线资料包</h2>
    <p>传递作品资料、个人记录、阅读位置 / 书签及文件匹配描述。媒体正文、设备路径和访问凭据保留在原设备。</p>
    <div className="sync-actions"><button className="button secondary" disabled={busy} onClick={()=>void run(exportFile)}>导出资料包</button><button className="button secondary" disabled={busy} onClick={()=>void run(selectFile)}>选择资料包并预览</button></div>
    {connected && <><p>也可通过 WebDAV 传递资料包：保存会替换空间内的上一份快照。其他设备读取后自行预览和选择导入，书籍 / 阅读位置按此方式共享。</p><div className="sync-actions"><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await invoke("publish_personal_data");setMessage("资料包已保存到 WebDAV，其他设备可读取并预览。");})}>保存资料包到 WebDAV</button><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await previewData(await invoke<string>("fetch_personal_data"));})}>读取 WebDAV 资料包并预览</button></div></>}
    {message && <p role="status">{message}</p>}
    {preview && <>
      {(preview.reading>0||preview.bookmarks>0)&&<>
        <label className="sync-check"><input type="checkbox" disabled={busy} checked={includeReading} onChange={event=>setIncludeReading(event.target.checked)}/>导入 {preview.reading} 条阅读位置和 {preview.bookmarks} 条书签（已有位置默认保留）</label>
        {includeReading&&<label className="sync-check"><input type="checkbox" disabled={busy} checked={overwriteReading} onChange={event=>setOverwriteReading(event.target.checked)}/>使用资料包替换已有阅读位置</label>}
      </>}
      <h3>选择作品</h3>
      {preview.works.map(work=><div key={work.portableId}>
        <label className="sync-check"><input type="checkbox" disabled={busy||work.ambiguous} checked={selected.includes(work.portableId)} onChange={event=>setSelected(items=>event.target.checked?[...items,work.portableId]:items.filter(id=>id!==work.portableId))}/>{work.title} · {work.ambiguous?"存在多个来源匹配，请先核对":work.existing?"保留本机个人记录":"新增作品"}</label>
        {work.existing && selected.includes(work.portableId) && <label className="sync-check"><input type="checkbox" disabled={busy} checked={overwrite.includes(work.portableId)} onChange={event=>setOverwrite(items=>event.target.checked?[...items,work.portableId]:items.filter(id=>id!==work.portableId))}/>使用资料包更新这部作品的资料与个人记录</label>}
      </div>)}
      {preview.files.length>0 && <><h3>确认本机文件匹配</h3><p>名称与大小仅提供候选。不会创建虚假文件；有歧义时请先查看自己的文件。</p>
        {preview.files.map((file,index)=><label className="field" key={index}>{file.name}<select disabled={busy||!selected.includes(file.work)} value={bindings[index]||""} onChange={event=>setBindings(items=>({...items,[index]:event.target.value}))}><option value="">不关联</option>{file.candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.path}{candidate.workTitle?` · 已归档：${candidate.workTitle}`:" · 未整理"}</option>)}</select></label>)}
      </>}
      <div className="sync-actions"><button className="button primary" disabled={busy||(selected.length===0&&!includeReading)} onClick={()=>void run(importFile)}>导入所选记录</button><button className="button secondary" disabled={busy} onClick={()=>{setPreview(null);setData("");}}>取消</button></div>
    </>}
  </section>;
}
