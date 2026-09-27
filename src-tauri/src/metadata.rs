use crate::anime_parser::{parse_folder_name, parse_media_path, score_candidate, ParsedAnime};
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
    let mut rows = sqlx::query_as::<_, MatchCandidateRow>("SELECT id, media_file_id, provider, external_id, title, original_title, aliases_json, subject_type, year, season, cover_url, confidence, match_reasons_json, metadata_json, created_at FROM match_candidates WHERE media_file_id = ? ORDER BY confidence DESC")
        .bind(media_file_id).fetch_all(pool).await?;
    if rows.is_empty() {
        if let Some(group) = grouping::recognition_group_context(pool, media_file_id).await? {
            let ids = group.members.iter().map(|file| file.id.as_str()).collect::<Vec<_>>();
            rows = sqlx::query_as::<_, MatchCandidateRow>("SELECT id, media_file_id, provider, external_id, title, original_title, aliases_json, subject_type, year, season, cover_url, confidence, match_reasons_json, metadata_json, created_at FROM match_candidates WHERE provider = 'bangumi' AND media_file_id IN (SELECT value FROM json_each(?)) ORDER BY confidence DESC")
                .bind(serde_json::to_string(&ids)?).fetch_all(pool).await?;
        }
    }
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
    parsed: &ParsedAnime,
) -> AppResult<Vec<WorkMetadata>> {
    let key = format!(
        "search:v045:{}:{:?}:{:?}",
        crate::anime_parser::normalize_title(query),
        parsed.season,
        parsed.special_type
    );
    if let Some(cached) = cached_search(pool, &key).await? {
        return Ok(cached);
    }
    let mut indexed = crate::explore::lookup_title(query)?;
    if let Some(season) = parsed.season {
        let chinese = match season {
            1 => "一",
            2 => "二",
            3 => "三",
            4 => "四",
            5 => "五",
            _ => "",
        };
        for suffix in [
            format!("Season {season}"),
            format!("S{season}"),
            format!("第{season}季"),
            format!("第{chinese}季"),
            format!("第{season}期"),
        ] {
            indexed.extend(crate::explore::lookup_title(&format!("{query} {suffix}"))?);
        }
    }
    if let Some(kind) = &parsed.special_type {
        indexed.extend(crate::explore::lookup_title(&format!("{query} {kind}"))?);
    }
    let mut local_fallback = Vec::new();
    if !indexed.is_empty() {
        let mut resolved = Vec::with_capacity(indexed.len());
        let mut seen = HashSet::new();
        for item in indexed {
            if !seen.insert(item.external_id.clone()) {
                continue;
            }
            let detail_key = format!("detail:{}", item.external_id);
            if let Some(mut cached) = cached_search(pool, &detail_key).await? {
                if let Some(detail) = cached.pop() {
                    resolved.push(detail);
                    continue;
                }
            }
            // Rank the complete local candidate set first. Only confirmation fetches
            // the selected subject's details, never every indexed candidate.
            resolved.push(item);
        }
        if resolved
            .iter()
            .any(|item| score_metadata(parsed, item).0 >= AUTO_MATCH_THRESHOLD)
        {
            save_cache(pool, &key, &resolved, 1).await?;
            return Ok(resolved);
        }
        local_fallback = resolved;
    }
    let network_query = if let Some(season) = parsed.season.filter(|value| *value > 1) {
        format!("{query} 第{season}季")
    } else {
        parsed
            .special_type
            .as_ref()
            .map_or_else(|| query.to_string(), |kind| format!("{query} {kind}"))
    };
    let results = match retry_network(|| provider.search(&network_query)).await {
        Ok(results) => results,
        Err(error) => {
            let json: Option<String> = sqlx::query_scalar("SELECT response_json FROM metadata_cache WHERE provider = 'bangumi' AND cache_key = ?")
                .bind(&key).fetch_optional(pool).await?;
            if let Some(json) = json {
                return Ok(serde_json::from_str(&json)?);
            }
            if !local_fallback.is_empty() {
                return Ok(local_fallback);
            }
            return Err(error);
        }
    };
    let mut results = results;
    let mut seen = results
        .iter()
        .map(|item| item.external_id.clone())
        .collect::<HashSet<_>>();
    results.extend(
        local_fallback
            .into_iter()
            .filter(|item| seen.insert(item.external_id.clone())),
    );
    save_cache(pool, &key, &results, 7).await?;
    Ok(results)
}

