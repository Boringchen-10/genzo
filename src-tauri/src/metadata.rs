use crate::anime_parser::{
    parse_file_name, parse_folder_name, parse_work_folder, score_candidate, ParsedAnime,
};
use crate::bangumi::BangumiProvider;
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::grouping;
use crate::media_mapping;
use crate::metadata_provider::retry_network;
use crate::models::{
    MatchCandidate, MatchCandidateRow, MediaFile, RecognitionResult, RecognitionSummary, Work,
    WorkMetadata,
};
use chrono::{Duration, Utc};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::HashSet;
use std::num::NonZeroUsize;
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration as StdDuration, Instant};
use tokio::sync::Mutex;
use uuid::Uuid;

const MEDIA_COLUMNS: &str = "id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path";
const WORK_COLUMNS: &str = "id, title, original_title, type, description, cover_path, banner_path, status, favorite, rating, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at";
const AUTO_MATCH_THRESHOLD: f64 = 0.80;
const PENDING_MATCH_THRESHOLD: f64 = 0.60;
type SearchMemoryCache = lru::LruCache<String, (Instant, Vec<WorkMetadata>)>;
static SEARCH_MEMORY_CACHE: OnceLock<Mutex<SearchMemoryCache>> = OnceLock::new();

pub async fn candidates_for_media(
    pool: &SqlitePool,
    media_file_id: &str,
) -> AppResult<Vec<MatchCandidate>> {
    let rows = sqlx::query_as::<_, MatchCandidateRow>("SELECT id, media_file_id, provider, external_id, title, original_title, aliases_json, subject_type, year, season, cover_url, confidence, match_reasons_json, metadata_json, created_at FROM match_candidates WHERE media_file_id = ? ORDER BY confidence DESC")
        .bind(media_file_id).fetch_all(pool).await?;
    rows.into_iter()
        .map(|row| row.try_into().map_err(AppError::from))
        .collect()
}

pub async fn candidates_for_work(
    pool: &SqlitePool,
    work_id: &str,
) -> AppResult<Vec<MatchCandidate>> {
    let rows = sqlx::query_as::<_, MatchCandidateRow>("SELECT c.id, c.media_file_id, c.provider, c.external_id, c.title, c.original_title, c.aliases_json, c.subject_type, c.year, c.season, c.cover_url, c.confidence, c.match_reasons_json, c.metadata_json, c.created_at FROM match_candidates c JOIN media_files m ON m.id = c.media_file_id WHERE m.work_id = ? ORDER BY c.confidence DESC")
        .bind(work_id).fetch_all(pool).await?;
    rows.into_iter()
        .map(|row| row.try_into().map_err(AppError::from))
        .collect()
}

async fn cached_search(pool: &SqlitePool, key: &str) -> AppResult<Option<Vec<WorkMetadata>>> {
    if let Some((expires_at, value)) = search_memory_cache().lock().await.get(key).cloned() {
        if expires_at > Instant::now() {
            return Ok(Some(value));
        }
    }
    let now = Utc::now().to_rfc3339();
    let json: Option<String> = sqlx::query_scalar("SELECT response_json FROM metadata_cache WHERE provider = 'bangumi' AND cache_key = ? AND expires_at > ?")
        .bind(key).bind(now).fetch_optional(pool).await?;
    let value: Option<Vec<WorkMetadata>> = json
        .map(|value| serde_json::from_str(&value).map_err(AppError::from))
        .transpose()?;
    if let Some(value) = &value {
        search_memory_cache().lock().await.put(
            key.to_string(),
            (Instant::now() + StdDuration::from_secs(3600), value.clone()),
        );
    }
    Ok(value)
}

async fn save_cache(
    pool: &SqlitePool,
    key: &str,
    data: &[WorkMetadata],
    days: i64,
) -> AppResult<()> {
    let now = Utc::now();
    sqlx::query("INSERT INTO metadata_cache (provider, cache_key, response_json, fetched_at, expires_at) VALUES ('bangumi', ?, ?, ?, ?) ON CONFLICT(provider, cache_key) DO UPDATE SET response_json = excluded.response_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at")
        .bind(key).bind(serde_json::to_string(data)?).bind(now.to_rfc3339()).bind((now + Duration::days(days)).to_rfc3339()).execute(pool).await?;
    search_memory_cache().lock().await.put(
        key.to_string(),
        (
            Instant::now()
                + StdDuration::from_secs(u64::try_from(days.max(1)).unwrap_or(1) * 86_400),
            data.to_vec(),
        ),
    );
    Ok(())
}

fn search_memory_cache() -> &'static Mutex<SearchMemoryCache> {
    SEARCH_MEMORY_CACHE.get_or_init(|| {
        Mutex::new(lru::LruCache::new(
            NonZeroUsize::new(100).expect("non-zero search cache size"),
        ))
    })
}

