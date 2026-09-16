use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub title: String,
    pub original_title: Option<String>,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub work_type: String,
    pub description: String,
    pub cover_path: Option<String>,
    #[sqlx(default)]
    pub banner_path: Option<String>,
    pub status: String,
    pub favorite: bool,
    pub rating: Option<f64>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    #[sqlx(default)]
    pub metadata_status: String,
    #[sqlx(default)]
    pub metadata_year: Option<i64>,
    #[sqlx(default)]
    pub last_recognized_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub id: String,
    pub work_id: Option<String>,
    pub library_root_id: Option<String>,
    pub path: String,
    pub file_name: String,
    pub extension: String,
    pub media_type: String,
    pub size: i64,
    pub modified_at: Option<String>,
    pub missing: bool,
    pub created_at: String,
    pub updated_at: String,
    #[sqlx(default)]
    pub recognition_status: String,
    #[sqlx(default)]
    pub parsed_title: Option<String>,
    #[sqlx(default)]
    pub parsed_original_title: Option<String>,
    #[sqlx(default)]
    pub parsed_season: Option<i64>,
    #[sqlx(default)]
    pub parsed_episode: Option<String>,
    #[sqlx(default)]
    pub parsed_episode_start: Option<i64>,
    #[sqlx(default)]
    pub parsed_episode_end: Option<i64>,
    #[sqlx(default)]
    pub parsed_year: Option<i64>,
    #[sqlx(default)]
    pub parsed_release_group: Option<String>,
    #[sqlx(default)]
    pub parsed_special_type: Option<String>,
    #[sqlx(default)]
    pub parsed_media_info: String,
    #[sqlx(default)]
    pub last_recognized_at: Option<String>,
    #[sqlx(default)]
    pub recognition_error: Option<String>,
    #[sqlx(default)]
    pub content_fingerprint: Option<String>,
    #[sqlx(default)]
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnassignedMediaGroup {
    pub key: String,
    pub title: String,
    pub folder_path: Option<String>,
    pub media_type: String,
    pub file_count: i64,
    pub missing_count: i64,
    pub total_size: i64,
    pub recognition_status: String,
    pub representative: MediaFile,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkListItem {
    #[serde(flatten)]
    pub work: Work,
    pub tags: Vec<String>,
    pub media_count: i64,
    pub missing_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkDetail {
    #[serde(flatten)]
    pub work: Work,
    pub tags: Vec<String>,
    pub media_files: Vec<MediaFile>,
    pub metadata: Option<MetadataSummary>,
    pub field_locks: Vec<String>,
    pub candidates: Vec<MatchCandidate>,
    pub subtitle_links: Vec<SubtitleLink>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLink {
    pub subtitle_media_file_id: String,
    pub video_media_file_id: String,
    pub episode: Option<String>,
    pub match_method: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSummary {
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub year: Option<i64>,
    pub cover_url: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchCandidate {
    pub id: String,
    pub media_file_id: String,
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub aliases: Vec<String>,
    pub subject_type: String,
    pub year: Option<i64>,
    pub season: Option<i64>,
    pub cover_url: Option<String>,
    pub confidence: f64,
    pub match_reasons: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct MatchCandidateRow {
    pub id: String,
    pub media_file_id: String,
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub aliases_json: String,
    pub subject_type: String,
    pub year: Option<i64>,
    pub season: Option<i64>,
    pub cover_url: Option<String>,
    pub confidence: f64,
    pub match_reasons_json: String,
    pub metadata_json: String,
    pub created_at: String,
}

impl TryFrom<MatchCandidateRow> for MatchCandidate {
    type Error = serde_json::Error;

    fn try_from(row: MatchCandidateRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            media_file_id: row.media_file_id,
            provider: row.provider,
            external_id: row.external_id,
            title: row.title,
            original_title: row.original_title,
            aliases: serde_json::from_str(&row.aliases_json)?,
            subject_type: row.subject_type,
            year: row.year,
            season: row.season,
            cover_url: row.cover_url,
            confidence: row.confidence,
            match_reasons: serde_json::from_str(&row.match_reasons_json)?,
            created_at: row.created_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkMetadata {
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub aliases: Vec<String>,
    pub description: String,
    pub cover_url: Option<String>,
    pub banner_url: Option<String>,
    pub year: Option<i64>,
    pub season: Option<i64>,
    pub subject_type: String,
    pub genres: Vec<String>,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub rank: Option<i64>,
    #[serde(default)]
    pub rating_count: i64,
    #[serde(default)]
    pub collection_count: i64,
    #[serde(default)]
    pub air_date: Option<String>,
    #[serde(default)]
    pub broadcast: Option<String>,
    #[serde(default)]
    pub source_keys: Vec<String>,
    #[serde(default)]
    pub cover_provider: Option<String>,
    #[serde(default)]
    pub banner_provider: Option<String>,
    #[serde(default)]
    pub score_provider: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataProviderStatus {
    pub key: String,
    pub label: String,
    pub available: bool,
    pub configured: bool,
    pub requires_credential: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeEpisodeMetadata {
    pub provider: String,
    pub external_id: String,
    pub episode_number: Option<u32>,
    pub sort_number: u32,
    pub title: String,
    pub original_title: Option<String>,
    pub description: String,
    pub air_date: Option<String>,
    pub duration: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeSeasonOption {
    pub external_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub relation: String,
    pub season_number: Option<u32>,
    pub cover_url: Option<String>,
    pub local_work_id: Option<String>,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeCredit {
    pub external_id: String,
    pub name: String,
    pub role: String,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeCharacter {
    pub external_id: String,
    pub name: String,
    pub role: String,
    pub image_url: Option<String>,
    pub actors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeEpisodeEntry {
    #[serde(flatten)]
    pub episode: AnimeEpisodeMetadata,
    pub local_files: Vec<MediaFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeWorkStructure {
    pub work_id: String,
    pub bangumi_id: String,
    pub seasons: Vec<AnimeSeasonOption>,
    pub episodes: Vec<AnimeEpisodeEntry>,
    pub unmatched_files: Vec<MediaFile>,
    pub staff: Vec<AnimeCredit>,
    pub characters: Vec<AnimeCharacter>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreSubject {
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub aliases: Vec<String>,
    pub description: String,
    pub cover_url: Option<String>,
    pub banner_url: Option<String>,
    pub year: Option<i64>,
    pub month: Option<u32>,
    pub air_date: Option<String>,
    pub broadcast: Option<String>,
    pub subject_type: String,
    pub genres: Vec<String>,
    pub score: Option<f64>,
    pub rank: Option<i64>,
    pub rating_count: i64,
    pub collection_count: i64,
    pub in_library: bool,
    pub favorite: bool,
    pub local_work_id: Option<String>,
    pub local_status: Option<String>,
    pub fetched_at: String,
    pub stale: bool,
    pub source_keys: Vec<String>,
    pub cover_provider: Option<String>,
    pub banner_provider: Option<String>,
    pub score_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreSourceStatus {
    pub key: String,
    pub label: String,
    pub available: bool,
    pub stale: bool,
    pub fetched_at: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreOverview {
    pub year: i32,
    pub month: u32,
    pub seasonal: Vec<ExploreSubject>,
    pub trending: Vec<ExploreSubject>,
    pub available_tags: Vec<String>,
    pub sources: Vec<ExploreSourceStatus>,
    pub fetched_at: String,
    pub stale: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreSaveInput {
    pub external_id: String,
    pub status: String,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyCalendarDay {
    pub weekday: u32,
    pub label: String,
    pub items: Vec<ExploreSubject>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyCalendar {
    pub source_version: String,
    pub generated_at: String,
    pub days: Vec<WeeklyCalendarDay>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionSummary {
    pub scanned: i64,
    pub matched: i64,
    pub pending: i64,
    pub unmatched: i64,
    pub errors: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionResult {
    pub media_file_id: String,
    pub status: String,
    pub parsed_title: Option<String>,
    pub candidates: Vec<MatchCandidate>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkInput {
    pub title: String,
    pub original_title: Option<String>,
    #[serde(rename = "type")]
    pub work_type: String,
    pub description: String,
    pub cover_path: Option<String>,
    pub status: String,
    pub favorite: bool,
    pub rating: Option<f64>,
    pub tags: Vec<String>,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: String,
    pub path: String,
    pub kind: String,
    pub enabled: bool,
    pub last_scanned_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRootInput {
    pub path: String,
    pub kind: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScanJob {
    pub id: String,
    pub library_root_id: String,
    pub status: String,
    pub discovered_count: i64,
    pub added_count: i64,
    pub updated_count: i64,
    pub missing_count: i64,
    #[sqlx(rename = "errors_json")]
    #[serde(skip_serializing)]
    pub errors_raw: String,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    #[serde(flatten)]
    pub job: ScanJob,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTool {
    pub id: String,
    pub name: String,
    pub executable_path: String,
    pub supported_media_types: Vec<String>,
    pub arguments_template: String,
    pub working_directory: Option<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalToolInput {
    pub name: String,
    pub executable_path: String,
    pub supported_media_types: Vec<String>,
    pub arguments_template: String,
    pub working_directory: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct ExternalToolRow {
    pub id: String,
    pub name: String,
    pub executable_path: String,
    pub supported_media_types: String,
    pub arguments_template: String,
    pub working_directory: Option<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl TryFrom<ExternalToolRow> for ExternalTool {
    type Error = serde_json::Error;

    fn try_from(row: ExternalToolRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            name: row.name,
            executable_path: row.executable_path,
            supported_media_types: serde_json::from_str(&row.supported_media_types)?,
            arguments_template: row.arguments_template,
            working_directory: row.working_directory,
            is_default: row.is_default,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub total_works: i64,
    pub video_count: i64,
    pub comic_count: i64,
    pub novel_count: i64,
    pub game_count: i64,
    pub other_count: i64,
    pub favorite_count: i64,
    pub missing_file_count: i64,
    pub recent_works: Vec<WorkListItem>,
    pub favorite_works: Vec<WorkListItem>,
    pub last_scan: Option<ScanResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub database_path: String,
    pub cover_cache_path: String,
    pub data_directory: String,
}
