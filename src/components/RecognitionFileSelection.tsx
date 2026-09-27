import type { MediaFile } from "../types";
import { selectionGroups, toggleFiles } from "../recognitionSelection";
import "../recognition-organizer.css";

export function RecognitionFileSelection({ files, selected, onChange, disabled = false }: {
  files: MediaFile[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  return <div className="recognition-selection">
    <div className="recognition-selection-tools">
      <button className="button secondary compact" type="button" disabled={disabled} onClick={() => onChange(files.map(file => file.id))}>全选文件</button>
      <button className="button secondary compact" type="button" disabled={disabled} onClick={() => onChange([])}>清空选择</button>
      <span>{selected.length} / {files.length} 个文件 · 未勾选的保留原归属</span>
    </div>
    {selectionGroups(files).map(group => {
      const count = group.files.filter(file => selected.includes(file.id)).length;
      return <section className="recognition-selection-group" key={group.key}>
        <label className="recognition-selection-heading"><input type="checkbox" disabled={disabled} checked={count === group.files.length} ref={node => { if (node) node.indeterminate = count > 0 && count < group.files.length; }} onChange={event => onChange(toggleFiles(selected, group.files.map(file => file.id), event.target.checked))} />{group.label} · {count} / {group.files.length}</label>
        <div className="recognition-selection-files">{group.files.map(file => <label className="recognition-member" key={file.id}>
          <input type="checkbox" checked={selected.includes(file.id)} disabled={disabled} onChange={event => onChange(toggleFiles(selected, [file.id], event.target.checked))} />
          <span><strong>{file.fileName}</strong><small title={file.path}>{file.path}{file.missing ? " · 文件缺失" : ""}</small></span>
        </label>)}</div>
      </section>;
    })}
  </div>;
}