async fn search_provider(
    pool: &SqlitePool,
    query: &str,
    provider: &BangumiProvider,
) -> AppResult<Vec<WorkMetadata>> {
    let indexed = crate::explore::lookup_title(query)?;
    if !indexed.is_empty() {
        let mut resolved = Vec::with_capacity(indexed.len());
        for item in indexed {
            let detail_key = format!("detail:{}", item.external_id);
            if let Some(mut cached) = cached_search(pool, &detail_key).await? {
                if let Some(detail) = cached.pop() {
                    resolved.push(detail);
                    continue;
                }
            }
            match retry_network(|| provider.get_details(&item.external_id)).await {
                Ok(detail) => {
                    save_cache(pool, &detail_key, std::slice::from_ref(&detail), 30).await?;
                    resolved.push(detail);
                }
                Err(_) => resolved.push(item),
            }
        }
        return Ok(resolved);
    }
    let key = format!("search:{}", crate::anime_parser::normalize_title(query));
    if let Some(cached) = cached_search(pool, &key).await? {
        return Ok(cached);
    }
    let results = retry_network(|| provider.search(query)).await?;
    save_cache(pool, &key, &results, 7).await?;
    Ok(results)
}

async fn store_parse(
    pool: &SqlitePool,
    media_id: &str,
    parsed: &ParsedAnime,
    status: &str,
    error: Option<&str>,
) -> AppResult<()> {
    sqlx::query("UPDATE media_files SET recognition_status = ?, parsed_title = ?, parsed_original_title = ?, parsed_season = ?, parsed_episode = ?, parsed_episode_start = ?, parsed_episode_end = ?, parsed_year = ?, parsed_release_group = ?, parsed_special_type = ?, parsed_media_info = ?, last_recognized_at = ?, recognition_error = ?, updated_at = ? WHERE id = ?")
        .bind(status).bind(&parsed.title).bind(&parsed.original_title).bind(parsed.season).bind(&parsed.episode)
        .bind(parsed.episode_start.map(i64::from)).bind(parsed.episode_end.map(i64::from)).bind(parsed.year)
        .bind(&parsed.release_group).bind(&parsed.special_type).bind(serde_json::to_string(&parsed.media_info)?)
        .bind(Utc::now().to_rfc3339()).bind(error).bind(Utc::now().to_rfc3339()).bind(media_id).execute(pool).await?;
    sqlx::query("UPDATE works SET metadata_status = ?, last_recognized_at = ?, updated_at = ? WHERE id = (SELECT work_id FROM media_files WHERE id = ?) AND metadata_status != 'matched'")
        .bind(status).bind(Utc::now().to_rfc3339()).bind(Utc::now().to_rfc3339()).bind(media_id).execute(pool).await?;
    Ok(())
}

fn has_descriptive_title(value: Option<&str>) -> bool {
    value.is_some_and(|title| {
        let normalized = crate::anime_parser::normalize_title(title);
        normalized
            .chars()
            .any(|ch| ch.is_alphabetic() || (!ch.is_ascii() && !ch.is_whitespace()))
            && !matches!(
                normalized.as_str(),
                "video" | "videos" | "subtitle" | "subtitles" | "视频" | "字幕"
            )
    })
}

fn parse_with_path_context(media: &MediaFile, library_root: Option<&Path>) -> ParsedAnime {
    let mut parsed = parse_file_name(&media.file_name);
    let folder = parse_work_folder(Path::new(&media.path), library_root);
    if !has_descriptive_title(parsed.title.as_deref()) {
        parsed.title = folder.title.clone();
    }
    if parsed.season.is_none() {
        parsed.season = folder.season;
    }
    if parsed.year.is_none() {
        parsed.year = folder.year;
    }
    parsed
}

fn group_query_parse(
    group_title: Option<&str>,
    members: &[MediaFile],
    requested: &MediaFile,
    library_root: Option<&Path>,
) -> ParsedAnime {
    let requested_parse = parse_with_path_context(requested, library_root);
    let folder_parse = group_title.map(parse_folder_name).unwrap_or_default();
    let mut query = if has_descriptive_title(requested_parse.title.as_deref()) {
        requested_parse.clone()
    } else if has_descriptive_title(folder_parse.title.as_deref()) {
        folder_parse.clone()
    } else {
        members
            .iter()
            .map(|media| parse_with_path_context(media, library_root))
            .find(|parsed| has_descriptive_title(parsed.title.as_deref()))
            .unwrap_or(requested_parse.clone())
    };
    if query.season.is_none() {
        query.season = requested_parse.season.or(folder_parse.season).or_else(|| {
            members
                .iter()
                .find_map(|media| parse_with_path_context(media, library_root).season)
        });
    }
    if query.year.is_none() {
        query.year = requested_parse.year.or(folder_parse.year).or_else(|| {
            members
                .iter()
                .find_map(|media| parse_with_path_context(media, library_root).year)
        });
    }
    query
}

