# 动漫热度与漫画首页接口

2026-10-07。供 OpenDesign 接入现有安卓前端。实现位于 `src/api.ts`、`src/comicExplore.ts` 与 Rust 命令；不需单独服务器，不需新增数据库表。

## 已确认的产品行为

- 动漫「热门番组」对应 Bangumi 动画目录 `sort=trends` 的热度顺序。保留上游顺序，不在客户端按评分、排名或收藏人数重新排序。原 `animeRanking` / `get_anime_ranking` 仍表示评分排行榜，供 Windows 原功能使用。
- 漫画提供「推荐、排行榜、热门更新、全新上架、已完结」数据；排行榜拆为日榜、周榜、月榜。正式漫画首页布局、动效、更多入口由 OpenDesign 设计后接入。本轮不替换当前漫画页面。
- 请求只读取作品资料，不请求章节图片、正文或下载媒体；点击详情、加入书架与阅读继续使用现有独立接口。

## 动漫热门番组

```ts
import { api } from "../../api";
const first = await api.animePopular(1);
const refreshed = await api.animePopular(1, true);
// { items: ExploreSubject[], totalPages, page, pageSize: 24, hasMore, stale }
const hasMore = first.hasMore;
```

Tauri：`get_anime_popular({ page, refresh })`。页码从 1 开始（最大 10000），沿用上游固定每页 24 项。`totalPages` 是总页数，不是作品数量，前端不推算虚假作品总数。返回现有 `ExploreSubject`，包括来源 ID、标题、封面、题材、评分、评分排名、本地作品 ID、收藏状态、`stale`。`rank` 仍是评分排名，不是热度名次；该来源不返回数值热度。列表接口未提供的简介、播出日期不从文本猜测，详情仍按来源 ID 查询现有官方资料接口。

请求 `https://next.bgm.tv/p1/subjects?type=2&sort=trends&page=1`。这是 Bangumi 官网自己的 P1 接口，**不是具有 v0 公开规范保证的稳定接口**。v0 搜索 `heat` 表示累计收藏人数，无法准确替代图示网页热度。本轮实测 P1 与 `https://bgm.tv/anime/browser?sort=trends` 前几项一致；P1 的 `limit/offset` 会被忽略，必须用 `page`，响应 `total` 表示总页数。已核对第一页、第二页、最后一页及越界空页。

P1 始终访问官网，沿用 Bangumi 请求客户端的系统代理／直连设置；自定义 v0 镜像只负责详情、搜索和日历，不承诺转发 P1。镜像模式下 P1 仍直连官网。缓存按实际 P1 来源与页码分开，TTL 1 小时，独立于评分排行榜缓存。强制刷新失败或缓存过期且来源不可用时返回旧内容并标记 `stale=true`；无缓存则报错。不能用评分排名或当季列表替换后继续叫「热度」。

已接入动漫现有热门区域，保留卡片与筛选设计。标签筛选只针对已经载入的数据，不等同于 Bangumi 网站全库筛选。加载更多按 `hasMore` 停止。

官网列表使用独立的两秒请求限流，避免排在 v0 后台详情／补图队列之后。热度变化可能使相邻页出现重复项，按来源 ID 去重并保留先出现的位置；每页 24 项不等于追加后一定新增 24 张卡片。

Kazumi 参考核对：官方模式的热门列表使用 `/p1/trending/subjects?type=2&limit=24&offset=0`，按返回顺序追加并以 ID 去重，客户端没有评分／收藏人数再排序。本轮该趋势接口前五项与官网目录一致；两者分页和响应形状不同，不能混用 `page` 与 `offset`。Genzo 当前仍以用户确认的官网目录顺序为契约。

## 漫画首页

```ts
import { comicExploreApi } from "../../comicExplore";
const home = await comicExploreApi.home();
// { sections: ComicHomeSection[], stale: boolean }
const recommended = home.sections.find(s => s.section === "recommended");
const dayRank = home.sections.find(s => s.section === "ranking" && s.period === "day");
const hotUpdates = home.sections.find(s => s.section === "hotUpdates");
```

Tauri：`get_comic_explore_home({ refresh: false })`。一次读取 COPY `/api/v3/h5/homeIndex2?platform=3`，返回七组：

| `section` | `period` | 含义 | 更多分页 |
| --- | --- | --- | --- |
| `recommended` | `null` | 推荐 | 支持 |
| `ranking` | `day` | 日榜 | 支持 |
| `ranking` | `week` | 周榜 | 支持 |
| `ranking` | `month` | 月榜 | 支持 |
| `hotUpdates` | `null` | 原生热门更新 | 不支持 |
| `newArrivals` | `null` | 全新上架 | 支持 |
| `completed` | `null` | 已完结 | 支持 |

每组字段：`section`、`period`、`audience`、`items`、`total`、`supportsPaging`。首页榜单 `audience="male"`，与实测原生首页顺序一致；非榜单为 `null`。热门更新与全新上架的首页响应不提供全量数量，`total=null`，不能把首页条数当全量总数。热门更新本次实测为 12 项，数量可以随上游变化；尚无确认过的更多接口，只返回真实首页组，不用普通更新时间列表代替。

