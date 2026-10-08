import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { BookOpen } from "lucide-react";
import { IMAGE_RETRY_EVENT } from "../imageRecovery";
import { ResilientImage } from "../components/ResilientImage";
import { createAnimeCoverCache } from "./animeCoverCache";

const posters = createAnimeCoverCache((id, url) => invoke<string>("cache_anime_explore_cover", { externalId: id, coverUrl: url }).then(path => convertFileSrc(path)));

/** Visible posters use the same native Bangumi transport as metadata, including its CDN support. */
export default function AnimeCover({ id, url }: { id: string; url?: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  const remote = !!url && /^https?:/.test(url) && !url.startsWith("http://asset.localhost/");
  const key = JSON.stringify([id, url]);
  const [image, setImage] = useState({ key, src: remote ? undefined : url });
  useEffect(() => {
    let disposed = false, visible = false, started = false, failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setImage({ key, src: remote ? undefined : url });
    const fetch = () => {
      if (!remote || !url || started || !visible) return;
      started = true;
      void posters.load(id, url, () => visible && !disposed).then(src => { if (!disposed) setImage({ key, src }); })
        .catch((error: Error) => {
          started = false;
          if (error.message === "poster left viewport") { if (visible && !disposed) fetch(); }
          else if (!disposed && visible && failures++ < 1) retryTimer = setTimeout(fetch, 200);
        });
    };
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) fetch(); posters.pump(); }, { rootMargin: "120px" });
    if (holder.current) observer.observe(holder.current);
    const retry = () => { failures = 0; fetch(); };
    window.addEventListener("online", retry);
    window.addEventListener(IMAGE_RETRY_EVENT, retry);
    return () => { disposed = true; clearTimeout(retryTimer); observer.disconnect(); posters.pump(); window.removeEventListener("online", retry); window.removeEventListener(IMAGE_RETRY_EVENT, retry); };
  }, [key, remote, id, url]);
  return <span ref={holder} style={{ display: "block", width: "100%", height: "100%" }}>
    <ResilientImage sources={[image.key === key ? image.src : remote ? undefined : url]} fallback={<BookOpen size={24} />} />
  </span>;
}