async fn store_group_parse(
    pool: &SqlitePool,
    members: &[MediaFile],
    fallback: &ParsedAnime,
    library_root: Option<&Path>,
    status: &str,
    error: Option<&str>,
) -> AppResult<()> {
    for media in members {
        let mut parsed = parse_with_path_context(media, library_root);
        if !has_descriptive_title(parsed.title.as_deref()) {
            parsed.title = fallback.title.clone();
        }
        if parsed.season.is_none() {
            parsed.season = fallback.season;
        }
        if parsed.year.is_none() {
            parsed.year = fallback.year;
        }
        store_parse(pool, &media.id, &parsed, status, error).await?;
    }
    Ok(())
}

pub async fn recognize_media(
    state: &AppState,
    media_file_id: &str,
    manual_query: Option<String>,
) -> AppResult<RecognitionResult> {
    let media = sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE id = ?"
    ))
    .bind(media_file_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
    if media.media_type != "video" {
        return Err(AppError::Validation(
            "v0.2 当前只支持动漫文件识别".to_string(),
        ));
    }
    if media.missing {
        return Err(AppError::Validation("文件已缺失，无法识别".to_string()));
    }
    let group = grouping::unassigned_group_context(&state.pool, media_file_id).await?;
    let library_root_path: Option<String> = match &media.library_root_id {
        Some(root_id) => {
            sqlx::query_scalar("SELECT path FROM library_roots WHERE id = ?")
                .bind(root_id)
                .fetch_optional(&state.pool)
                .await?
        }
        None => None,
    };
    let library_root = library_root_path.as_deref().map(Path::new);
    let group_title = group.as_ref().map(|context| context.title.as_str());
    let members = group
        .as_ref()
        .map(|context| context.members.clone())
        .unwrap_or_else(|| vec![media.clone()]);
    let parsed = group_query_parse(group_title, &members, &media, library_root);
    let query = manual_query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| parsed.title.clone());
    let Some(query) = query else {
        store_group_parse(
            &state.pool,
            &members,
            &parsed,
            library_root,
            "unmatched",
            Some("无法从作品目录或文件名提取标题，请手动搜索"),
        )
        .await?;
        return Ok(RecognitionResult {
            media_file_id: media_file_id.to_string(),
            status: "unmatched".to_string(),
            parsed_title: None,
            candidates: Vec::new(),
            error: Some("无法从作品目录或文件名提取标题，请手动搜索".to_string()),
        });
    };
    store_group_parse(
        &state.pool,
        &members,
        &parsed,
        library_root,
        "unmatched",
        None,
    )
    .await?;
    let provider = BangumiProvider::new()?;
    let results = match search_provider(&state.pool, &query, &provider).await {
        Ok(results) => results,
        Err(error) => {
            let message = error.to_string();
            store_group_parse(
                &state.pool,
                &members,
                &parsed,
                library_root,
                "error",
                Some(&message),
            )
            .await?;
            return Ok(RecognitionResult {
                media_file_id: media_file_id.to_string(),
                status: "error".to_string(),
                parsed_title: parsed.title,
                candidates: Vec::new(),
                error: Some(message),
            });
        }
    };
    for member in &members {
        sqlx::query("DELETE FROM match_candidates WHERE media_file_id = ?")
            .bind(&member.id)
            .execute(&state.pool)
            .await?;
    }
    let now = Utc::now().to_rfc3339();
    let mut scored = Vec::new();
    for metadata in results {
        let mut names = metadata.aliases.clone();
        if let Some(original) = &metadata.original_title {
            names.push(original.clone());
        }
        let (confidence, reasons) = score_candidate(
            &parsed,
            &metadata.title,
            &names,
            metadata.year,
            metadata.season,
        );
        if confidence < 0.45 {
            continue;
        }
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO match_candidates (id, media_file_id, provider, external_id, title, original_title, aliases_json, subject_type, year, season, cover_url, confidence, match_reasons_json, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id).bind(media_file_id).bind(&metadata.provider).bind(&metadata.external_id).bind(&metadata.title).bind(&metadata.original_title)
            .bind(serde_json::to_string(&metadata.aliases)?).bind(&metadata.subject_type).bind(metadata.year).bind(metadata.season).bind(&metadata.cover_url)
            .bind(confidence).bind(serde_json::to_string(&reasons)?).bind(serde_json::to_string(&metadata)?).bind(&now).execute(&state.pool).await?;
        scored.push(MatchCandidate {
            id,
            media_file_id: media_file_id.to_string(),
            provider: metadata.provider.clone(),
            external_id: metadata.external_id.clone(),
            title: metadata.title.clone(),
            original_title: metadata.original_title.clone(),
            aliases: metadata.aliases.clone(),
            subject_type: metadata.subject_type.clone(),
            year: metadata.year,
            season: metadata.season,
            cover_url: metadata.cover_url.clone(),
            confidence,
            match_reasons: reasons,
            created_at: now.clone(),
        });
    }
    scored.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    let explicit_search = manual_query.is_some();
    let ambiguous = parsed.season.is_some_and(|season| season > 1)
        || scored.get(1).is_some_and(|second| {
            scored
                .first()
                .is_some_and(|first| first.confidence - second.confidence < 0.08)
        });
    if !explicit_search
        && !ambiguous
        && scored
            .first()
            .is_some_and(|candidate| candidate.confidence >= AUTO_MATCH_THRESHOLD)
    {
        let candidate_id = scored[0].id.clone();
        confirm_candidate(state, media_file_id, &candidate_id).await?;
        return Ok(RecognitionResult {
            media_file_id: media_file_id.to_string(),
            status: "matched".to_string(),
            parsed_title: parsed.title,
            candidates: Vec::new(),
            error: None,
        });
    }
    let status = if scored
        .first()
        .is_some_and(|candidate| candidate.confidence >= PENDING_MATCH_THRESHOLD)
    {
        "candidate_pending"
    } else {
        "unmatched"
    };
    store_group_parse(&state.pool, &members, &parsed, library_root, status, None).await?;
    Ok(RecognitionResult {
        media_file_id: media_file_id.to_string(),
        status: status.to_string(),
        parsed_title: parsed.title,
        candidates: scored,
        error: None,
    })
}

