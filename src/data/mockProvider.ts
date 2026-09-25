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
  AnimeCharacter,
  AnimeCredit,
  AnimeEpisodeEntry,
  AnimeSeasonOption,
  AnimeWorkStructure,
  AppInfo,
  Dashboard,
  ExploreOverview,
  ExploreSaveInput,
  ExploreSubject,
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

const mediaFile = (
  id: string,
  workId: string | null,
  fileName: string,
  episode: string | null,
  overrides: Partial<MediaFile> = {},
): MediaFile => ({
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
  ...overrides,
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

interface MockExploreSeed {
  externalId: string;
  title: string;
  originalTitle: string | null;
  aliases: string[];
  description: string;
  coverUrl: string | null;
  year: number | null;
  month: number | null;
  airDate: string | null;
  broadcast: string | null;
  subjectType: ExploreSubject["subjectType"];
  genres: string[];
  score: number | null;
  rank: number | null;
  ratingCount: number;
  collectionCount: number;
}

/* 示例条目：标题显式带「示例」，让预览不会被误当成真实 Bangumi 条目。
   封面复用仓库内自制占位图（`public/design/`），不发起任何网络请求。 */
const EXPLORE_SEEDS: MockExploreSeed[] = [
  {
    externalId: "900001",
    title: "示例 · 星海邮差",
    originalTitle: "Sample Stardust Courier",
    aliases: ["星海邮差（示例）"],
    description: "示例简介：设计期 Mock 不请求 Bangumi 接口，正式运行时会显示真实条目简介。",
    coverUrl: "/design/reference-primary.png",
    year: 2026,
    month: 9,
    airDate: "2026-09-06",
    broadcast: "每周日 22:00",
    subjectType: "tv",
    genres: ["科幻", "冒险"],
    score: 7.8,
    rank: 1284,
    ratingCount: 2310,
    collectionCount: 8120,
  },
  {
    externalId: "900002",
    title: "示例 · 雨声与机械城",
    originalTitle: null,
    aliases: [],
    description: "示例简介：用于演示无原文标题、无别名时的界面表现。",
    coverUrl: "/design/reference-secondary.png",
    year: 2026,
    month: 9,
    airDate: "2026-09-12",
    broadcast: "每周五 21:30",
    subjectType: "web",
    genres: ["日常", "治愈"],
    score: null,
    rank: null,
    ratingCount: 0,
    collectionCount: 0,
  },
  {
    externalId: "900003",
    title: "示例 · 第七码头的夏天",
    originalTitle: "Sample Summer at Pier Seven",
    aliases: ["第七码头（示例）"],
    description: "示例简介：用于演示无封面时回退到 Genzo 自制占位封面。",
    coverUrl: null,
    year: 2026,
    month: 10,
    airDate: "2026-10-03",
    broadcast: null,
    subjectType: "tv",
    genres: ["悬疑", "奇幻"],
    score: 8.1,
    rank: 402,
    ratingCount: 5870,
    collectionCount: 15240,
  },
  {
    externalId: "900004",
    title: "示例 · 群青观测站",
    originalTitle: "Sample Ultramarine Observatory",
    aliases: [],
    description: "示例简介：用于演示剧场版类型与暂无评分的空状态。",
    coverUrl: null,
    year: 2026,
    month: 10,
    airDate: null,
    broadcast: null,
    subjectType: "movie",
    genres: ["科幻"],
    score: null,
    rank: null,
    ratingCount: 0,
    collectionCount: 940,
  },
];

/* 设计期内存状态：演示加入媒体库后的本地标记，刷新即丢失。 */
const exploreLocal = new Map<string, { workId: string; status: WorkListItem["status"]; favorite: boolean }>();

const toExploreSubject = (seed: MockExploreSeed): ExploreSubject => {
  const local = exploreLocal.get(seed.externalId);
  return {
    provider: "bangumi",
    externalId: seed.externalId,
    title: seed.title,
    originalTitle: seed.originalTitle,
    aliases: [...seed.aliases],
    description: seed.description,
    coverUrl: seed.coverUrl,
    year: seed.year,
    month: seed.month,
    airDate: seed.airDate,
    broadcast: seed.broadcast,
    subjectType: seed.subjectType,
    genres: [...seed.genres],
    score: seed.score,
    rank: seed.rank,
    ratingCount: seed.ratingCount,
    collectionCount: seed.collectionCount,
    inLibrary: local !== undefined,
    favorite: local?.favorite ?? false,
    localWorkId: local?.workId ?? null,
    localStatus: local?.status ?? null,
    fetchedAt: now,
    stale: false,
  };
};

const requireExploreSeed = (externalId: string): MockExploreSeed => {
  const seed = EXPLORE_SEEDS.find((item) => item.externalId === externalId);
  if (!seed) throw new Error(`示例数据中不存在探索条目：${externalId}`);
  return seed;
};

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

/* ---------------- 动画详情结构（示例数据） ----------------
   仅用于设计验证：分集、关联作品、制作人员与角色都显式标注「示例」，
   不代表任何真实 Bangumi 数据；缩略图一律返回 null（Mock 不伪造视频帧）。 */

const EPISODE_COUNT = 12;

interface MockEpisodeSeed {
  title: string;
  description: string;
}

/* 只有前两集给出示例标题，其余留空：用于演示「没有标题时回退为『第 N 集』」。 */
const EPISODE_SEEDS: MockEpisodeSeed[] = [
  { title: "（示例）旅途的起点", description: "示例分集简介：Mock 环境未连接 Bangumi，分集信息为演示数据。" },
  { title: "（示例）别离之前", description: "" },
];

const EPISODE_AIR_DATES = [
  "2023-09-29",
  "2023-10-06",
  "2023-10-13",
  "2023-10-20",
  "2023-10-27",
  "2023-11-03",
];

/** 每部作品的分集外部 ID：`setMediaEpisode` 的目标就是它。 */
const structureEpisodeId = (workId: string, number: number): string => `mock-bgm-${workId}-ep-${number}`;

/** 本地文件 → 分集的手动映射（`null` = 显式解除映射，回到未匹配）。刷新即丢失。 */
const episodeMappings = new Map<string, string | null>();

/** 元数据刷新的示例标记：只用于证明「刷新后有新内容可读」，不冒充真实刮削结果。 */
const REFRESH_MARK = "（示例：本段由「刷新元数据」在 Mock 中重新读取，未连接 Bangumi。）";

const mockAnimeStructure = (workId: string): AnimeWorkStructure => {
  const work = requireWork(workId);
  const bangumiId = `mock-bgm-${workId}`;
  if (work.type !== "video") {
    return {
      workId,
      bangumiId,
      seasons: [],
      episodes: [],
      unmatchedFiles: [],
      staff: [],
      characters: [],
      warnings: ["示例环境：该作品不是视频类型，因此没有动画分集结构。"],
    };
  }

  const pool: MediaFile[] = [
    mediaFile(`file-${workId}-01a`, workId, `${work.title} - 01 [1080p][HEVC].mkv`, "1", {
      parsedMediaInfo: "1080p · HEVC · FLAC",
      size: 1_450_000_000,
    }),
    mediaFile(`file-${workId}-01b`, workId, `${work.title} - 01 [720p].mkv`, "1", {
      parsedMediaInfo: "720p · AVC",
      size: 620_000_000,
    }),
    mediaFile(`file-${workId}-02`, workId, `${work.title} - 02 [1080p][HEVC].mkv`, "2", {
      parsedMediaInfo: "1080p · HEVC",
      missing: true,
      size: 1_410_000_000,
    }),
    mediaFile(`file-${workId}-03`, workId, `${work.title} - 03 [1080p][HEVC].mkv`, "3", {
      parsedMediaInfo: "1080p · HEVC",
      size: 1_390_000_000,
    }),
    mediaFile(`file-${workId}-extra1`, workId, `未命名视频 A.mkv`, null, { parsedMediaInfo: "1080p" }),
    mediaFile(`file-${workId}-extra2`, workId, `未命名视频 B.mkv`, null, { parsedMediaInfo: "1080p" }),
  ];

  const episodes: AnimeEpisodeEntry[] = Array.from({ length: EPISODE_COUNT }, (_unused, index) => {
    const number = index + 1;
    const seed = EPISODE_SEEDS[index];
    return {
      provider: "bangumi",
      externalId: structureEpisodeId(workId, number),
      episodeNumber: number,
      sortNumber: number,
      episodeType: 0,
      title: seed?.title ?? "",
      originalTitle: null,
      description: seed?.description ?? "",
      airDate: EPISODE_AIR_DATES[index] ?? null,
      duration: EPISODE_AIR_DATES[index] ? "24 分钟" : null,
      fetchedAt: now,
      localFiles: [],
    };
  });

  const assigned = new Map<string, MediaFile[]>();
  const unmatchedFiles: MediaFile[] = [];
  for (const file of pool) {
    /* 手动映射优先；否则按解析到的集数归位；都对不上就是未匹配。 */
    const target = episodeMappings.has(file.id)
      ? episodeMappings.get(file.id) ?? null
      : file.parsedEpisode
        ? structureEpisodeId(workId, Number(file.parsedEpisode))
        : null;
    if (!target) {
      unmatchedFiles.push(file);
      continue;
    }
    const list = assigned.get(target) ?? [];
    list.push(file);
    assigned.set(target, list);
  }
  for (const episode of episodes) episode.localFiles = assigned.get(episode.externalId) ?? [];

  const seasons: AnimeSeasonOption[] = [
    {
      externalId: bangumiId,
      title: work.title,
      originalTitle: work.originalTitle,
      relation: "当前作品",
      seasonNumber: 1,
      coverUrl: work.coverPath,
      localWorkId: workId,
      current: true,
    },
    {
      externalId: `${bangumiId}-s2`,
      title: `${work.title}（示例续作）`,
      originalTitle: null,
      relation: "续集",
      seasonNumber: 2,
      coverUrl: null,
      localWorkId: null,
      current: false,
    },
    {
      externalId: `${bangumiId}-movie`,
      title: `${work.title}（示例剧场版）`,
      originalTitle: null,
      relation: "剧场版",
      seasonNumber: null,
      coverUrl: null,
      localWorkId: null,
      current: false,
    },
  ];

  const staff: AnimeCredit[] = [
    { externalId: `${bangumiId}-staff-1`, name: "（示例）原作担当", role: "原作", imageUrl: null },
    { externalId: `${bangumiId}-staff-2`, name: "（示例）系列构成", role: "系列构成", imageUrl: null },
  ];

  const characters: AnimeCharacter[] = [
    { externalId: `${bangumiId}-char-1`, name: "（示例）主角", role: "主角", imageUrl: null, actors: ["（示例）声优 A"] },
    { externalId: `${bangumiId}-char-2`, name: "（示例）同伴", role: "配角", imageUrl: null, actors: [] },
  ];

  return {
    workId,
    bangumiId,
    seasons,
    episodes,
    unmatchedFiles,
    staff,
    characters,
    warnings: ["示例环境：分集、关联作品、制作人员与角色均为 Mock 数据，未连接 Bangumi。"],
  };
};

/* 排行榜专用示例条目：`rank` 与 `score` 均为示例值，用于演示分页、排序与空状态。 */
const RANKING_SEEDS: MockExploreSeed[] = [
  { externalId: "910001", title: "示例 · 星海邮差", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: "/design/reference-primary.png", year: 2024, month: 4, airDate: "2024-04-05", broadcast: null, subjectType: "tv", genres: ["科幻", "冒险"], score: 9.1, rank: 1, ratingCount: 18240, collectionCount: 42190 },
  { externalId: "910002", title: "示例 · 雨声与机械城", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: "/design/reference-secondary.png", year: 2023, month: 10, airDate: "2023-10-02", broadcast: null, subjectType: "tv", genres: ["日常", "治愈"], score: 9.0, rank: 2, ratingCount: 16510, collectionCount: 38720 },
  { externalId: "910003", title: "示例 · 第七码头的夏天", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2022, month: 7, airDate: "2022-07-09", broadcast: null, subjectType: "tv", genres: ["悬疑", "青春"], score: 8.9, rank: 3, ratingCount: 15020, collectionCount: 33140 },
  { externalId: "910004", title: "示例 · 群青观测站", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2021, month: 1, airDate: "2021-01-08", broadcast: null, subjectType: "tv", genres: ["科幻"], score: 8.8, rank: 4, ratingCount: 14110, collectionCount: 30980 },
  { externalId: "910005", title: "示例 · 无声的编年史", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2020, month: 10, airDate: "2020-10-04", broadcast: null, subjectType: "tv", genres: ["奇幻", "冒险"], score: 8.7, rank: 5, ratingCount: 13040, collectionCount: 28610 },
  { externalId: "910006", title: "示例 · 纸鸢与长夜", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2019, month: 7, airDate: "2019-07-07", broadcast: null, subjectType: "tv", genres: ["剧情"], score: 8.6, rank: 6, ratingCount: 12010, collectionCount: 26240 },
  { externalId: "910007", title: "示例 · 玻璃温室", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2018, month: 4, airDate: "2018-04-06", broadcast: null, subjectType: "tv", genres: ["治愈", "日常"], score: 8.5, rank: 7, ratingCount: 11520, collectionCount: 24810 },
  { externalId: "910008", title: "示例 · 远雷", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2017, month: 1, airDate: "2017-01-11", broadcast: null, subjectType: "tv", genres: ["战争", "剧情"], score: 8.4, rank: 8, ratingCount: 10980, collectionCount: 22760 },
  { externalId: "910009", title: "示例 · 银盐时代", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2016, month: 10, airDate: "2016-10-01", broadcast: null, subjectType: "tv", genres: ["校园"], score: 8.3, rank: 9, ratingCount: 10240, collectionCount: 21030 },
  { externalId: "910010", title: "示例 · 候鸟航线", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2015, month: 7, airDate: "2015-07-05", broadcast: null, subjectType: "tv", genres: ["冒险"], score: 8.2, rank: 10, ratingCount: 9680, collectionCount: 19540 },
  { externalId: "910011", title: "示例 · 雪国来信", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2014, month: 4, airDate: "2014-04-03", broadcast: null, subjectType: "tv", genres: ["剧情", "治愈"], score: 8.1, rank: 11, ratingCount: 9110, collectionCount: 18220 },
  { externalId: "910012", title: "示例 · 灯塔守夜人", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2013, month: 1, airDate: "2013-01-10", broadcast: null, subjectType: "tv", genres: ["悬疑"], score: 8.0, rank: 12, ratingCount: 8540, collectionCount: 16980 },
  { externalId: "910013", title: "示例 · 夏日回声", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2012, month: 7, airDate: "2012-07-02", broadcast: null, subjectType: "tv", genres: ["青春"], score: 7.9, rank: 13, ratingCount: 8020, collectionCount: 15610 },
  { externalId: "910014", title: "示例 · 折线之城", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2011, month: 4, airDate: "2011-04-08", broadcast: null, subjectType: "tv", genres: ["科幻"], score: 7.8, rank: 14, ratingCount: 7480, collectionCount: 14230 },
  { externalId: "910015", title: "示例 · 静海列车", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2010, month: 1, airDate: "2010-01-07", broadcast: null, subjectType: "tv", genres: ["剧情"], score: 7.7, rank: 15, ratingCount: 6910, collectionCount: 12940 },
  { externalId: "910016", title: "示例 · 残响之森", originalTitle: null, aliases: [], description: "示例简介。", coverUrl: null, year: 2009, month: 10, airDate: "2009-10-01", broadcast: null, subjectType: "tv", genres: ["奇幻"], score: 7.6, rank: 16, ratingCount: 6240, collectionCount: 11520 },
];

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
        fileCount: 2,
        missingCount: 0,
        totalSize: 14_400_000_000,
        recognitionStatus: "unmatched",
        representative: mediaFile("media-1", null, "S01E01.mkv", "1"),
      };
      return [group];
    },
    async listRecognitionGroupMembers(_mediaFileId, groupScope = "season") {
      return {
        scope: groupScope,
        title: "未知作品（示例）",
        folderPath: "H:\\Media\\未整理\\示例目录",
        members: [mediaFile("media-1", null, "S01E01.mkv", "1"), mediaFile("media-2", null, "S01E02.mkv", "2")],
        linkedWorkId: null,
        linkedWorkTitle: null,
      };
    },
    async attachMedia() {
      /* 设计期：内存演示，不涉及真实关联 */
    },
    async attachMediaFiles() {
      return notImplemented("attachMediaFiles");
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

    async recognizeMedia(mediaFileId, query, kind = "anime") {
      if (kind !== "anime") throw new Error("电影与电视剧识别需要在 Genzo 桌面端运行，并配置 TMDB 凭据；浏览器预览不会执行真实刮削。");
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
    async recognizeUnmatched(kind = "anime") {
      if (kind !== "anime") throw new Error("电影与电视剧批量识别需要在 Genzo 桌面端运行。");
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

    async exploreOverview(year, month) {
      const today = new Date(now);
      const resolvedYear = year ?? today.getUTCFullYear();
      const resolvedMonth = month ?? today.getUTCMonth() + 1;
      if (resolvedYear < 1900 || resolvedYear > 2200) {
        throw new Error("探索年份必须在 1900 到 2200 之间");
      }
      if (resolvedMonth < 1 || resolvedMonth > 12) {
        throw new Error("探索月份必须在 1 到 12 之间");
      }
      const seasonal = EXPLORE_SEEDS
        .filter((seed) => seed.month === resolvedMonth)
        .map(toExploreSubject);
      const trending = [...EXPLORE_SEEDS]
        .sort((left, right) => right.ratingCount - left.ratingCount)
        .slice(0, 12)
        .map(toExploreSubject);
      const availableTags = Array.from(
        new Set([...seasonal, ...trending].flatMap((item) => item.genres)),
      ).sort((left, right) => left.localeCompare(right, "zh-CN"));
      const overview: ExploreOverview = {
        year: resolvedYear,
        month: resolvedMonth,
        seasonal,
        trending,
        availableTags,
        sources: [
          {
            key: "bangumi-data",
            label: "bangumi-data 番组索引（示例）",
            available: true,
            stale: false,
            fetchedAt: now,
            warning: null,
          },
          {
            key: "bangumi",
            label: "Bangumi 官方 API（示例）",
            available: true,
            stale: false,
            fetchedAt: now,
            warning: null,
          },
        ],
        fetchedAt: now,
        stale: false,
      };
      return overview;
    },
    async searchExplore(query) {
      const trimmed = query.trim();
      if (!trimmed) throw new Error("探索搜索词不能为空");
      if (trimmed.length > 200) throw new Error("探索搜索词不能超过 200 个字符");
      const normalized = trimmed.toLocaleLowerCase("zh-CN");
      return EXPLORE_SEEDS
        .filter((seed) => [seed.title, seed.originalTitle ?? "", ...seed.aliases]
          .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized)))
        .map(toExploreSubject);
    },
    async getExploreSubject(externalId) {
      return toExploreSubject(requireExploreSeed(externalId));
    },
    async saveExploreSubject(input) {
      const seed = requireExploreSeed(input.externalId);
      const existing = exploreLocal.get(input.externalId);
      const workId = existing?.workId ?? `mock-explore-work-${exploreLocal.size + 1}`;
      exploreLocal.set(input.externalId, { workId, status: input.status, favorite: input.favorite });
      const current = works.get(workId);
      const linked: WorkListItem = current
        ? { ...current, status: input.status, favorite: input.favorite, updatedAt: now }
        : {
            id: workId,
            title: seed.title,
            originalTitle: seed.originalTitle,
            type: "video",
            description: seed.description,
            coverPath: null,
            status: input.status,
            favorite: input.favorite,
            rating: null,
            notes: "示例：由探索页加入（未写入后端）",
            createdAt: now,
            updatedAt: now,
            metadataStatus: "matched",
            metadataYear: seed.year,
            lastRecognizedAt: now,
            tags: [...seed.genres],
            mediaCount: 0,
            missingCount: 0,
          };
      works.set(workId, linked);
      return workId;
    },

    async getAnimeWorkStructure(workId) {
      return clone(mockAnimeStructure(workId));
    },
    async refreshWorkMetadata(workId) {
      const work = requireWork(workId);
      const tags = work.tags.includes("元数据已刷新（示例）") ? work.tags : [...work.tags, "元数据已刷新（示例）"];
      const description = work.description.includes(REFRESH_MARK) ? work.description : `${work.description}${REFRESH_MARK}`;
      works.set(workId, { ...work, tags, description, metadataStatus: "matched", lastRecognizedAt: now, updatedAt: now });
      return clone(mockAnimeStructure(workId));
    },
    async setMediaEpisode(mediaFileId, episodeExternalId) {
      /* 设计期：只更新内存映射，用于验证「重新读取结构后文件换组」；不写入后端。 */
      episodeMappings.set(mediaFileId, episodeExternalId);
    },
    async getMediaThumbnail() {
      /* Mock 不伪造视频帧：一律返回 null，由 UI 渲染无缩略图状态。 */
      return null;
    },
    async animeRanking(page = 1, pageSize = 50) {
      if (!Number.isInteger(page) || page < 1) throw new Error("排行榜页码必须是从 1 开始的整数");
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new Error("排行榜每页数量必须是 1 到 100 之间的整数");
      }
      const sorted = [...RANKING_SEEDS].sort(
        (left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER),
      );
      const start = (page - 1) * pageSize;
      return clone(sorted.slice(start, start + pageSize).map(toExploreSubject));
    },
  };
}
