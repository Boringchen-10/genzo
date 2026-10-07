import { useLayoutEffect, useRef, useState } from "react";

export default function BookDescription({ text }: { text: string }) {
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    setExpanded(false);
    const node = paragraph.current;
    if (!node) return;
    const measure = () => setOverflow(node.scrollHeight > parseFloat(getComputedStyle(node).lineHeight) * 3 + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);
  return <div className="gz-book-description">
    <p ref={paragraph} className={`gz-description${expanded ? "" : " gz-book-description-clamped"}`}>{text || "暂无作品简介。"}</p>
    {overflow && <button type="button" className="gz-link" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起简介" : "展开简介"}</button>}
  </div>;
}