pub async fn recognize_batch(state: &AppState) -> AppResult<RecognitionSummary> {
    let groups = grouping::list_unassigned_groups(&state.pool).await?;
    let mut summary = RecognitionSummary {
        scanned: 0,
        matched: 0,
        pending: 0,
        unmatched: 0,
        errors: 0,
    };
    for group in groups.into_iter().filter(|group| {
        group.media_type == "video"
            && group.missing_count < group.file_count
            && group.recognition_status != "matched"
    }) {
        summary.scanned += 1;
        match recognize_media(state, &group.representative.id, None).await {
            Ok(result) => match result.status.as_str() {
                "matched" => summary.matched += 1,
                "candidate_pending" => summary.pending += 1,
                "error" => summary.errors += 1,
                _ => summary.unmatched += 1,
            },
            Err(_) => summary.errors += 1,
        }
    }
    Ok(summary)
}

async fn field_locks(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
) -> AppResult<HashSet<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT field_name FROM work_field_locks WHERE work_id = ? AND locked = 1",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .collect())
}

async fn record_source(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
    field: &str,
    provider: &str,
    now: &str,
) -> AppResult<()> {
    sqlx::query("INSERT INTO work_field_sources (work_id, field_name, provider, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(work_id, field_name) DO UPDATE SET provider = excluded.provider, updated_at = excluded.updated_at")
        .bind(work_id).bind(field).bind(provider).bind(now).execute(&mut **transaction).await?;
    Ok(())
}

