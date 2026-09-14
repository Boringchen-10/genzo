/**
 * Genzo 设计期 Mock Provider（明确标记，非真实后端）
 *
 * - 全部数据为固定 fixture，**不代表**任何真实后端能力。
 * - 只读操作返回带 `MOCK_NOTICE` 标记的示例数据；内存写操作仅用于演示交互，
 *   刷新即丢失。
 * - 触及系统/网络的操作（启动播放器、打开目录、导入封面、检测工具、打开数据目录）
 *   一律抛出 `ProviderNotImplementedError`，不伪造成功。
 * - 正式实现由 Codex 在 `tauriProvider.ts` 中完成。
 */
import type {
  AppInfo,
  Dashboard,
  ExternalTool,
  ExternalToolInput,
  LibraryRoot,
  MatchCandidate,
  MediaFile,
  RecognitionResult,
  RecognitionSummary,
  UnassignedMediaGroup,
  WorkDetail,
  WorkListItem,
} from "../types";
import { ProviderNotImplementedError, type GenzoDataProvider, type ProviderMeta } from "./provider";

export const MOCK_NOTICE = "示例数据（Mock Provider · 未接入后端）";

const META: ProviderMeta = { kind: "mock", label: MOCK_NOTICE, mock: true };

const now = "2026-09-14T13:42:00.000Z";

interface MockWorkSeed {
  id: string;
  title: string;
  originalTitle: string | null;
  type: WorkListItem["type"];
  description: string;
  status: WorkListItem["status"];
  favorite: boolean;
  rating: number | null;
  year: number | null;
  tags: string[];
  mediaCount: number;
  missingCount: number;
  notes: string;
}

const WORK_SEEDS: MockWorkSeed[] = [
  {
    id: "work-frieren",
    title: "葬送的芙莉莲",
    originalTitle: "葬送のフリーレン",
    type: "video",
    description:
      "打倒魔王之后，魔法使芙莉莲开始在漫长的时间中理解人类与告别。示例简介，不代表真实元数据。",
    status: "in_progress",
    favorite: true,
    rating: 9,
    year: 2023,
    tags: ["本地高清", "已匹配元数据", "奇幻", "冒险"],
    mediaCount: 28,
    missingCount: 0,
    notes: "",
  },
  {
    id: "work-blue-period",
    title: "蓝色时期",
    originalTitle: "ブルーピリオド",
    type: "video",
    description: "以美术升学为线索的青春故事。示例简介，不代表真实元数据。",
    status: "completed",
    favorite: true,
    rating: null,
    year: 2021,
    tags: ["本地高清", "奇幻", "冒险"],
    mediaCount: 12,
    missingCount: 1,
    notes: "",
  },
  {
    id: "work-abyss",
    title: "来自深渊",
    originalTitle: "メイドインアビス",
    type: "video",
    description: "越往下走，代价越清晰。示例简介，不代表真实元数据。",
    status: "in_progress",
    favorite: false,
    rating: 8,
    year: 2017,
    tags: ["已匹配元数据", "冒险"],
    mediaCount: 25,
    missingCount: 0,
    notes: "",
  },
  {
    id: "work-dungeon-meshi",
    title: "迷宫饭",
    originalTitle: "ダンジョン飯",
    type: "comic",
    description: "在迷宫里做饭的冒险漫画。示例简介，不代表真实元数据。",
    status: "in_progress",
    favorite: true,
    rating: null,
    year: 2024,
    tags: ["本地高清", "已匹配元数据", "奇幻"],
    mediaCount: 8,
    missingCount: 0,
    notes: "",
  },
  {
    id: "work-kafka",
    title: "海边的卡夫卡",
    originalTitle: "海辺のカフカ",
    type: "novel",
    description: "十五岁的少年离开东京，在四国一座私人图书馆里与命运相遇。示例简介。",
    status: "completed",
    favorite: true,
    rating: 9,
    year: 2002,
    tags: ["本地高清", "冒险"],
    mediaCount: 1,
    missingCount: 0,
    notes: "",
  },
  {
    id: "work-frontier",
    title: "边境回声",
    originalTitle: null,
    type: "game",
    description: "在废弃的边境据点里恢复信号。示例简介，不代表真实元数据。",
    status: "in_progress",
    favorite: false,
    rating: null,
    year: null,
    tags: ["已匹配元数据", "奇幻"],
    mediaCount: 1,
    missingCount: 0,
    notes: "",
  },
];

const works = new Map<string, WorkListItem>(
  WORK_SEEDS.map((seed) => [
    seed.id,
    {
      id: seed.id,
      title: seed.title,
      originalTitle: seed.originalTitle,
      type: seed.type,
      description: seed.description,
      coverPath: null,
      status: seed.status,
      favorite: seed.favorite,
      rating: seed.rating,
      notes: seed.notes,
      createdAt: now,
      updatedAt: now,
      metadataStatus: seed.tags.includes("已匹配元数据") ? "matched" : "unmatched",
      metadataYear: seed.year,
      lastRecognizedAt: now,
      tags: seed.tags,
      mediaCount: seed.mediaCount,
      missingCount: seed.missingCount,
    } satisfies WorkListItem,
  ]),
);

