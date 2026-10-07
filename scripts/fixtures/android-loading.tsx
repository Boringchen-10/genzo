import { createRoot } from "react-dom/client";
import AndroidApp from "../../src/android/AndroidApp";
import { api, bookApi } from "../../src/api";
import { androidApi } from "../../src/android/api";
import { comicExploreApi } from "../../src/comicExplore";
import { bookContentApi } from "../../src/bookContent";
import { androidSession, READING_NETWORK_CHANGED } from "../../src/android/sessionCache";
import type { WorkListItem } from "../../src/types";

// Isolated frame: all invoked reads below are fixtures; no native media or account writes.
const calls: Record<string, number> = {};
const started = performance.now();
const qa = window as unknown as { __QA_FAIL_SOURCE__?: boolean; __QA_LOADING__: { calls: typeof calls; firstCoverMs: number | null; changeReadingSource: () => void } };
const delay = async <T,>(key: string, value: T, ms = 80): Promise<T> => {
  calls[key] = (calls[key] ?? 0) + 1;
  await new Promise(resolve => setTimeout(resolve, ms));
  return value;
};
const work: WorkListItem = { id: "qa-book", title: "QA启动作品", originalTitle: null, type: "comic", category: "comic", description: "测试简介", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", createdAt: "2026-10-07", updatedAt: "2026-10-07", metadataStatus: "manually_created", metadataYear: null, lastRecognizedAt: null, tags: [], mediaCount: 0, missingCount: 0 };
const item = { pathWord: "qa-book", title: "QA启动作品", coverUrl: null, authors: ["测试作者"], tags: ["测试标签"], summary: "完整测试资料", status: "连载中", updatedAt: "2026-10-07", latestChapter: "214", localWorkId: "qa-book", favorite: false };
api.listWorks = () => delay("works", [work]);
api.listUnassignedGroups = () => delay("groups", [], 900);
api.getSetting = () => Promise.resolve("dark");
api.getWork = () => delay("work", { ...work, tags: [], mediaFiles: [], metadata: null, fieldLocks: [], candidates: [], subtitleLinks: [] });
bookApi.entries = () => delay("localEntries", []);
androidApi.sources = async () => { const value = await delay("sources", [], 1200); if (qa.__QA_FAIL_SOURCE__) throw new Error("测试来源暂时离线"); return value; };
androidApi.tasks = () => delay("tasks", [], 1600);
androidApi.progress = () => delay("progress", { items: [], sessions: [] }, 2200);
androidApi.appearance = () => Promise.resolve();
api.animePopular = () => delay("popular", { items: [], page: 1, pageSize: 24, totalPages: 0, hasMore: false, stale: false }, 300);
api.weeklyCalendar = () => delay("calendar", { days: [], sourceVersion: "qa", generatedAt: "2026-10-07", stale: false }, 300);
comicExploreApi.home = () => delay("comicHome", { sections: [{ section: "recommended", period: null, audience: null, items: [{ item, rank: null, popularity: null, rankPopularity: null }], total: 1, supportsPaging: false }], stale: false }, 300);
comicExploreApi.detail = () => delay("bookDetail", { item, aliases: [], chapterCount: 214, stale: false }, 200);
comicExploreApi.comments = () => delay("comments", { items: [], total: 0, offset: 0, limit: 10 }, 200);
bookContentApi.source = () => delay("readingSource", { kind: "comic", pathWord: "qa-book" });
bookContentApi.entries = (_kind, _book, group = "", offset = 0) => {
  const id = group || "default";
  const total = id === "default" ? 214 : 20;
  return delay(`chapters:${id}:${offset}`, { total, offset, group: id, groups: [{ id: "default", title: "默认" }, { id: "volume", title: "单行本" }], entries: Array.from({ length: Math.min(100, total - offset) }, (_, index) => ({ id: `${id}-${offset + index + 1}`, title: `第${offset + index + 1}话`, order: offset + index + 1, count: 20 })), stale: false }, 200);
};
bookContentApi.cached = () => Promise.resolve([]);
qa.__QA_LOADING__ = { calls, firstCoverMs: null, changeReadingSource: () => { androidSession.invalidate("reading:"); window.dispatchEvent(new Event(READING_NETWORK_CHANGED)); } };
const observer = new MutationObserver(() => {
  if (document.querySelector(".gz-cover")) { qa.__QA_LOADING__.firstCoverMs = performance.now() - started; observer.disconnect(); }
});
observer.observe(document.body, { childList: true, subtree: true });
document.documentElement.dataset.platform = "android";
document.documentElement.dataset.theme = "dark";
createRoot(document.getElementById("root")!).render(<AndroidApp />);
