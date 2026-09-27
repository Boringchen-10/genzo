export interface RecognitionPreference { id: string; workId: string; title: string; kind: string; updatedAt: string }
export interface CorrectionInput {
  sourceWorkId: string | null; targetWorkId: string; mediaFileIds: string[];
  mode: "keep" | "sequence" | "parsed" | "unlink"; startEpisode: number; season: number | null; episodeType: number;
}
export interface CorrectionPreview {
  token: string; title: string; warnings: string[];
  rows: CorrectionRow[];
}
export interface CorrectionIssue { code: string; message: string; action: string }
export interface CorrectionRow {
  id: string; fileName: string; fromTitle: string | null; episode: number | null;
  season?: number | null; episodeType?: number; oldEpisode: string | null; officialTitle: string | null;
  parsedSeason?: number | null; parsedEpisode?: string | null; primaryProvider?: string;
  officialEpisodeId?: string | null; eligible?: boolean; reliable?: boolean; issues?: CorrectionIssue[];
  artworkSeason?: number | null; artworkEpisode?: number | null; artworkAvailable?: boolean;
}

/** Still availability must never determine whether a file can be associated. */
export function reliableCorrectionIds(rows: CorrectionRow[]): string[] {
  return rows.filter(row => row.reliable === true && row.eligible !== false).map(row => row.id);
}
export function correctionAdvice(message: string): { text: string; action: "refresh" | "retry" | "target" | "sequence" | "preview" } {
  if (/429|502|503|超时|网络|连接|请求|HTTP|fetch/i.test(message)) return { text: "网络请求失败，已有缓存、关联和观看进度保留。可稍后重试；不要重新扫描或删除记录。", action: "retry" };
  if (/季度|混季/.test(message)) return { text: "按季度分别勾选，核对目标作品；主源季度和 TMDB 剧照季度可以不同。", action: "target" };
  if (/条目 ID|尚未关联|主源/.test(message)) return { text: "目标作品缺少有效主源，请先重新识别作品并选定实际季度。", action: "target" };
  if (/单集|编号|集号/.test(message)) return { text: "取消勾选异常文件；需要人工编号时切换自然排序并逐行核对。", action: "sequence" };
  if (/过期|归属已变化/.test(message)) return { text: "预览依据已经变化，请重新诊断并预览后再保存。", action: "preview" };
  return { text: "可重新诊断；官方分集缺失时仍可人工确认明确编号，刷新失败不会清除已有记录。", action: "refresh" };
}