pub(crate) async fn apply_metadata(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
    metadata: &WorkMetadata,
    cover_path: Option<String>,
    banner_path: Option<String>,
    now: &str,
) -> AppResult<()> {
    let current =
        sqlx::query_as::<_, Work>(&format!("SELECT {WORK_COLUMNS} FROM works WHERE id = ?"))
            .bind(work_id)
            .fetch_one(&mut **transaction)
            .await?;
    let locks = field_locks(transaction, work_id).await?;
    let title = if locks.contains("title") {
        current.title
    } else {
        metadata.title.clone()
    };
    let original = if locks.contains("originalTitle") {
        current.original_title
    } else {
        metadata.original_title.clone()
    };
    let description = if locks.contains("description") {
        current.description
    } else {
        metadata.description.clone()
    };
    let year = if locks.contains("metadataYear") {
        current.metadata_year
    } else {
        metadata.year
    };
    let cover = if locks.contains("coverPath") {
        current.cover_path
    } else {
        cover_path.or(current.cover_path)
    };
    let banner_updated = banner_path.is_some();
    let banner = banner_path.or(current.banner_path);
    sqlx::query("UPDATE works SET title = ?, original_title = ?, description = ?, cover_path = ?, banner_path = ?, metadata_year = ?, metadata_status = 'matched', last_recognized_at = ?, updated_at = ? WHERE id = ?")
        .bind(title).bind(original).bind(description).bind(cover).bind(banner).bind(year).bind(now).bind(now).bind(work_id).execute(&mut **transaction).await?;
    for field in [
        "title",
        "originalTitle",
        "description",
        "coverPath",
        "metadataYear",
    ] {
        if !locks.contains(field) {
            let provider = if field == "coverPath" {
                metadata
                    .cover_provider
                    .as_deref()
                    .unwrap_or(&metadata.provider)
            } else {
                &metadata.provider
            };
            record_source(transaction, work_id, field, provider, now).await?;
        }
    }
    if banner_updated {
        record_source(
            transaction,
            work_id,
            "bannerPath",
            metadata
                .banner_provider
                .as_deref()
                .unwrap_or(&metadata.provider),
            now,
        )
        .await?;
    }
    if !locks.contains("tags") {
        sqlx::query("DELETE FROM work_tags WHERE work_id = ? AND source = 'metadata'")
            .bind(work_id)
            .execute(&mut **transaction)
            .await?;
        for genre in localized_metadata_genres(&metadata.genres) {
            let tag_id: Option<String> =
                sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
                    .bind(&genre)
                    .fetch_optional(&mut **transaction)
                    .await?;
            let tag_id = tag_id.unwrap_or_else(|| Uuid::new_v4().to_string());
            sqlx::query("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)")
                .bind(&tag_id)
                .bind(&genre)
                .bind(now)
                .execute(&mut **transaction)
                .await?;
            sqlx::query("INSERT OR IGNORE INTO work_tags (work_id, tag_id, source) VALUES (?, ?, 'metadata')")
                .bind(work_id)
                .bind(tag_id)
                .execute(&mut **transaction)
                .await?;
        }
        let provider = if metadata.source_keys.len() > 1 {
            "aggregate"
        } else {
            &metadata.provider
        };
        record_source(transaction, work_id, "tags", provider, now).await?;
    }
    Ok(())
}

fn localized_metadata_genres(genres: &[String]) -> Vec<String> {
    let mut localized = genres
        .iter()
        .filter_map(|genre| {
            let trimmed = genre.trim();
            let translated = match trimmed.to_ascii_lowercase().as_str() {
                "action" => "动作",
                "adventure" => "冒险",
                "comedy" => "喜剧",
                "drama" => "剧情",
                "ecchi" => "卖肉",
                "fantasy" => "奇幻",
                "horror" => "恐怖",
                "mahou shoujo" | "magical girl" => "魔法少女",
                "mecha" => "机战",
                "music" => "音乐",
                "mystery" => "悬疑",
                "psychological" => "心理",
                "romance" => "恋爱",
                "sci-fi" | "science fiction" => "科幻",
                "slice of life" => "日常",
                "sports" => "运动",
                "supernatural" => "超自然",
                "thriller" => "惊悚",
                _ if !trimmed.is_ascii() => trimmed,
                _ => return None,
            };
            Some(translated.to_string())
        })
        .collect::<Vec<_>>();
    localized.sort();
    localized.dedup();
    localized
}