const mediaFile = (id: string, workId: string | null, fileName: string, episode: string | null): MediaFile => ({
  id,
  workId,
  libraryRootId: "root-local",
  path: `H:\\Media\\示例\\${fileName}`,
  fileName,
  extension: fileName.split(".").pop() ?? "",
  mediaType: "video",
  size: 1_200_000_000,
  modifiedAt: now,
  missing: false,
  createdAt: now,
  updatedAt: now,
  recognitionStatus: workId ? "matched" : "unmatched",
  parsedTitle: workId ? works.get(workId)?.title ?? null : null,
  parsedOriginalTitle: null,
  parsedSeason: 1,
  parsedEpisode: episode,
  parsedYear: null,
  parsedReleaseGroup: null,
  parsedSpecialType: null,
  parsedMediaInfo: "1080p",
  lastRecognizedAt: now,
  recognitionError: null,
});

const roots = new Map<string, LibraryRoot>([
  [
    "root-local",
    {
      id: "root-local",
      path: "H:\\Media\\动画",
      kind: "video",
      enabled: true,
      lastScannedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ],
]);

const tools = new Map<string, ExternalTool>([
  [
    "tool-mpv",
    {
      id: "tool-mpv",
      name: "mpv",
      executablePath: "C:\\Program Files\\mpv\\mpv.exe",
      supportedMediaTypes: ["video"],
      argumentsTemplate: "{path}",
      workingDirectory: null,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  [
    "tool-calibre",
    {
      id: "tool-calibre",
      name: "Calibre",
      executablePath: "C:\\Program Files\\Calibre\\ebook-viewer.exe",
      supportedMediaTypes: ["comic", "novel"],
      argumentsTemplate: "{path}",
      workingDirectory: null,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
]);

const settings = new Map<string, string>([
  ["theme", "system"],
  ["accentHue", "158"],
  ["glassBlur", "24"],
  ["cornerRadius", "8"],
]);

const toDetail = (item: WorkListItem): WorkDetail => ({
  ...item,
  mediaFiles: [],
  metadata: item.metadataStatus === "matched"
    ? {
        provider: "示例元数据",
        externalId: `mock-${item.id}`,
        title: item.title,
        originalTitle: item.originalTitle,
        year: item.metadataYear,
        coverUrl: null,
        fetchedAt: now,
      }
    : null,
  fieldLocks: [],
  candidates: [],
  subtitleLinks: [],
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const requireWork = (id: string): WorkListItem => {
  const work = works.get(id);
  if (!work) throw new Error(`示例数据中不存在作品：${id}`);
  return work;
};

const notImplemented = (operation: string): never => {
  throw new ProviderNotImplementedError(
    operation,
    "设计期 Mock 不模拟该系统操作；由 Codex 在 tauriProvider.ts 中接入真实后端",
  );
};

export function createMockProvider(): GenzoDataProvider {
  return {
    meta: META,

    async listWorks() {
      return clone([...works.values()]);
    },
    async getWork(id) {
      return toDetail(clone(requireWork(id)));
    },
    async createWork(input) {
      const id = `mock-work-${works.size + 1}`;
      const created: WorkListItem = {
        id,
        title: input.title,
        originalTitle: input.originalTitle,
        type: input.type,
        description: input.description,
        coverPath: input.coverPath,
        status: input.status,
        favorite: input.favorite,
        rating: input.rating,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
        metadataStatus: "manually_created",
        metadataYear: null,
        lastRecognizedAt: null,
        tags: [...input.tags],
        mediaCount: 0,
        missingCount: 0,
      };
      works.set(id, created);
      return toDetail(clone(created));
    },
    async createWorkFromMedia(mediaFileId, input) {
      const created = await this.createWork(input);
      const seed = mediaFile(mediaFileId, created.id, `${input.title}.mkv`, "1");
      return { ...created, mediaFiles: [seed] };
    },
    async updateWork(id, input) {
      const current = requireWork(id);
      const updated: WorkListItem = {
        ...current,
        title: input.title,
        originalTitle: input.originalTitle,
        type: input.type,
        description: input.description,
        coverPath: input.coverPath,
        status: input.status,
        favorite: input.favorite,
        rating: input.rating,
        notes: input.notes,
        tags: [...input.tags],
        updatedAt: now,
      };
      works.set(id, updated);
      return toDetail(clone(updated));
    },
    async deleteWork(id) {
      works.delete(id);
    },

    async listUnassignedMedia() {
      return [mediaFile("media-1", null, "S01E01.mkv", "1"), mediaFile("media-2", null, "S01E02.mkv", "2")];
    },
    async listUnassignedGroups() {
      const group: UnassignedMediaGroup = {
        key: "mock-group-1",
        title: "未知作品（示例）",
        folderPath: "H:\\Media\\未整理\\示例目录",
        mediaType: "video",
        fileCount: 12,
        missingCount: 0,
        totalSize: 14_400_000_000,
        recognitionStatus: "unmatched",
        representative: mediaFile("media-1", null, "S01E01.mkv", "1"),
      };
      return [group];
    },
    async attachMedia() {
      /* 设计期：内存演示，不涉及真实关联 */
    },
    async detachMedia() {
      /* 设计期：内存演示，不涉及真实关联 */
    },
    async importCover() {
      return notImplemented("importCover");
    },

    async listRoots() {
      return clone([...roots.values()]);
    },
    async addRoot(path, kind) {
      const id = `mock-root-${roots.size + 1}`;
      const root: LibraryRoot = { id, path, kind, enabled: true, lastScannedAt: null, createdAt: now, updatedAt: now };
      roots.set(id, root);
      return clone(root);
    },
    async updateRoot(id, kind, enabled) {
      const root = roots.get(id);
      if (root) roots.set(id, { ...root, kind, enabled, updatedAt: now });
    },
    async deleteRoot(id) {
      roots.delete(id);
    },
    async scanRoot(id) {
      return {
        id: `mock-scan-${Date.now()}`,
        libraryRootId: id,
        status: "completed" as const,
        discoveredCount: 142,
        addedCount: 128,
        updatedCount: 11,
        missingCount: 3,
        startedAt: now,
        finishedAt: now,
        errors: [],
      };
    },
    async listScanJobs() {
      return clone([]);
    },

    async listTools() {
      return clone([...tools.values()]);
    },
    async createTool(input: ExternalToolInput) {
      const id = `mock-tool-${tools.size + 1}`;
      const tool: ExternalTool = { id, createdAt: now, updatedAt: now, ...input };
      tools.set(id, tool);
      return clone(tool);
    },
    async updateTool(id, input) {
      const tool = tools.get(id);
      if (tool) tools.set(id, { ...tool, ...input, updatedAt: now });
    },
    async deleteTool(id) {
      tools.delete(id);
    },
    async detectTools() {
      return notImplemented("detectTools");
    },
    async testTool() {
      return notImplemented("testTool");
    },
    async launchMedia() {
      return notImplemented("launchMedia");
    },
    async openMediaDirectory() {
      return notImplemented("openMediaDirectory");
    },

    async dashboard() {
      const list = [...works.values()];
      const by = (type: WorkListItem["type"]) => list.filter((work) => work.type === type).length;
      const result: Dashboard = {
        totalWorks: list.length,
        videoCount: by("video"),
        comicCount: by("comic"),
        novelCount: by("novel"),
        gameCount: by("game"),
        otherCount: by("other"),
        favoriteCount: list.filter((work) => work.favorite).length,
        missingFileCount: list.reduce((sum, work) => sum + work.missingCount, 0),
        recentWorks: clone(list.slice(0, 3)),
        favoriteWorks: clone(list.filter((work) => work.favorite).slice(0, 3)),
        lastScan: null,
      };
      return result;
    },
    async appInfo() {
      const info: AppInfo = {
        version: "0.0.0-mock",
        databasePath: "（示例）未接入数据库",
        coverCachePath: "（示例）未接入封面缓存",
        dataDirectory: "（示例）未接入数据目录",
      };
      return info;
    },
    async openDataDirectory() {
      return notImplemented("openDataDirectory");
    },
    async getSetting(key) {
      return settings.get(key) ?? null;
    },
    async setSetting(key, value) {
      settings.set(key, value);
    },

    async recognizeMedia(mediaFileId, query) {
      const title = query?.trim() || "示例作品";
      const candidates: MatchCandidate[] = [
        {
          id: "candidate-1",
          mediaFileId,
          provider: "示例元数据",
          externalId: "mock-1",
          title,
          originalTitle: null,
          aliases: [],
          subjectType: "anime",
          year: 2023,
          season: 1,
          coverUrl: null,
          confidence: 0.93,
          matchReasons: ["标题一致", "年份一致"],
          createdAt: now,
        },
      ];
      const result: RecognitionResult = {
        mediaFileId,
        status: "candidate_pending",
        parsedTitle: title,
        candidates,
        error: null,
      };
      return result;
    },
    async recognizeUnmatched() {
      const summary: RecognitionSummary = { scanned: 12, matched: 8, pending: 3, unmatched: 1, errors: 0 };
      return summary;
    },
    async listMatchCandidates(mediaFileId) {
      const result = await this.recognizeMedia(mediaFileId);
      return result.candidates;
    },
    async confirmMatch(mediaFileId) {
      return `示例：已确认 ${mediaFileId} 的候选（未写入后端）`;
    },
    async cancelMatch() {
      /* 设计期：内存演示 */
    },
    async setFieldLock() {
      /* 设计期：内存演示 */
    },
  };
}