fn score_metadata(parsed: &ParsedAnime, metadata: &WorkMetadata) -> (f64, Vec<String>) {
    let mut names = metadata.aliases.clone();
    names.push(metadata.title.clone());
    names.extend(metadata.original_title.clone());
    let parsed_names = names
        .iter()
        .map(|name| parse_folder_name(name))
        .collect::<Vec<_>>();
    let season = metadata
        .season
        .or_else(|| parsed_names.iter().find_map(|name| name.season));
    let mut aliases = names.clone();
    aliases.extend(parsed_names.iter().filter_map(|name| name.title.clone()));
    let mut query = parsed.clone();
    query.special_type = None;
    let (mut score, mut reasons) =
        score_candidate(&query, &metadata.title, &aliases, metadata.year, season);
    if parsed.season.is_none() && season.is_some_and(|value| value > 1) {
        score = score.min(0.79);
        reasons.push("文件未标季数，候选为续作，需确认".into());
    }
    if parsed
        .season
        .is_some_and(|wanted| season != Some(wanted) && (wanted > 1 || season.is_some()))
    {
        score = score.min(0.59);
        reasons.push("季数不一致或候选季数未确认".into());
    }
    if parsed.year.is_some() && metadata.year.is_some() && parsed.year != metadata.year {
        score = score.min(0.79);
        reasons.push("年份不一致，需确认".into());
    }
    let kind = metadata.subject_type.to_ascii_lowercase();
    let special_matches = match parsed.special_type.as_deref() {
        Some("OVA" | "OAD") => matches!(kind.as_str(), "ova" | "oad"),
        Some("MOVIE") => kind == "movie",
        Some("SP" | "SPECIAL") => matches!(kind.as_str(), "sp" | "special"),
        Some(_) => false, // NCOP/NCED are extras, not standalone regular episodes.
        None => !matches!(kind.as_str(), "ova" | "oad" | "movie" | "sp" | "special"),
    };
    if !special_matches {
        score = score.min(0.79);
        reasons.push("作品类型或特别篇归属需确认".into());
    } else if parsed.special_type.is_some() {
        reasons.push("特别篇类型一致".into());
    }
    (score, reasons)
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
    parse_media_path(
        &media.file_name,
        Path::new(&crate::remote_storage::display_path(&media.path)),
        library_root,
    )
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
    let group = grouping::recognition_group_context(&state.pool, media_file_id).await?;
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
    let mut parsed = group_query_parse(group_title, &members, &media, library_root);
    if let Some(query) = manual_query.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        parsed = parse_folder_name(query);
        parsed.title = Some(query.to_string());
    }
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
    let results = match search_provider(&state.pool, &query, &provider, &parsed).await {
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
        let (confidence, reasons) = score_metadata(&parsed, &metadata);
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
    let mixed_types = members
        .iter()
        .filter(|file| file.media_type == "video")
        .map(|file| {
            parse_media_path(&file.file_name, Path::new(&file.path), library_root).special_type
        })
        .collect::<HashSet<_>>()
        .len()
        > 1;
    let ambiguous = mixed_types
        || group_title.is_some_and(crate::anime_parser::is_multi_season_collection)
        || scored.get(1).is_some_and(|second| {
            scored
                .first()
                .is_some_and(|first| first.confidence - second.confidence < 0.08)
        });
    if !explicit_search
        && media.work_id.is_none()
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
    confirm_candidate_internal(state, media_file_id, candidate_id, true, None, grouping::GroupScope::Season).await
}

pub async fn confirm_candidate_local(state: &AppState, media_file_id: &str, candidate_id: &str) -> AppResult<String> {
    confirm_candidate_internal(state, media_file_id, candidate_id, false, None, grouping::GroupScope::Season).await
}

pub async fn confirm_candidate_local_selected(
    state: &AppState,
    media_file_id: &str,
    candidate_id: &str,
    selected_media_ids: &[String],
    scope: grouping::GroupScope,
) -> AppResult<String> {
    confirm_candidate_internal(state, media_file_id, candidate_id, false, Some(selected_media_ids), scope).await
}

/// 用户在识别界面显式确认时，提交范围由界面里的作品文件夹/季度范围决定：
/// 该范围限制可以勾选的文件；最终归属还需核对候选条目和实际勾选范围。
async fn confirmation_scope(
    state: &AppState,
    media_file_id: &str,
    scope: grouping::GroupScope,
) -> AppResult<(Vec<String>, Option<String>)> {
    let Some(context) = grouping::recognition_scope_context(&state.pool, media_file_id, scope).await?
    else {
        return Ok((vec![media_file_id.to_string()], None));
    };
    let requested_work = context
        .members
        .iter()
        .find(|file| file.id == media_file_id)
        .and_then(|file| file.work_id.clone());
    let selectable_ids = context.selectable_ids(requested_work.as_deref());
    Ok((selectable_ids, context.linked_work_id))
}

fn selected_group_members(group_member_ids: Vec<String>, candidate_media_id: &str, selected_media_ids: Option<&[String]>) -> AppResult<Vec<String>> {
    let Some(selected) = selected_media_ids else { return Ok(group_member_ids); };
    let allowed: HashSet<&str> = group_member_ids.iter().map(String::as_str).collect();
    let unique: HashSet<&str> = selected.iter().map(String::as_str).collect();
    if selected.is_empty() || unique.len() != selected.len() || !unique.contains(candidate_media_id) || !unique.is_subset(&allowed) {
        return Err(AppError::Validation("所选文件已变化，请重新打开识别界面确认".to_string()));
    }
    Ok(selected.to_vec())
}