pub async fn confirm_candidate(
    state: &AppState,
    media_file_id: &str,
    candidate_id: &str,
) -> AppResult<String> {
    let group_member_ids =
        grouping::unassigned_group_member_ids(&state.pool, media_file_id).await?;
    let row = sqlx::query_as::<_, MatchCandidateRow>("SELECT id, media_file_id, provider, external_id, title, original_title, aliases_json, subject_type, year, season, cover_url, confidence, match_reasons_json, metadata_json, created_at FROM match_candidates WHERE id = ? AND media_file_id = ?")
        .bind(candidate_id).bind(media_file_id).fetch_optional(&state.pool).await?.ok_or_else(|| AppError::NotFound("候选作品不存在或已失效".to_string()))?;
    let mut metadata: WorkMetadata = serde_json::from_str(&row.metadata_json)?;
    let provider = BangumiProvider::new()?;
    let detail_key = format!("detail:{}", metadata.external_id);
    if let Some(mut cached) = cached_search(&state.pool, &detail_key).await? {
        if let Some(item) = cached.pop() {
            metadata = item;
        }
    } else if let Ok(details) = retry_network(|| provider.get_details(&metadata.external_id)).await
    {
        metadata = details;
        save_cache(&state.pool, &detail_key, &[metadata.clone()], 30).await?;
    }
    let aggregation = crate::metadata_aggregator::aggregate(&state.pool, metadata.clone())
        .await
        .ok();
    if let Some(result) = &aggregation {
        metadata = result.metadata.clone();
    }
    let cover_path = if let Some(url) = &metadata.cover_url {
        let destination = state
            .cover_cache_path
            .join(format!("bangumi-{}.jpg", metadata.external_id));
        if destination.is_file()
            || crate::metadata_aggregator::cache_cover(url, &destination)
                .await
                .is_ok()
        {
            Some(destination.to_string_lossy().to_string())
        } else {
            None
        }
    } else {
        None
    };
    let banner_path = if let Some(url) = &metadata.banner_url {
        let destination = state
            .cover_cache_path
            .join(format!("bangumi-{}-banner.jpg", metadata.external_id));
        if destination.is_file()
            || crate::metadata_aggregator::cache_banner(url, &destination)
                .await
                .is_ok()
        {
            Some(destination.to_string_lossy().to_string())
        } else {
            None
        }
    } else {
        None
    };
    let now = Utc::now().to_rfc3339();
    let mut transaction = state.pool.begin().await?;
    let media_work: Option<String> =
        sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = ?")
            .bind(media_file_id)
            .fetch_optional(&mut *transaction)
            .await?
            .flatten();
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT work_id FROM work_external_ids WHERE provider = ? AND external_id = ?",
    )
    .bind(&metadata.provider)
    .bind(&metadata.external_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let work_id = existing
        .or(media_work)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id = ?)")
        .bind(&work_id)
        .fetch_one(&mut *transaction)
        .await?;
    if !exists {
        sqlx::query("INSERT INTO works (id, title, original_title, type, description, cover_path, banner_path, status, favorite, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at) VALUES (?, ?, ?, 'video', ?, ?, ?, 'planned', 0, '', ?, ?, 'matched', ?, ?)")
            .bind(&work_id).bind(&metadata.title).bind(&metadata.original_title).bind(&metadata.description).bind(&cover_path).bind(&banner_path).bind(&now).bind(&now).bind(metadata.year).bind(&now).execute(&mut *transaction).await?;
    }
    apply_metadata(
        &mut transaction,
        &work_id,
        &metadata,
        cover_path,
        banner_path,
        &now,
    )
    .await?;
    if let Some(aggregation) = &aggregation {
        crate::metadata_aggregator::persist_for_work(&mut transaction, &work_id, aggregation)
            .await?;
    }
    sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(work_id, provider) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at")
        .bind(&work_id).bind(&metadata.provider).bind(&metadata.external_id).bind(&now).bind(&now).execute(&mut *transaction).await?;
    sqlx::query("UPDATE media_files SET work_id = ?, recognition_status = 'matched', recognition_error = NULL, last_recognized_at = ?, updated_at = ? WHERE id = ?")
        .bind(&work_id).bind(&now).bind(&now).bind(media_file_id).execute(&mut *transaction).await?;
    for member_id in group_member_ids {
        sqlx::query("UPDATE media_files SET work_id = ?, recognition_status = 'matched', recognition_error = NULL, last_recognized_at = ?, updated_at = ? WHERE id = ? AND work_id IS NULL")
            .bind(&work_id).bind(&now).bind(&now).bind(&member_id).execute(&mut *transaction).await?;
        sqlx::query("DELETE FROM match_candidates WHERE media_file_id = ?")
            .bind(member_id)
            .execute(&mut *transaction)
            .await?;
    }
    media_mapping::rebuild_subtitle_links(&mut transaction, &work_id).await?;
    crate::anime_details::rebuild_episode_links(&mut transaction, &work_id).await?;
    sqlx::query("DELETE FROM match_candidates WHERE media_file_id = ?")
        .bind(media_file_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(work_id)
}