```ts
interface ComicFeedEntry {
  item: ComicItem;
  popularity: number | null;     // comic.popular，来源返回的作品热度
  rankPopularity: number | null; // 榜单行 popular，榜单快照热度；其他组为 null
  rank: number | null;           // 榜单行 sort；其他组为 null
}
```

`ComicItem` 沿用现有类型：`pathWord`、`title`、`coverUrl`、`cachedCoverPath`、`cachedCoverThumbnailPath`、`authors`、`tags`、`summary`、`status`、`updatedAt`、`latestChapter`、`localWorkId`、`favorite`。热度保留来源原值；榜单快照值与作品当前值可能不同，不解释为评分或榜期内新增阅读人数。首页数据不齐的字段为空，不伪造简介或完结状态；「已完结」归属由分组表示。章节名不替代作品标题。卡片详情继续使用 `comicExploreApi.detail(entry.item.pathWord)`。

封面显示优先本地缓存路径并使用 `convertFileSrc`，再回退 `coverUrl`，可复用当前 `ExplorePanel` 的 `comicCover`。首页读取不批量下载封面；可见卡片继续调用现有 `cacheCover`。收藏与本地库关联每次返回按 SQLite 当前个人数据补充，不从上游覆盖。

## 漫画更多接口

```ts
const first = await comicExploreApi.section({ section: "recommended", offset: 0, limit: 24 });
const week = await comicExploreApi.section({ section: "ranking", period: "week", audience: "male", offset: 0, limit: 24 });
const newArrivals = await comicExploreApi.section({ section: "newArrivals", offset: 0, limit: 24 });
const completed = await comicExploreApi.section({ section: "completed", offset: 0, limit: 24 });
// { items: ComicFeedEntry[], total, offset, limit, hasMore, stale }
```

Tauri：`list_comic_explore_section({ input, refresh: false })`。`offset` 是跳过的作品数（0–1,000,000），`limit` 是每次读取数量（1–100）。继续加载使用 `offset + items.length`，由 `hasMore` 决定是否继续；去重使用 `item.pathWord`，保留原始顺序。不要将首页小样本和不同榜期或男／女频列表混在同一个分页状态里。进入更多页从 `offset=0` 查询。

排行榜必须给 `period=day|week|month`；`audience=male|female`，省略时为 `male`。男／女频日榜均已实测返回成功。其他分组不接收 `period` 或 `audience`。`hotUpdates` 不接受此命令，前端应遵从 `supportsPaging=false`。

| 分组 | 上游请求 |
| --- | --- |
| 推荐 | `/api/v3/recs?pos=3200102` |
| 排行榜 | `/api/v3/ranks?type=1&date_type=day|week|month&audience_type=male|female` |
| 全新上架 | `/api/v3/update/newest?date=` |
| 已完结 | `/api/v3/comics?top=finish&ordering=-datetime_updated&free_type=1` |

以上统一添加 `platform=3`、`limit`、`offset`，复用既有 COPY 网络配置、请求头与来源校验。当前默认目录节点为 `api.copy202601.com`，用户切换来源后缓存按节点隔离。接口属于第三方 APP 服务约定，不是有稳定承诺的官方开放 API；本轮参考已有 MIT Kira 接入方式，未引入依赖。

## 前端加载状态

- `loading`：首次进入显示加载；刷新时可保留已有内容，防止页面跳动。
- `ready`：`stale=false`。保留上游顺序，数量和字段缺失按真实响应展示。
- `empty`：请求成功但 `items=[]`，明确空状态。未知 `total=null` 不等于 0。
- `stale`：来源失败时返回旧缓存，`stale=true`；显示「当前为缓存，可重试」，不删除列表、本地收藏或阅读记录。
- `error`：无可用缓存时 Promise reject，显示实际错误与重试。支持 `home(true)` 或 `section(input,true)` 绕过新鲜缓存。

首页与更多列表独立缓存，TTL 均为 1 小时；分组／榜期／受众／分页／节点各自隔离。缺失关键分组、无效 ID 或无效业务响应不写入缓存；旧缓存可继续返回。首页采用整份响应，刷新失败不混入部分不完整分组。没有新增任务事件，使用 Promise 加载状态即可。

## 依据

- [Bangumi v0 官方规范](https://github.com/bangumi/api/blob/master/open-api/v0.yaml)：`heat` 与 `rank` 含义。
- [Bangumi 官方 trends 支持讨论](https://github.com/bangumi/api/issues/244)：v0 与官网排序差异。
- [Bangumi 官网热度目录](https://bgm.tv/anime/browser?sort=trends)。
- [Kazumi 热门列表控制器（固定研究提交）](https://github.com/Predidit/Kazumi/blob/11671bc0ec61727e99e34810f142a1b5e4121a8e/lib/pages/popular/popular_controller.dart)。
- [Kira 请求参考（MIT，固定提交）](https://github.com/caolib/kira/blob/ac0a4db1d01f95d816d61a2960c48d5296a70c1b/lib/api/manga/manga_api.dart)。

验证记录见 `AI_HANDOFF.md`；P1 与 COPY 站点的数据、数量和可用性会随时间变化，不将实测样本当作永久固定列表。