async fn confirm_candidate_internal(state: &AppState, media_file_id: &str, candidate_id: &str, enrich: bool, selected_media_ids: Option<&[String]>, scope: grouping::GroupScope) -> AppResult<String> {
    // 自动匹配沿用季度组（行为不变）；界面确认则使用用户看到的文件夹范围，
    // 这样先前单独识别过的小文件夹会被一起处理，而不是另建一部作品。
    let (selectable_ids, linked_work_id) = match selected_media_ids {
        Some(_) => confirmation_scope(state, media_file_id, scope).await?,
        None => {
            let ids: Vec<String> = grouping::recognition_group_context(&state.pool, media_file_id)
                .await?
                .map(|context| context.members.into_iter().map(|file| file.id).collect())
                .unwrap_or_else(|| vec![media_file_id.to_string()]);
            (ids, None)
        }
    };
    let group_member_ids = selected_group_members(selectable_ids, media_file_id, selected_media_ids)?;
    let row = sqlx::query_as::<_, MatchCandidateRow>("SELECT id, media_file_id, provider, external_id, title, original_title, aliases_json, subject_type, year, season, cover_url, confidence, match_reasons_json, metadata_json, created_at FROM match_candidates WHERE id = ? AND media_file_id = ?")
        .bind(candidate_id).bind(media_file_id).fetch_optional(&state.pool).await?.ok_or_else(|| AppError::NotFound("候选作品不存在或已失效".to_string()))?;
    if row.provider == "tmdb" {
        return crate::film_tv::confirm(state, &row, &group_member_ids).await;
    }
    let metadata: WorkMetadata = serde_json::from_str(&row.metadata_json)?;
    let (metadata, aggregation, cover_path, banner_path) = if enrich {
        enrich_candidate_metadata(state, metadata).await?
    } else {
        let cover = state.cover_cache_path.join(format!("bangumi-{}.jpg", metadata.external_id));
        let banner = state.cover_cache_path.join(format!("bangumi-{}-banner.jpg", metadata.external_id));
        (metadata, None, cover.is_file().then(|| cover.to_string_lossy().to_string()), banner.is_file().then(|| banner.to_string_lossy().to_string()))
    };
    let now = Utc::now().to_rfc3339();
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    let candidate_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM match_candidates WHERE id = ? AND media_file_id = ?)")
        .bind(candidate_id).bind(media_file_id).fetch_one(&mut *transaction).await?;
    if !candidate_exists {
        return Err(AppError::NotFound("候选作品不存在或已失效".into()));
    }
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
    // 文件夹只能提供候选归属，不能覆盖已经锚定到另一季的作品。
    let linked_work_id = if let Some(linked) = linked_work_id {
        let anchor: Option<String> = sqlx::query_scalar(
            "SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = ?",
        )
        .bind(&linked)
        .bind(&metadata.provider)
        .fetch_optional(&mut *transaction)
        .await?;
        anchor
            .is_none_or(|anchor| anchor == metadata.external_id)
            .then_some(linked)
    } else {
        None
    };
    let work_id = if let Some(existing) = existing {
        existing
    } else if let Some(linked) = linked_work_id {
        linked
    } else {
        recognition_target_work(
            &mut transaction,
            None,
            media_work.as_deref(),
            &group_member_ids,
        )
        .await?
    };
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id = ?)")
        .bind(&work_id)
        .fetch_one(&mut *transaction)
        .await?;
    let undo = crate::recognition_history::begin(&mut transaction, &work_id, &group_member_ids).await?;
    if !exists {
        sqlx::query("INSERT INTO works (id, title, original_title, type, description, cover_path, banner_path, status, favorite, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at) VALUES (?, ?, ?, 'video', ?, ?, ?, 'planned', 0, '', ?, ?, 'matched', ?, ?)")
            .bind(&work_id).bind(&metadata.title).bind(&metadata.original_title).bind(&metadata.description).bind(&cover_path).bind(&banner_path).bind(&now).bind(&now).bind(metadata.year).bind(&now).execute(&mut *transaction).await?;
    }
    if enrich || !exists {
        apply_metadata(
        &mut transaction,
        &work_id,
        &metadata,
        cover_path,
        banner_path,
        &now,
    )
        .await?;
    }
    if let Some(aggregation) = &aggregation {
        crate::metadata_aggregator::persist_for_work(&mut transaction, &work_id, aggregation)
            .await?;
    }
    sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(work_id, provider) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at")
        .bind(&work_id).bind(&metadata.provider).bind(&metadata.external_id).bind(&now).bind(&now).execute(&mut *transaction).await?;
    move_recognition_group(&mut transaction, &group_member_ids, &work_id, &now).await?;
    crate::media_reconciliation::reconcile(&mut transaction, Some(&work_id)).await?;
    if let Some(previous) = media_work.filter(|previous| previous != &work_id) {
        media_mapping::rebuild_subtitle_links(&mut transaction, &previous).await?;
        crate::anime_details::rebuild_episode_links(&mut transaction, &previous).await?;
    }
    media_mapping::rebuild_subtitle_links(&mut transaction, &work_id).await?;
    crate::anime_details::rebuild_episode_links(&mut transaction, &work_id).await?;
    sqlx::query("DELETE FROM match_candidates WHERE media_file_id = ?")
        .bind(media_file_id)
        .execute(&mut *transaction)
        .await?;
    if selected_media_ids.is_some() {
        crate::recognition_preferences::learn(&mut transaction, &work_id, &group_member_ids).await?;
    }
    crate::recognition_history::finish(&mut transaction, undo, &work_id, &metadata.title).await?;
    transaction.commit().await?;
    Ok(work_id)
}