pub async fn cancel_candidates(pool: &SqlitePool, media_file_id: &str) -> AppResult<()> {
    let member_ids = grouping::unassigned_group_member_ids(pool, media_file_id).await?;
    let mut transaction = pool.begin().await?;
    let work_id: Option<String> =
        sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = ?")
            .bind(media_file_id)
            .fetch_optional(&mut *transaction)
            .await?
            .flatten();
    let now = Utc::now().to_rfc3339();
    let mut updated = 0;
    for member_id in member_ids {
        sqlx::query("DELETE FROM match_candidates WHERE media_file_id = ?")
            .bind(&member_id)
            .execute(&mut *transaction)
            .await?;
        updated += sqlx::query("UPDATE media_files SET recognition_status = 'unmatched', recognition_error = NULL, updated_at = ? WHERE id = ?")
            .bind(&now).bind(&member_id).execute(&mut *transaction).await?.rows_affected();
    }
    if updated == 0 {
        return Err(AppError::NotFound("媒体文件不存在".to_string()));
    }
    if let Some(work_id) = work_id {
        sqlx::query("UPDATE works SET metadata_status = 'unmatched', updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM work_external_ids WHERE work_id = ?)")
            .bind(Utc::now().to_rfc3339()).bind(&work_id).bind(&work_id).execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    Ok(())
}

pub async fn set_field_lock(
    pool: &SqlitePool,
    work_id: &str,
    field: &str,
    locked: bool,
) -> AppResult<()> {
    const FIELDS: &[&str] = &[
        "title",
        "originalTitle",
        "description",
        "coverPath",
        "metadataYear",
        "type",
        "tags",
    ];
    if !FIELDS.contains(&field) {
        return Err(AppError::Validation("不支持锁定该字段".to_string()));
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id = ?)")
        .bind(work_id)
        .fetch_one(pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound("作品不存在".to_string()));
    }
    sqlx::query("INSERT INTO work_field_locks (work_id, field_name, locked, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(work_id, field_name) DO UPDATE SET locked = excluded.locked, updated_at = excluded.updated_at")
        .bind(work_id).bind(field).bind(locked).bind(Utc::now().to_rfc3339()).execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localizes_known_anilist_genres_and_drops_unknown_english_values() {
        assert_eq!(
            localized_metadata_genres(&[
                "Action".to_string(),
                "Slice of Life".to_string(),
                "奇幻".to_string(),
                "Unknown English Tag".to_string(),
            ]),
            vec!["动作".to_string(), "奇幻".to_string(), "日常".to_string()]
        );
    }
    use crate::db;

    fn media_for_query(path: &str, file_name: &str) -> MediaFile {
        MediaFile {
            id: "media".to_string(),
            work_id: None,
            library_root_id: None,
            path: path.to_string(),
            file_name: file_name.to_string(),
            extension: "mkv".to_string(),
            media_type: "video".to_string(),
            size: 0,
            modified_at: None,
            missing: false,
            created_at: String::new(),
            updated_at: String::new(),
            recognition_status: "unmatched".to_string(),
            parsed_title: None,
            parsed_original_title: None,
            parsed_season: None,
            parsed_episode: None,
            parsed_episode_start: None,
            parsed_episode_end: None,
            parsed_year: None,
            parsed_release_group: None,
            parsed_special_type: None,
            parsed_media_info: "[]".to_string(),
            last_recognized_at: None,
            recognition_error: None,
            content_fingerprint: None,
            thumbnail_path: None,
        }
    }

    #[test]
    fn uses_confirmed_auto_and_pending_thresholds() {
        assert_eq!(AUTO_MATCH_THRESHOLD, 0.80);
        assert_eq!(PENDING_MATCH_THRESHOLD, 0.60);
    }

    #[test]
    fn uses_work_folder_when_episode_file_has_no_title() {
        let media = media_for_query("G:\\影音\\葬送的芙莉莲 S2\\01.mkv", "01.mkv");
        let parsed = group_query_parse(
            Some("葬送的芙莉莲 S2"),
            std::slice::from_ref(&media),
            &media,
            None,
        );
        assert_eq!(parsed.title.as_deref(), Some("葬送的芙莉莲"));
        assert_eq!(parsed.season, Some(2));
    }

    #[test]
    fn prefers_descriptive_release_title_over_collection_label() {
        let media = media_for_query(
            "G:\\影音\\【 4K 】Q 亲吻姐姐 12集全\\视频\\[ReinForce] Kiss x Sis - 01.mkv",
            "[ReinForce] Kiss x Sis - 01.mkv",
        );
        let parsed = group_query_parse(
            Some("【 4K 】Q 亲吻姐姐 12集全"),
            std::slice::from_ref(&media),
            &media,
            None,
        );
        assert_eq!(parsed.title.as_deref(), Some("Kiss x Sis"));
        assert_eq!(parsed.episode_start, Some(1));
    }
    #[tokio::test]
    async fn field_lock_round_trip() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('w', '测试', 'video', ?, ?)").bind(&now).bind(&now).execute(&pool).await.unwrap();
        set_field_lock(&pool, "w", "title", true).await.unwrap();
        let locked: bool = sqlx::query_scalar(
            "SELECT locked FROM work_field_locks WHERE work_id = 'w' AND field_name = 'title'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(locked);
    }

    #[tokio::test]
    async fn metadata_refresh_preserves_locked_title() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, description, created_at, updated_at) VALUES ('w', '我的标题', 'video', '旧简介', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        set_field_lock(&pool, "w", "title", true).await.unwrap();
        let metadata = WorkMetadata {
            provider: "bangumi".to_string(),
            external_id: "1".to_string(),
            title: "联网标题".to_string(),
            original_title: Some("Original".to_string()),
            aliases: Vec::new(),
            description: "新简介".to_string(),
            cover_url: None,
            banner_url: None,
            year: Some(2024),
            season: None,
            subject_type: "tv".to_string(),
            genres: vec!["奇幻".to_string()],
            score: None,
            rank: None,
            rating_count: 0,
            collection_count: 0,
            air_date: None,
            broadcast: None,
            source_keys: vec!["bangumi".to_string()],
            cover_provider: None,
            banner_provider: None,
            score_provider: None,
            fetched_at: now.clone(),
        };
        let mut transaction = pool.begin().await.unwrap();
        apply_metadata(&mut transaction, "w", &metadata, None, None, &now)
            .await
            .unwrap();
        transaction.commit().await.unwrap();
        let row: (String, String, Option<i64>) =
            sqlx::query_as("SELECT title, description, metadata_year FROM works WHERE id = 'w'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, "我的标题");
        assert_eq!(row.1, "新简介");
        assert_eq!(row.2, Some(2024));
    }

    #[tokio::test]
    async fn metadata_refresh_replaces_only_metadata_tags() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('w', '测试', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tags (id, name, created_at) VALUES ('manual', '我的标签', ?), ('old', 'Action', ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO work_tags (work_id, tag_id, source) VALUES ('w', 'manual', 'manual'), ('w', 'old', 'metadata')")
            .execute(&pool).await.unwrap();
        let metadata = WorkMetadata {
            provider: "bangumi".to_string(),
            external_id: "1".to_string(),
            title: "测试".to_string(),
            original_title: None,
            aliases: Vec::new(),
            description: "简介".to_string(),
            cover_url: None,
            banner_url: None,
            year: Some(2024),
            season: None,
            subject_type: "tv".to_string(),
            genres: vec!["Fantasy".to_string()],
            score: None,
            rank: None,
            rating_count: 0,
            collection_count: 0,
            air_date: None,
            broadcast: None,
            source_keys: vec!["bangumi".to_string(), "anilist".to_string()],
            cover_provider: None,
            banner_provider: None,
            score_provider: None,
            fetched_at: now.clone(),
        };
        let mut transaction = pool.begin().await.unwrap();
        apply_metadata(&mut transaction, "w", &metadata, None, None, &now)
            .await
            .unwrap();
        transaction.commit().await.unwrap();
        let tags: Vec<(String, String)> = sqlx::query_as("SELECT t.name, wt.source FROM tags t JOIN work_tags wt ON wt.tag_id = t.id WHERE wt.work_id = 'w' ORDER BY t.name")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(
            tags,
            vec![
                ("奇幻".to_string(), "metadata".to_string()),
                ("我的标签".to_string(), "manual".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn metadata_refresh_persists_and_preserves_cached_banner() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('w', '测试', 'video', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();
        let mut metadata = WorkMetadata {
            provider: "bangumi".to_string(),
            external_id: "1".to_string(),
            title: "测试".to_string(),
            original_title: None,
            aliases: Vec::new(),
            description: String::new(),
            cover_url: None,
            banner_url: Some("https://s4.anilist.co/banner.jpg".to_string()),
            year: None,
            season: None,
            subject_type: "tv".to_string(),
            genres: Vec::new(),
            score: None,
            rank: None,
            rating_count: 0,
            collection_count: 0,
            air_date: None,
            broadcast: None,
            source_keys: vec!["bangumi".to_string(), "anilist".to_string()],
            cover_provider: None,
            banner_provider: Some("anilist".to_string()),
            score_provider: None,
            fetched_at: now.clone(),
        };
        let mut transaction = pool.begin().await.unwrap();
        apply_metadata(
            &mut transaction,
            "w",
            &metadata,
            None,
            Some("C:\\cache\\banner.jpg".to_string()),
            &now,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        metadata.banner_url = None;
        metadata.banner_provider = None;
        let mut transaction = pool.begin().await.unwrap();
        apply_metadata(&mut transaction, "w", &metadata, None, None, &now)
            .await
            .unwrap();
        transaction.commit().await.unwrap();

        let banner: Option<String> =
            sqlx::query_scalar("SELECT banner_path FROM works WHERE id = 'w'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(banner.as_deref(), Some("C:\\cache\\banner.jpg"));
        let source: String = sqlx::query_scalar("SELECT provider FROM work_field_sources WHERE work_id = 'w' AND field_name = 'bannerPath'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(source, "anilist");
    }

    #[tokio::test]
    async fn cancelling_candidate_keeps_media_and_resets_work_status() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, metadata_status, created_at, updated_at) VALUES ('w', '测试', 'video', 'candidate_pending', ?, ?)").bind(&now).bind(&now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, recognition_status, created_at, updated_at) VALUES ('m', 'w', 'C:\\Anime\\test.mkv', 'test.mkv', 'mkv', 'video', 'candidate_pending', ?, ?)").bind(&now).bind(&now).execute(&pool).await.unwrap();
        cancel_candidates(&pool, "m").await.unwrap();
        let media: (Option<String>, String) =
            sqlx::query_as("SELECT work_id, recognition_status FROM media_files WHERE id = 'm'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let status: String = sqlx::query_scalar("SELECT metadata_status FROM works WHERE id = 'w'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(media.0.as_deref(), Some("w"));
        assert_eq!(media.1, "unmatched");
        assert_eq!(status, "unmatched");
    }
}
