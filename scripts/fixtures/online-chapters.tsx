import { useState } from "react";
import { createRoot } from "react-dom/client";
import OnlineChapters from "../../src/android/OnlineChapters";
import { bookContentApi } from "../../src/bookContent";

// Isolated UI fixture: no native calls or media downloads.
const entries = [1, 2, 3].map(order => ({ id: `qa-${order}`, title: `测试第${order}话`, order, count: 1 }));
const calls: string[] = [];
let fail = true;
bookContentApi.entries = async () => ({ entries, total: 3, group: "default", groups: [{ id: "default", title: "默认" }], offset: 0, stale: false });
bookContentApi.cached = async () => [];
bookContentApi.cache = async (_kind, _book, id) => {
  calls.push(id);
  if (fail && calls.length === 2) throw new Error("测试连接中断");
  return { entryId: id, title: id, format: "cbz", bytes: 1, cachedAt: "now" };
};
function Fixture() {
  const [selecting, setSelecting] = useState(true);
  const [toast, setToast] = useState("");
  return <div className="android-app"><OnlineChapters kind="comic" pathWord="qa" selecting={selecting} onSelecting={setSelecting} onRead={() => { throw new Error("Selecting must not open the reader"); }} onToast={setToast} /><p role="status">{toast}</p><button onClick={() => { fail = false; }}>允许重试</button><output>{calls.join(",")}</output></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