async fn enrich_candidate_metadata(
    state: &AppState,
    mut metadata: WorkMetadata,
) -> AppResult<(WorkMetadata, Option<crate::metadata_aggregator::AggregationResult>, Option<String>, Option<String>)> {
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
        let destination = crate::metadata_aggregator::artwork_cache_path(
            &state.cover_cache_path, &format!("bangumi-{}", metadata.external_id), "cover", url);
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
        let destination = crate::metadata_aggregator::artwork_cache_path(
            &state.cover_cache_path, &format!("bangumi-{}", metadata.external_id), "banner", url);
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
    Ok((metadata, aggregation, cover_path, banner_path))
}

/// Enrichment never changes the chosen anchor or the user's file associations.
pub async fn enrich_confirmed_work(state: &AppState, work_id: &str, metadata: WorkMetadata) -> AppResult<Vec<String>> {
    if metadata.provider == "tmdb" {
        return crate::film_tv::enrich(state, work_id, &metadata.external_id, false).await;
    }
    let anchor = metadata.external_id.clone();
    let operation: Option<String> = sqlx::query_scalar("SELECT id FROM recognition_history WHERE target_work_id=? ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(work_id).fetch_optional(&state.pool).await?;
    let (metadata, aggregation, cover, banner) = enrich_candidate_metadata(state, metadata).await?;
    let (_guard, mut tx) = crate::db::begin_write(&state.pool).await?;
    if let Some(operation) = operation {
        let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM recognition_history WHERE id=? AND undone_at IS NULL)")
            .bind(operation).fetch_one(&mut *tx).await?;
        if !active { return Ok(Vec::new()); }
    }
    let current: Option<String> = sqlx::query_scalar("SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = 'bangumi'")
        .bind(work_id).fetch_optional(&mut *tx).await?;
    if current.as_deref() != Some(&anchor) { return Ok(Vec::new()); }
    let undo = crate::recognition_history::before_enrichment(&mut tx, work_id).await?;
    apply_metadata(&mut tx, work_id, &metadata, cover.clone(), banner.clone(), &Utc::now().to_rfc3339()).await?;
    if let Some(aggregation) = aggregation {
        crate::metadata_aggregator::persist_for_work(&mut tx, work_id, &aggregation).await?;
    }
    crate::anime_details::rebuild_episode_links(&mut tx, work_id).await?;
    crate::recognition_history::after_enrichment(&mut tx, undo).await?;
    tx.commit().await?;
    Ok([cover, banner].into_iter().flatten().collect())
}

async fn recognition_target_work(
    transaction: &mut Transaction<'_, Sqlite>,
    existing: Option<String>,
    previous: Option<&str>,
    member_ids: &[String],
) -> AppResult<String> {
    if let Some(existing) = existing {
        return Ok(existing);
    }
    if let Some(previous) = previous {
        let files: Vec<String> = sqlx::query_scalar("SELECT id FROM media_files WHERE work_id = ?")
            .bind(previous)
            .fetch_all(&mut **transaction)
            .await?;
        if files.iter().all(|id| member_ids.contains(id)) {
            return Ok(previous.to_string());
        }
    }
    Ok(Uuid::new_v4().to_string())
}

