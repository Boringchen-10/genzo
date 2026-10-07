import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { bookContentApi, type OnlineContent, type ReadingKind } from "../bookContent";
import LoadingIndicator from "./LoadingIndicator";

type ReaderImageProps = { url: string; alt: string };

function ReaderImage({ url, alt }: ReaderImageProps) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void bookContentApi.image(url).then(data => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([data]));
      setSource(objectUrl);
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attempt, url]);
  if (error) return <div className="gz-reader-error"><span>图片读取失败：{error}</span><button type="button" className="gz-btn" onClick={() => { setError(""); setSource(null); setAttempt(value => value + 1); }}>重试</button></div>;
  if (!source) return <span className="gz-reader-image-loading"><LoaderCircle className="gz-spin" size={20} /></span>;
  return <img src={source} alt={alt} loading="lazy" />;
}

export default function BookReader({ kind, pathWord, entryId, group, onClose }: {
  kind: ReadingKind;
  pathWord: string;
  entryId: string;
  group: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<OnlineContent | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState("loading"); setError(""); setContent(null);
    void bookContentApi.online(kind, pathWord, entryId, group).then(value => {
      if (active) { setContent(value); setState("ready"); }
    }).catch(reason => {
      if (active) { setError(String(reason)); setState("error"); }
    });
    return () => { active = false; };
  }, [attempt, entryId, group, kind, pathWord]);
  return <div className="gz-reader" role="dialog" aria-modal="true" aria-label="在线阅读器">
    <header className="gz-reader-head">
      <button type="button" className="gz-iconbtn" aria-label="返回章节列表" onClick={onClose}><ArrowLeft size={20} /></button>
      <strong className="gz-reader-title">{content?.title ?? "在线阅读"}</strong>
      <span className="gz-reader-kind"><BookOpen size={15} />{kind === "comic" ? "漫画" : "轻小说"}</span>
    </header>
    {state === "loading" && <LoadingIndicator label="正在读取正文…" />}
    {state === "error" && <div className="gz-reader-empty"><p>{error || "正文读取失败。"}</p><button type="button" className="gz-btn" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />重试</button></div>}
    {state === "ready" && content && kind === "comic" && <div className="gz-reader-pages">{content.pages.map((url, index) => <ReaderImage key={url} url={url} alt={`第 ${index + 1} 页`} />)}</div>}
    {state === "ready" && content && kind === "novel" && <div className="gz-reader-sections">{content.sections.map((section, index) => <article className="gz-reader-section" key={`${section.title}-${index}`}>
      <h2>{section.title}</h2>
      {section.text && <p>{section.text}</p>}
      {section.imageUrl && <ReaderImage url={section.imageUrl} alt={section.title} />}
    </article>)}</div>}
  </div>;
}