async fn move_recognition_group(
    transaction: &mut Transaction<'_, Sqlite>,
    member_ids: &[String],
    work_id: &str,
    now: &str,
) -> AppResult<()> {
    for member_id in member_ids {
        // Manual episode links belong to the old Bangumi subject too; retaining
        // them after a deliberate work move would create cross-work mappings.
        sqlx::query("DELETE FROM media_episode_links WHERE media_file_id = ? AND work_id != ?")
            .bind(member_id)
            .bind(work_id)
            .execute(&mut **transaction)
            .await?;
        sqlx::query("DELETE FROM subtitle_links WHERE (subtitle_media_file_id = ? OR video_media_file_id = ?) AND work_id != ?")
            .bind(member_id).bind(member_id).bind(work_id).execute(&mut **transaction).await?;
        sqlx::query("UPDATE media_files SET work_id = ?, recognition_status = 'matched', recognition_error = NULL, last_recognized_at = ?, updated_at = ? WHERE id = ?")
            .bind(work_id).bind(now).bind(now).bind(member_id).execute(&mut **transaction).await?;
        sqlx::query("DELETE FROM match_candidates WHERE media_file_id = ?")
            .bind(member_id)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

pub async fn cancel_candidates(pool: &SqlitePool, media_file_id: &str) -> AppResult<()> {
    let member_ids: Vec<String> = grouping::recognition_group_context(pool, media_file_id)
        .await?
        .map(|context| context.members.into_iter().map(|file| file.id).collect())
        .unwrap_or_else(|| vec![media_file_id.to_string()]);
    let (_write_guard, mut transaction) = crate::db::begin_write(pool).await?;
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
    fn exact_second_season_matches_but_unknown_or_conflicting_seasons_do_not() {
        let mut candidate = crate::explore::lookup_title("葬送的芙莉莲")
            .unwrap()
            .remove(0);
        candidate.title = "示例动画 第二季".into();
        candidate.original_title = None;
        candidate.aliases.clear();
        candidate.season = Some(2);
        let parsed = parse_folder_name("示例动画 第二季");
        assert_eq!(parsed.season, Some(2));
        assert!(score_metadata(&parsed, &candidate).0 >= AUTO_MATCH_THRESHOLD);
        candidate.title = "示例动画".into();
        candidate.season = Some(1);
        assert!(score_metadata(&parsed, &candidate).0 < PENDING_MATCH_THRESHOLD);
        candidate.season = None;
        assert!(score_metadata(&parsed, &candidate).0 < AUTO_MATCH_THRESHOLD);
    }

    #[test]
    fn exact_oad_requires_matching_type_and_credits_remain_manual() {
        let mut candidate = crate::explore::lookup_title("葬送的芙莉莲")
            .unwrap()
            .remove(0);
        let mut parsed = ParsedAnime {
            title: Some(candidate.title.clone()),
            special_type: Some("OAD".into()),
            ..Default::default()
        };
        candidate.subject_type = "ova".into();
        assert!(score_metadata(&parsed, &candidate).0 >= AUTO_MATCH_THRESHOLD);
        candidate.subject_type = "tv".into();
        assert!(score_metadata(&parsed, &candidate).0 < AUTO_MATCH_THRESHOLD);
        parsed.special_type = Some("NCED".into());
        assert!(score_metadata(&parsed, &candidate).0 < AUTO_MATCH_THRESHOLD);
    }

    #[tokio::test]
    async fn pending_group_can_read_sibling_candidates_and_confirm_without_network() {
        let pool = db::test_pool().await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            pool: pool.clone(), database_path: dir.path().join("test.db"),
            data_directory: dir.path().into(), cover_cache_path: dir.path().into(),
            thumbnail_cache_path: dir.path().into(),
        };
        sqlx::query("INSERT INTO library_roots (id,path,kind,enabled,created_at,updated_at) VALUES ('root','C:\\Anime','video',1,'now','now')").execute(&pool).await.unwrap();
        for id in ["01", "02"] {
            sqlx::query("INSERT INTO media_files (id,library_root_id,path,file_name,extension,media_type,recognition_status,created_at,updated_at) VALUES (?,'root',?,?,'mkv','video','candidate_pending','now','now')")
                .bind(id).bind(format!("C:\\Anime\\葬送的芙莉莲\\{id}.mkv")).bind(format!("{id}.mkv")).execute(&pool).await.unwrap();
        }
        let metadata = crate::explore::lookup_title("葬送的芙莉莲").unwrap().remove(0);
        sqlx::query("INSERT INTO match_candidates (id,media_file_id,provider,external_id,title,aliases_json,subject_type,confidence,match_reasons_json,metadata_json,created_at) VALUES ('c','02','bangumi',?,?,'[]','tv',0.79,'[]',?,'now')")
            .bind(&metadata.external_id).bind(&metadata.title).bind(serde_json::to_string(&metadata).unwrap()).execute(&pool).await.unwrap();
        let candidates = candidates_for_media(&pool, "01").await.unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].media_file_id, "02");
        let work_id = tokio::time::timeout(StdDuration::from_secs(1), confirm_candidate_local(&state, "02", "c")).await.unwrap().unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM media_files WHERE work_id = ? AND recognition_status = 'matched'").bind(&work_id).fetch_one(&pool).await.unwrap();
        assert_eq!(count, 2);
        assert!(candidates_for_media(&pool, "01").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn selected_confirmation_leaves_excluded_group_files_unassigned() {
        let pool = db::test_pool().await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            pool: pool.clone(), database_path: dir.path().join("test.db"),
            data_directory: dir.path().into(), cover_cache_path: dir.path().into(),
            thumbnail_cache_path: dir.path().into(),
        };
        sqlx::query("INSERT INTO library_roots (id,path,kind,enabled,created_at,updated_at) VALUES ('root','C:\\Anime','video',1,'now','now')").execute(&pool).await.unwrap();
        for id in ["01", "02", "03"] {
            sqlx::query("INSERT INTO media_files (id,library_root_id,path,file_name,extension,media_type,recognition_status,created_at,updated_at) VALUES (?,'root',?,?,'mkv','video','candidate_pending','now','now')")
                .bind(id).bind(format!("C:\\Anime\\Show\\{id}.mkv")).bind(format!("{id}.mkv")).execute(&pool).await.unwrap();
        }
        let metadata = crate::explore::lookup_title("葬送的芙莉莲").unwrap().remove(0);
        sqlx::query("INSERT INTO match_candidates (id,media_file_id,provider,external_id,title,aliases_json,subject_type,confidence,match_reasons_json,metadata_json,created_at) VALUES ('c','02','bangumi',?,?,'[]','tv',0.79,'[]',?,'now')")
            .bind(&metadata.external_id).bind(&metadata.title).bind(serde_json::to_string(&metadata).unwrap()).execute(&pool).await.unwrap();

        assert!(confirm_candidate_local_selected(&state, "02", "c", &["01".into()], crate::grouping::GroupScope::Season).await.is_err());
        assert!(confirm_candidate_local_selected(&state, "02", "c", &["02".into(), "outside".into()], crate::grouping::GroupScope::Season).await.is_err());
        let work_id = confirm_candidate_local_selected(&state, "02", "c", &["01".into(), "02".into()], crate::grouping::GroupScope::Season).await.unwrap();
        let matched: Vec<String> = sqlx::query_scalar("SELECT id FROM media_files WHERE work_id = ? ORDER BY id")
            .bind(&work_id).fetch_all(&pool).await.unwrap();
        assert_eq!(matched, vec!["01", "02"]);
        let excluded: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = '03'").fetch_one(&pool).await.unwrap();
        assert!(excluded.is_none());
    }

    /// 同一 UNC 文件夹中的跨季拆分必须走完整确认链路，不能重命名第一季。
    #[tokio::test]
    async fn mixed_folder_confirmation_preserves_first_season_and_manual_links() {
        for (assigned, official_links, existing_second_season) in [
            (true, true, false), (true, false, false), (false, false, false), (true, true, true),
        ] {
            let pool = db::test_pool().await.unwrap();
            let dir = tempfile::tempdir().unwrap();
            let state = AppState {
                pool: pool.clone(), database_path: dir.path().join("test.db"),
                data_directory: dir.path().into(), cover_cache_path: dir.path().into(),
                thumbnail_cache_path: dir.path().into(),
            };
            let root = r"\\?\UNC\RaiDrive-Administrator\share\Anime";
            sqlx::query("INSERT INTO library_roots (id,path,kind,enabled,created_at,updated_at) VALUES ('root',?,'video',1,'now','now')")
                .bind(root).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO works (id,title,type,notes,favorite,created_at,updated_at) VALUES ('s1','第一季','video','保留笔记',1,'now','now')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_external_ids (work_id,provider,external_id,created_at,updated_at) VALUES ('s1','bangumi','first-season','now','now')")
                .execute(&pool).await.unwrap();
            for (id, name, work) in [
                ("01", "Show [01].mkv", Some("s1")),
                ("02", "Show [02].mkv", Some("s1")),
                ("13", "Show [13].mkv", assigned.then_some("s1")),
                ("14", "Show [14].mkv", assigned.then_some("s1")),
                ("nced", "Show [NCED01].mkv", Some("s1")),
                ("special", "Show [12.5].mkv", Some("s1")),
                ("sub", "Show [01].ass", Some("s1")),
            ] {
                let extension = if id == "sub" { "ass" } else { "mkv" };
                let media_type = if id == "sub" { "other" } else { "video" };
                sqlx::query("INSERT INTO media_files (id,work_id,library_root_id,path,file_name,extension,media_type,recognition_status,created_at,updated_at) VALUES (?,?,'root',?,?,?,?, 'matched','now','now')")
                    .bind(id).bind(work).bind(format!(r"{root}\Show 1-2季\{name}"))
                    .bind(name).bind(extension).bind(media_type).execute(&pool).await.unwrap();
            }
            if official_links {
                for (id, method) in [("01", "manual"), ("02", "parsed")] {
                    sqlx::query("INSERT INTO anime_episodes (work_id,provider,external_id,episode_number,sort_number,fetched_at) VALUES ('s1','bangumi',?,1,1,'now')")
                        .bind(id).execute(&pool).await.unwrap();
                    sqlx::query("INSERT INTO media_episode_links (media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES (?,'s1','bangumi',?,?,1,'now')")
                        .bind(id).bind(id).bind(method).execute(&pool).await.unwrap();
                }
                sqlx::query("INSERT INTO subtitle_links (subtitle_media_file_id,video_media_file_id,work_id,match_method,created_at,updated_at) VALUES ('sub','01','s1','episode','now','now')")
                    .execute(&pool).await.unwrap();
                for scope in [grouping::GroupScope::Season, grouping::GroupScope::Folder] {
                    let context = grouping::recognition_scope_context(&pool, "13", scope).await.unwrap().unwrap();
                    let ids = context.selectable_ids(Some("s1"));
                    assert!(!ids.iter().any(|id| ["01", "02", "sub"].contains(&id.as_str())), "{ids:?}");
                    if scope == grouping::GroupScope::Season {
                        assert_eq!(ids, vec!["13", "14"]);
                    }
                }
                let context = grouping::recognition_group_context(&pool, "13").await.unwrap().unwrap();
                assert_eq!(context.members.iter().map(|file| file.id.as_str()).collect::<Vec<_>>(), vec!["13", "14"]);
            }
            let mut metadata = crate::explore::lookup_title("葬送的芙莉莲").unwrap().remove(0);
            metadata.title = "第二季".into();
            metadata.external_id = "second-season".into();
            metadata.season = Some(2);
            if existing_second_season {
                sqlx::query("INSERT INTO works (id,title,type,created_at,updated_at) VALUES ('s2','第二季','video','now','now')")
                    .execute(&pool).await.unwrap();
                sqlx::query("INSERT INTO work_external_ids (work_id,provider,external_id,created_at,updated_at) VALUES ('s2','bangumi','second-season','now','now')")
                    .execute(&pool).await.unwrap();
            }
            sqlx::query("INSERT INTO match_candidates (id,media_file_id,provider,external_id,title,aliases_json,subject_type,confidence,match_reasons_json,metadata_json,created_at) VALUES ('c','13','bangumi',?,?,'[]','tv',0.79,'[]',?,'now')")
                .bind(&metadata.external_id).bind(&metadata.title).bind(serde_json::to_string(&metadata).unwrap()).execute(&pool).await.unwrap();
            let scope = if official_links { grouping::GroupScope::Season } else { grouping::GroupScope::Folder };
            if official_links {
                assert!(confirm_candidate_local_selected(&state, "13", "c", &["01".into(), "13".into()], scope).await.is_err());
            }
            let target = confirm_candidate_local_selected(&state, "13", "c", &["13".into(), "14".into()], scope).await.unwrap();
            assert_ne!(target, "s1");
            if existing_second_season {
                assert_eq!(target, "s2");
            }
            let moved: Vec<String> = sqlx::query_scalar("SELECT id FROM media_files WHERE work_id = ? ORDER BY id")
                .bind(&target).fetch_all(&pool).await.unwrap();
            assert_eq!(moved, vec!["13", "14"]);
            let original: (String, String, bool, String) = sqlx::query_as("SELECT w.title,w.notes,w.favorite,e.external_id FROM works w JOIN work_external_ids e ON e.work_id=w.id WHERE w.id='s1'")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(original, ("第一季".into(), "保留笔记".into(), true, "first-season".into()));
            let kept: Vec<String> = sqlx::query_scalar("SELECT id FROM media_files WHERE work_id='s1' ORDER BY id")
                .fetch_all(&pool).await.unwrap();
            assert_eq!(kept, vec!["01", "02", "nced", "special", "sub"]);
            if official_links {
                let manual: String = sqlx::query_scalar("SELECT match_method FROM media_episode_links WHERE media_file_id='01' AND work_id='s1'")
                    .fetch_one(&pool).await.unwrap();
                assert_eq!(manual, "manual");
            }
            let history = crate::recognition_history::list(&pool).await.unwrap();
            let entry = serde_json::to_value(&history[0]).unwrap();
            assert_eq!(entry["fileCount"], 2);
            crate::recognition_history::undo(&pool, entry["id"].as_str().unwrap()).await.unwrap();
            let restored: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='13'").fetch_one(&pool).await.unwrap();
            assert_eq!(restored.as_deref(), assigned.then_some("s1"));
            let original: String = sqlx::query_scalar("SELECT notes FROM works WHERE id='s1'").fetch_one(&pool).await.unwrap();
            assert_eq!(original, "保留笔记");
        }
    }

    /// 同一个作品文件夹里，先前单独识别过一部分文件后，再识别整个文件夹
    /// （作品文件夹范围）应该并入那部作品，而不是新建重复作品。
    #[tokio::test]
    async fn folder_confirmation_merges_pending_files_into_the_linked_work() {
        let pool = db::test_pool().await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            pool: pool.clone(), database_path: dir.path().join("test.db"),
            data_directory: dir.path().into(), cover_cache_path: dir.path().into(),
            thumbnail_cache_path: dir.path().into(),
        };
        sqlx::query("INSERT INTO library_roots (id,path,kind,enabled,created_at,updated_at) VALUES ('root','C:\\Anime','video',1,'now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO works (id,title,type,created_at,updated_at) VALUES ('w','示例动画','video','now','now')").execute(&pool).await.unwrap();
        for (id, path, file_name, work) in [
            ("linked", r"C:\Anime\Show\01.mkv", "01.mkv", Some("w")),
            ("pending", r"C:\Anime\Show\02.mkv", "02.mkv", None),
        ] {
            sqlx::query("INSERT INTO media_files (id,work_id,library_root_id,path,file_name,extension,media_type,recognition_status,created_at,updated_at) VALUES (?,?,'root',?,?,'mkv','video','candidate_pending','now','now')")
                .bind(id).bind(work).bind(path).bind(file_name).execute(&pool).await.unwrap();
        }
        let metadata = crate::explore::lookup_title("葬送的芙莉莲").unwrap().remove(0);
        sqlx::query("INSERT INTO match_candidates (id,media_file_id,provider,external_id,title,aliases_json,subject_type,confidence,match_reasons_json,metadata_json,created_at) VALUES ('c','pending','bangumi',?,?,'[]','tv',0.79,'[]',?,'now')")
            .bind(&metadata.external_id).bind(&metadata.title).bind(serde_json::to_string(&metadata).unwrap()).execute(&pool).await.unwrap();

        let work_id = confirm_candidate_local_selected(&state, "pending", "c", &["pending".into()], crate::grouping::GroupScope::Folder)
            .await
            .unwrap();
        assert_eq!(work_id, "w");
        let merged: Vec<String> = sqlx::query_scalar("SELECT id FROM media_files WHERE work_id = 'w' ORDER BY id")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(merged, vec!["linked", "pending"]);
        let works: i64 = sqlx::query_scalar("SELECT count(*) FROM works").fetch_one(&pool).await.unwrap();
        assert_eq!(works, 1);
    }

    /// 季度范围仍然按季拆分成各自的作品，不会把第二季悄悄并进第一季。
    #[tokio::test]
    async fn season_confirmation_keeps_later_seasons_in_their_own_work() {
        let pool = db::test_pool().await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            pool: pool.clone(), database_path: dir.path().join("test.db"),
            data_directory: dir.path().into(), cover_cache_path: dir.path().into(),
            thumbnail_cache_path: dir.path().into(),
        };
        sqlx::query("INSERT INTO library_roots (id,path,kind,enabled,created_at,updated_at) VALUES ('root','C:\\Anime','video',1,'now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO works (id,title,type,created_at,updated_at) VALUES ('w','示例动画','video','now','now')").execute(&pool).await.unwrap();
        for (id, path, file_name, work) in [
            ("s1", r"C:\Anime\Show\第一季\01.mkv", "01.mkv", Some("w")),
            ("s2", r"C:\Anime\Show\第二季\01.mkv", "01.mkv", None),
        ] {
            sqlx::query("INSERT INTO media_files (id,work_id,library_root_id,path,file_name,extension,media_type,recognition_status,created_at,updated_at) VALUES (?,?,'root',?,?,'mkv','video','candidate_pending','now','now')")
                .bind(id).bind(work).bind(path).bind(file_name).execute(&pool).await.unwrap();
        }
        let metadata = crate::explore::lookup_title("葬送的芙莉莲").unwrap().remove(0);
        sqlx::query("INSERT INTO match_candidates (id,media_file_id,provider,external_id,title,aliases_json,subject_type,confidence,match_reasons_json,metadata_json,created_at) VALUES ('c','s2','bangumi',?,?,'[]','tv',0.79,'[]',?,'now')")
            .bind(&metadata.external_id).bind(&metadata.title).bind(serde_json::to_string(&metadata).unwrap()).execute(&pool).await.unwrap();

        let work_id = confirm_candidate_local_selected(&state, "s2", "c", &["s2".into()], crate::grouping::GroupScope::Season)
            .await
            .unwrap();
        assert_ne!(work_id, "w");
        let first_season: Vec<String> = sqlx::query_scalar("SELECT id FROM media_files WHERE work_id = 'w'")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(first_season, vec!["s1"]);
    }

    #[tokio::test]
    async fn indexed_recognition_returns_unique_candidates_without_detail_network_requests() {
        let pool = db::test_pool().await.unwrap();
        let provider = BangumiProvider::new().unwrap();
        let parsed = parse_folder_name("葬送的芙莉莲");
        let results = tokio::time::timeout(
            StdDuration::from_secs(2),
            search_provider(&pool, "葬送的芙莉莲", &provider, &parsed),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(!results.is_empty());
        assert_eq!(
            results.len(),
            results
                .iter()
                .map(|item| &item.external_id)
                .collect::<HashSet<_>>()
                .len()
        );
        let second = search_provider(&pool, "葬送的芙莉莲", &provider, &parsed)
            .await
            .unwrap();
        assert_eq!(results.len(), second.len());
        let details: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM metadata_cache WHERE cache_key LIKE 'detail:%'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(details, 0);
    }

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

    #[tokio::test]
    async fn moving_special_group_preserves_tv_work_and_clears_old_links() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        for (id, title) in [("tv", "Show TV"), ("oad", "Show OAD")] {
            sqlx::query("INSERT INTO works (id, title, type, notes, favorite, created_at, updated_at) VALUES (?, ?, 'video', '私人笔记', 1, ?, ?)")
                .bind(id).bind(title).bind(&now).bind(&now).execute(&pool).await.unwrap();
        }
        for (id, name) in [
            ("tv1", "Show - 01.mkv"),
            ("oad1", "Show OAD 01.mkv"),
            ("oad2", "Show OAD 02.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'tv', ?, ?, 'mkv', 'video', ?, ?)")
                .bind(id).bind(format!(r"C:\Anime\Show\{name}")).bind(name).bind(&now).bind(&now).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, fetched_at) VALUES ('tv', 'bangumi', 'ep1', 1, 1, ?)")
            .bind(&now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES ('oad1', 'tv', 'bangumi', 'ep1', 'manual', 1, ?)")
            .bind(&now).execute(&pool).await.unwrap();
        let group = grouping::recognition_group_context(&pool, "oad1")
            .await
            .unwrap()
            .unwrap();
        let ids: Vec<_> = group.members.into_iter().map(|file| file.id).collect();
        assert_eq!(ids.len(), 2);
        let mut tx = pool.begin().await.unwrap();
        let new_id = recognition_target_work(&mut tx, None, Some("tv"), &ids)
            .await
            .unwrap();
        assert_ne!(new_id, "tv");
        assert_eq!(
            recognition_target_work(&mut tx, Some("oad".into()), Some("tv"), &ids)
                .await
                .unwrap(),
            "oad"
        );
        move_recognition_group(&mut tx, &ids, "oad", &now)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let assignments: Vec<(String, String)> =
            sqlx::query_as("SELECT id, work_id FROM media_files ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            assignments,
            vec![
                ("oad1".into(), "oad".into()),
                ("oad2".into(), "oad".into()),
                ("tv1".into(), "tv".into())
            ]
        );
        let old_links: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM media_episode_links WHERE media_file_id = 'oad1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(old_links, 0);
        let original: (String, String, bool) =
            sqlx::query_as("SELECT title, notes, favorite FROM works WHERE id = 'tv'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(original, ("Show TV".into(), "私人笔记".into(), true));
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(
            recognition_target_work(&mut tx, None, Some("oad"), &ids)
                .await
                .unwrap(),
            "oad"
        );
    }

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
