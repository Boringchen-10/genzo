use crate::bangumi::BangumiProvider;
use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::metadata;
use crate::models::{AnimeEpisodeEntry, AnimeSeasonOption, AnimeWorkStructure, MediaFile};
use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MEDIA_COLUMNS: &str = "id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path";

fn has_mixed_installments(files: &[MediaFile]) -> bool {
    files
        .iter()
        .filter(|file| file.media_type == "video")
        .map(|file| {
            let parsed = crate::anime_parser::parse_media_path(
                &file.file_name,
                Path::new(&crate::remote_storage::display_path(&file.path)),
                None,
            );
            (parsed.season.unwrap_or(1), parsed.special_type)
        })
        .collect::<HashSet<_>>()
        .len()
        > 1
}

/// Bangumi 分集类型：0 正片、1 特别篇、2 OP、3 ED、4 预告、5 MAD、6 其他。
const EPISODE_TYPE_MAIN: u32 = 0;
const EPISODE_TYPE_SPECIAL: u32 = 1;
const EPISODE_TYPE_OPENING: u32 = 2;
const EPISODE_TYPE_ENDING: u32 = 3;

fn marker_matches(token: &str, base: &str) -> bool {
    token == base
        || (token.starts_with(base)
            && token[base.len()..].chars().all(|value| value.is_ascii_digit()))
}

fn bracket_tokens(file_name: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    for segment in file_name.split(['[', '(', '【', '（']).skip(1) {
        let Some(end) = segment.find([']', ')', '】', '）']) else {
            continue;
        };
        for token in segment[..end].split(|value: char| !value.is_ascii_alphanumeric()) {
            if !token.is_empty() {
                tokens.push(token.to_ascii_uppercase());
            }
        }
    }
    tokens
}

/// 片头/片尾素材的标记，返回对应的 Bangumi 分集类型。
/// `NCOP`/`NCED` 在任何位置都算数；单独的 `OP`/`ED` 只认括号里的标记，
/// 避免把标题里的字母当成片头片尾。
fn creditless_marker(file_name: &str) -> Option<u32> {
    let upper = file_name.to_ascii_uppercase();
    let plain = upper
        .split(|value: char| !value.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    let bracketed = bracket_tokens(file_name);
    if plain.iter().any(|token| marker_matches(token, "NCOP"))
        || bracketed.iter().any(|token| marker_matches(token, "OP"))
    {
        return Some(EPISODE_TYPE_OPENING);
    }
    if plain.iter().any(|token| marker_matches(token, "NCED"))
        || bracketed.iter().any(|token| marker_matches(token, "ED"))
    {
        return Some(EPISODE_TYPE_ENDING);
    }
    None
}

/// 作品锚定的 Bangumi 条目季数：同一文件夹里其它季度的文件不能算进本作品分集。
async fn work_anchor_season(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
) -> AppResult<Option<i64>> {
    let json: Option<String> = sqlx::query_scalar(
        "SELECT response_json FROM metadata_provider_records WHERE work_id = ? AND provider = 'bangumi'",
    )
    .bind(work_id)
    .fetch_optional(&mut **transaction)
    .await?;
    Ok(json
        .and_then(|value| serde_json::from_str::<crate::models::WorkMetadata>(&value).ok())
        .and_then(|metadata| metadata.season))
}

pub async fn rebuild_episode_links(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
) -> AppResult<()> {
    let tmdb_primary: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM work_external_ids WHERE work_id=? AND provider='tmdb') AND NOT EXISTS(SELECT 1 FROM work_external_ids WHERE work_id=? AND provider='bangumi')")
        .bind(work_id).bind(work_id).fetch_one(&mut **transaction).await?;
    if tmdb_primary { return crate::film_tv::rebuild_links(transaction, work_id).await; }
    sqlx::query("DELETE FROM media_episode_links WHERE work_id = ? AND match_method = 'parsed'")
        .bind(work_id)
        .execute(&mut **transaction)
        .await?;
    let files = sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE work_id = ?"
    ))
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?;
    let manual_media_ids = sqlx::query_scalar::<_, String>(
        "SELECT media_file_id FROM media_episode_links WHERE work_id = ? AND match_method = 'manual'",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .collect::<HashSet<_>>();

    // 官方分集按类型分组：正片按集号，特别篇与 OP/ED 各自按顺序，
    // 避免把 OVA、片头片尾当成同号正片。
    let episodes = sqlx::query_as::<_, (String, Option<i64>, Option<i64>)>(
        "SELECT external_id, episode_number, episode_type FROM anime_episodes WHERE work_id = ? AND provider = 'bangumi' ORDER BY sort_number, episode_number",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?;
    let mut main_by_number: HashMap<i64, String> = HashMap::new();
    let mut specials: Vec<String> = Vec::new();
    let mut openings: Vec<String> = Vec::new();
    let mut endings: Vec<String> = Vec::new();
    for (external_id, number, episode_type) in episodes {
        match episode_type.and_then(|value| u32::try_from(value).ok()) {
            Some(EPISODE_TYPE_SPECIAL) => specials.push(external_id),
            Some(EPISODE_TYPE_OPENING) => openings.push(external_id),
            Some(EPISODE_TYPE_ENDING) => endings.push(external_id),
            // 旧记录没有类型，按正片处理；预告/MAD/其他不参与自动分集。
            Some(EPISODE_TYPE_MAIN) | None => {
                if let Some(number) = number {
                    main_by_number.entry(number).or_insert(external_id);
                }
            }
            Some(_) => {}
        }
    }
    if main_by_number.is_empty() && specials.is_empty() && openings.is_empty() && endings.is_empty() {
        return Ok(());
    }

    let anchor_season = work_anchor_season(transaction, work_id).await?;
    // 用文件名重新解析，不信任可能过期的 parsed_* 列。
    let parsed_files = files
        .iter()
        .filter(|file| {
            file.media_type == "video" && !file.missing && !manual_media_ids.contains(&file.id)
        })
        .map(|file| {
            let parsed = crate::anime_parser::parse_media_path(
                &file.file_name,
                Path::new(&crate::remote_storage::display_path(&file.path)),
                None,
            );
            (file, parsed)
        })
        .collect::<Vec<_>>();
    // 没有 Bangumi 季度信息又混装多个季度时，退回保守做法，不猜集号。
    // 这里必须看全部视频文件（含手动关联过的），否则同一作品里的另一季会被误判成单季。
    let mut main_seasons = HashSet::new();
    for file in files.iter().filter(|file| file.media_type == "video") {
        let parsed = crate::anime_parser::parse_media_path(
            &file.file_name,
            Path::new(&crate::remote_storage::display_path(&file.path)),
            None,
        );
        if parsed.special_type.is_none() && creditless_marker(&file.file_name).is_none() {
            main_seasons.insert(parsed.season.unwrap_or(1));
        }
    }
    let link_main = anchor_season.is_some() || main_seasons.len() <= 1;

    let mut claims: Vec<(String, String)> = Vec::new();
    let mut special_claims: Vec<(i64, String, String)> = Vec::new();
    let mut opening_claims: Vec<(bool, i64, String, String)> = Vec::new();
    let mut ending_claims: Vec<(bool, i64, String, String)> = Vec::new();
    for (file, parsed) in &parsed_files {
        let episode_number = parsed
            .episode
            .as_deref()
            .and_then(|value| value.trim().parse::<i64>().ok());
        if let Some(kind) = creditless_marker(&file.file_name) {
            let creditless = file.file_name.to_ascii_uppercase().contains("NC");
            let claim = (creditless, episode_number.unwrap_or(1), file.file_name.clone(), file.id.clone());
            if kind == EPISODE_TYPE_OPENING {
                opening_claims.push(claim);
            } else {
                ending_claims.push(claim);
            }
            continue;
        }
        if parsed.special_type.is_some() {
            // 特别篇按文件里的序号对应同序号的特别篇；没有序号就不猜。
            if let Some(ordinal) = episode_number {
                special_claims.push((ordinal, file.file_name.clone(), file.id.clone()));
            }
            continue;
        }
        if !link_main {
            continue;
        }
        if let Some(anchor) = anchor_season {
            if parsed.season.is_some_and(|value| value != anchor) {
                continue;
            }
        }
        if let Some(number) = episode_number {
            if let Some(episode_external_id) = main_by_number.get(&number) {
                claims.push((file.id.clone(), episode_external_id.clone()));
            }
        }
    }
    for (ordinal, _, media_file_id) in &special_claims {
        if let Some(episode_external_id) = ordinal
            .checked_sub(1)
            .and_then(|index| usize::try_from(index).ok())
            .and_then(|index| specials.get(index))
        {
            claims.push((media_file_id.clone(), episode_external_id.clone()));
        }
    }
    for (claims_for_type, episodes_for_type) in [
        (&mut opening_claims, &openings),
        (&mut ending_claims, &endings),
    ] {
        // 先正片头尾再 NC 版，其余按序号和文件名稳定排序。
        claims_for_type.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then(left.1.cmp(&right.1))
                .then(natord::compare_ignore_case(&left.2, &right.2))
        });
        for (index, (_, _, _, media_file_id)) in claims_for_type.iter().enumerate() {
            if let Some(episode_external_id) = episodes_for_type.get(index) {
                claims.push((media_file_id.clone(), episode_external_id.clone()));
            }
        }
    }

    let now = Utc::now().to_rfc3339();
    let mut linked = HashSet::new();
    for (media_file_id, episode_external_id) in claims {
        if !linked.insert(media_file_id.clone()) {
            continue;
        }
        sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, ?, 'bangumi', ?, 'parsed', 1, ?)")
            .bind(&media_file_id)
            .bind(work_id)
            .bind(&episode_external_id)
            .bind(&now)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

pub async fn set_episode_link(
    pool: &SqlitePool,
    media_file_id: &str,
    episode_external_id: Option<&str>,
) -> AppResult<()> {
    let (_write_guard, mut transaction) = crate::db::begin_write(pool).await?;
    let work_id: String =
        sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = ? AND work_id IS NOT NULL")
            .bind(media_file_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or_else(|| AppError::Validation("该文件尚未关联作品".to_string()))?;
    sqlx::query("DELETE FROM media_episode_links WHERE media_file_id = ?")
        .bind(media_file_id)
        .execute(&mut *transaction)
        .await?;
    if let Some(episode_external_id) = episode_external_id {
        let provider: Option<String> = sqlx::query_scalar("SELECT provider FROM anime_episodes WHERE work_id = ? AND provider IN ('bangumi','tmdb') AND external_id = ?")
            .bind(&work_id)
            .bind(episode_external_id)
            .fetch_optional(&mut *transaction)
            .await?;
        let provider = provider.ok_or_else(|| AppError::NotFound("官方分集不存在".into()))?;
        sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, ?, ?, ?, 'manual', 1, ?)")
            .bind(media_file_id)
            .bind(&work_id)
            .bind(provider)
            .bind(episode_external_id)
            .bind(Utc::now().to_rfc3339())
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}

pub async fn work_structure(pool: &SqlitePool, work_id: &str) -> AppResult<AnimeWorkStructure> {
    if let Some(id) = crate::film_tv::anchor(pool, work_id).await? {
        return crate::film_tv::structure(pool, work_id, &id).await;
    }
    let bangumi_id: String = sqlx::query_scalar(
        "SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = 'bangumi'",
    )
    .bind(work_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Validation("该作品尚未关联 Bangumi 条目".to_string()))?;
    let (title, original_title, cover_path): (String, Option<String>, Option<String>) =
        sqlx::query_as("SELECT title, original_title, cover_path FROM works WHERE id = ?")
            .bind(work_id)
            .fetch_one(pool)
            .await?;
    let provider = BangumiProvider::new()?;
    let (related, related_warning) = cached_or_fetch(
        pool,
        &format!("structure:{bangumi_id}:relations"),
        provider.related_subjects(&bangumi_id),
    )
    .await;
    let (staff, staff_warning) = cached_or_fetch(
        pool,
        &format!("structure:{bangumi_id}:staff"),
        provider.staff(&bangumi_id),
    )
    .await;
    let (characters, character_warning) = cached_or_fetch(
        pool,
        &format!("structure:{bangumi_id}:characters"),
        provider.characters(&bangumi_id),
    )
    .await;
    let mut warnings = [related_warning, staff_warning, character_warning]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let mut seasons: Vec<AnimeSeasonOption> = related.unwrap_or_default();
    for season in &mut seasons {
        season.local_work_id = sqlx::query_scalar(
            "SELECT work_id FROM work_external_ids WHERE provider = 'bangumi' AND external_id = ?",
        )
        .bind(&season.external_id)
        .fetch_optional(pool)
        .await?;
    }
    seasons.insert(
        0,
        AnimeSeasonOption {
            external_id: bangumi_id.clone(),
            title,
            original_title,
            relation: "当前作品".to_string(),
            season_number: None,
            cover_url: cover_path,
            local_work_id: Some(work_id.to_string()),
            current: true,
        },
    );
    let official = crate::metadata_aggregator::episodes_for_work(pool, work_id).await?;
    if official.is_empty() {
        warnings.push("尚未缓存官方分集，请先刷新作品元数据".to_string());
    } else if official
        .iter()
        .all(|episode| episode.episode_type.is_none())
    {
        // 旧记录只抓过正片，OVA/OP/ED 无法归类，也无法自动分集这些素材。
        warnings.push("官方分集缺少类型信息，刷新作品元数据后可以自动分集特别篇与 OP/ED".to_string());
    }
    let linked = sqlx::query_as::<_, (String, String, String)>(
        "SELECT media_file_id, episode_external_id, match_method FROM media_episode_links WHERE work_id = ? AND provider IN ('bangumi', 'local')",
    )
    .bind(work_id)
    .fetch_all(pool)
    .await?;
    let media = sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE work_id = ? ORDER BY parsed_season, parsed_episode_start, file_name COLLATE NOCASE"
    ))
    .bind(work_id)
    .fetch_all(pool)
    .await?;
    let mixed = has_mixed_installments(&media);
    if mixed {
        warnings.push("同一作品里混有不同季度或特别篇：只有与本作品季度一致的文件会自动分集，其余请在文件操作中选择“识别到其他作品”。".to_string());
    }
    let linked = linked
        .into_iter()
        .map(|(id, episode, _)| (id, episode))
        .collect::<HashMap<_, _>>();
    let mut files_by_episode: HashMap<String, Vec<MediaFile>> = HashMap::new();
    let mut unmatched_files = Vec::new();
    for file in media {
        if let Some(episode_id) = linked.get(&file.id) {
            files_by_episode
                .entry(episode_id.clone())
                .or_default()
                .push(file);
        } else if file.media_type == "video" {
            unmatched_files.push(file);
        }
    }
    let episodes = official
        .into_iter()
        .map(|episode| AnimeEpisodeEntry {
            image_url: None,
            local_files: files_by_episode
                .remove(&episode.external_id)
                .unwrap_or_default(),
            episode,
        })
        .collect();
    Ok(AnimeWorkStructure {
        work_id: work_id.to_string(),
        bangumi_id,
        seasons,
        episodes,
        unmatched_files,
        staff: staff.unwrap_or_default(),
        characters: characters.unwrap_or_default(),
        warnings,
    })
}

pub async fn refresh_work_metadata(
    state: &AppState,
    app: &AppHandle,
    work_id: &str,
) -> AppResult<AnimeWorkStructure> {
    if let Some(id) = crate::film_tv::anchor(&state.pool, work_id).await? {
        match crate::film_tv::enrich(state, work_id, &id, true).await {
            Ok(paths) => {
                for path in paths { db::allow_cover_file(app, Path::new(&path))?; }
                return crate::film_tv::structure(&state.pool, work_id, &id).await;
            }
            Err(error) => {
                let mut structure = crate::film_tv::structure(&state.pool, work_id, &id).await?;
                structure.warnings.push(format!("{error}；已有作品资料已保留"));
                return Ok(structure);
            }
        }
    }
    let bangumi_id: String = sqlx::query_scalar(
        "SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = 'bangumi'",
    )
    .bind(work_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Validation("该作品尚未关联 Bangumi 条目".to_string()))?;
    let primary = BangumiProvider::new()?.get_details(&bangumi_id).await?;
    let aggregation = crate::metadata_aggregator::aggregate_fresh(&state.pool, primary).await?;
    let cover_path = cache_artwork(
        aggregation.metadata.cover_url.as_deref(),
        state
            .cover_cache_path
            .join(format!("bangumi-{bangumi_id}.jpg")),
        true,
    )
    .await;
    let banner_path = cache_artwork(
        aggregation.metadata.banner_url.as_deref(),
        state
            .cover_cache_path
            .join(format!("bangumi-{bangumi_id}-banner.jpg")),
        false,
    )
    .await;
    let now = Utc::now().to_rfc3339();
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    metadata::apply_metadata(
        &mut transaction,
        work_id,
        &aggregation.metadata,
        cover_path.clone(),
        banner_path.clone(),
        &now,
    )
    .await?;
    crate::metadata_aggregator::persist_for_work(&mut transaction, work_id, &aggregation).await?;
    rebuild_episode_links(&mut transaction, work_id).await?;
    transaction.commit().await?;
    for path in [cover_path, banner_path].into_iter().flatten() {
        db::allow_cover_file(app, Path::new(&path))?;
    }
    work_structure(&state.pool, work_id).await
}

pub async fn media_thumbnail(
    state: &AppState,
    app: &AppHandle,
    media_file_id: &str,
    force: bool,
) -> AppResult<Option<String>> {
    let result = media_thumbnail_path(state, media_file_id, force).await?;
    if let Some(path) = &result {
        db::allow_cover_file(app, Path::new(path))?;
    }
    Ok(result)
}

async fn media_thumbnail_path(
    state: &AppState,
    media_file_id: &str,
    force: bool,
) -> AppResult<Option<String>> {
    media_thumbnail_with(state, media_file_id, force, crate::thumbnail::extract_on_demand).await
}

async fn media_thumbnail_with<F, Fut>(
    state: &AppState,
    media_file_id: &str,
    force: bool,
    extract: F,
) -> AppResult<Option<String>>
where
    F: FnOnce(PathBuf, PathBuf, bool) -> Fut,
    Fut: Future<Output = AppResult<Option<bool>>>,
{
    let (path, media_type, missing, cached, modified_at): (String, String, bool, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT path, media_type, missing, thumbnail_path, modified_at FROM media_files WHERE id = ?",
        )
        .bind(media_file_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
    if media_type != "video" {
        return Ok(None);
    }
    // Cached snapshots remain useful when a mount is disconnected or its file
    // is unavailable. Check app-local cache before testing source availability.
    if let Some(cached) = cached
        .as_deref()
        .filter(|value| *value != "__unsupported__")
    {
        if Path::new(cached).is_file() {
            return Ok(Some(cached.to_string()));
        }
    }
    let mounted: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files m JOIN library_roots r ON r.id=m.library_root_id WHERE m.id=? AND r.source_type='mounted')")
        .bind(media_file_id).fetch_one(&state.pool).await?;
    if missing || path.starts_with("webdav://") {
        return Ok(None);
    }
    // A mount failure must not become a permanent negative cache entry.
    if !mounted && cached.as_deref() == Some("__unsupported__") {
        return Ok(None);
    }
    let source = PathBuf::from(&path);
    let destination = state
        .thumbnail_cache_path
        .join(format!("media-{media_file_id}.jpg"));
    // 挂载网盘上的大文件完整提取往往要读整段视频，自动加载只查 Windows 缓存；
    // 用户点「重试缩略图」时 force 为真，才做一次完整提取。
    let cache_only = mounted && !force;
    let Some(created) = extract(source, destination.clone(), cache_only).await? else {
        return Ok(None);
    };
    if !created {
        if !mounted {
            sqlx::query("UPDATE media_files SET thumbnail_path = '__unsupported__' WHERE id = ? AND path = ? AND modified_at IS ?")
                .bind(media_file_id).bind(&path).bind(&modified_at)
                .execute(&state.pool).await?;
        }
        return Ok(None);
    }
    let stored = destination.to_string_lossy().to_string();
    sqlx::query(
        "UPDATE media_files SET thumbnail_path = ? WHERE id = ? AND path = ? AND modified_at IS ?",
    )
    .bind(&stored)
    .bind(media_file_id)
    .bind(&path)
    .bind(&modified_at)
    .execute(&state.pool)
    .await?;
    Ok(Some(stored))
}

async fn cache_artwork(url: Option<&str>, destination: PathBuf, cover: bool) -> Option<String> {
    let url = url?;
    let destination = crate::metadata_aggregator::artwork_cache_path(
        destination.parent()?, destination.file_stem()?.to_str()?.trim_end_matches("-banner"),
        if cover { "cover" } else { "banner" }, url,
    );
    let result = if destination.is_file() {
        Ok(())
    } else if cover {
        crate::metadata_aggregator::cache_cover(url, &destination).await
    } else {
        crate::metadata_aggregator::cache_banner(url, &destination).await
    };
    result
        .is_ok()
        .then(|| destination.to_string_lossy().to_string())
}

async fn cached_or_fetch<T, F>(
    pool: &SqlitePool,
    key: &str,
    _future: F,
) -> (Option<T>, Option<String>)
where
    T: Serialize + DeserializeOwned,
    F: Future<Output = AppResult<T>>,
{
    let cached: Option<(String, String)> = sqlx::query_as(
        "SELECT response_json, expires_at FROM metadata_cache WHERE provider = 'bangumi' AND cache_key = ?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    if let Some((json, expires_at)) = &cached {
        if let Ok(value) = serde_json::from_str(json) {
            let warning = (expires_at <= &Utc::now().to_rfc3339())
                .then(|| "使用已过期的本地动画结构缓存，请点击刷新元数据".to_string());
            return (Some(value), warning);
        }
    }
    let _ = pool;
    (
        None,
        Some("尚未缓存动画扩展结构，请点击刷新元数据".to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[tokio::test]
    async fn mounted_thumbnails_retry_and_use_cache_while_offline() {
        let pool = db::test_pool().await.unwrap();
        let directory = tempfile::tempdir().unwrap();
        let state = AppState {
            pool,
            database_path: directory.path().join("test.db"),
            data_directory: directory.path().into(),
            cover_cache_path: directory.path().join("covers"),
            thumbnail_cache_path: directory.path().join("thumbnails"),
        };
        sqlx::query("INSERT INTO library_roots(id,path,kind,source_type,created_at,updated_at) VALUES ('r','R:\\Anime','video','mounted','now','now')").execute(&state.pool).await.unwrap();
        let raw = r"\\?\UNC\server\share\01.mkv";
        sqlx::query("INSERT INTO media_files(id,library_root_id,path,file_name,extension,media_type,thumbnail_path,created_at,updated_at) VALUES ('m','r',?,'01.mkv','mkv','video','__unsupported__','now','now')").bind(raw).execute(&state.pool).await.unwrap();
        let failed = media_thumbnail_with(&state, "m", false, |source, _, cache_only| async move {
            assert_eq!(source, Path::new(raw)); // original persisted path reaches the boundary
            assert!(cache_only, "自动加载挂载目录的缩略图必须只查缓存");
            Ok(Some(false))
        })
        .await
        .unwrap();
        assert!(failed.is_none());
        let image = media_thumbnail_with(&state, "m", false, |_, destination, _| async move {
            std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
            image::RgbImage::new(160, 90).save(&destination).unwrap();
            Ok(Some(true))
        })
        .await
        .unwrap()
        .unwrap();
        sqlx::query("UPDATE media_files SET missing=1")
            .execute(&state.pool)
            .await
            .unwrap();
        let cached = media_thumbnail_with(&state, "m", false, |_, _, _| async {
            panic!("cached image must not touch the disconnected mount")
        })
        .await
        .unwrap();
        assert_eq!(cached, Some(image));
        // 用户显式重试时必须允许完整提取，否则挂载目录永远拿不到缩略图。
        sqlx::query("UPDATE media_files SET thumbnail_path=NULL, missing=0")
            .execute(&state.pool)
            .await
            .unwrap();
        let forced = media_thumbnail_with(&state, "m", true, |_, destination, cache_only| async move {
            assert!(!cache_only, "显式重试必须走完整提取");
            std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
            image::RgbImage::new(160, 90).save(&destination).unwrap();
            Ok(Some(true))
        })
        .await
        .unwrap();
        assert!(forced.is_some());
        let stored: String = sqlx::query_scalar("SELECT path FROM media_files WHERE id='m'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(stored, raw);
    }

    #[tokio::test]
    async fn mixed_installments_do_not_share_automatic_episode_links() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', 'Show', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, fetched_at) VALUES ('work', 'bangumi', 'ep1', 1, 1, ?)")
            .bind(&now).execute(&pool).await.unwrap();
        for (id, name) in [
            ("tv", "Show - 01.mkv"),
            ("oad", "Show OAD 01.mkv"),
            ("s2", "Show S2 - 01.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, parsed_episode_start, created_at, updated_at) VALUES (?, 'work', ?, ?, 'mkv', 'video', 1, ?, ?)")
                .bind(id).bind(format!(r"C:\Anime\Show\{name}")).bind(name).bind(&now).bind(&now).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, 'work', 'bangumi', 'ep1', ?, 1, ?)")
                .bind(id).bind(if id == "tv" { "manual" } else { "parsed" }).bind(&now).execute(&pool).await.unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        rebuild_episode_links(&mut tx, "work").await.unwrap();
        tx.commit().await.unwrap();
        let links: Vec<(String, String)> =
            sqlx::query_as("SELECT media_file_id, match_method FROM media_episode_links")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(links, vec![("tv".into(), "manual".into())]);
    }

    #[tokio::test]
    async fn parsed_mapping_allows_multiple_local_versions_per_episode() {
        let pool = db::test_pool().await.expect("database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '动画', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("work");
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, title, fetched_at) VALUES ('work', 'bangumi', 'ep1', 1, 1, '第一集', ?)")
            .bind(&now).execute(&pool).await.expect("episode");
        for (id, name) in [("1080p", "01 [1080p].mkv"), ("4k", "01 [2160p].mkv")] {
            sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, size, missing, parsed_episode_start, created_at, updated_at) VALUES (?, 'work', ?, ?, 'mkv', 'video', 10, 0, 1, ?, ?)")
                .bind(id).bind(format!("C:\\Anime\\{name}")).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("media");
        }
        let mut transaction = pool.begin().await.expect("transaction");
        rebuild_episode_links(&mut transaction, "work")
            .await
            .expect("mapping");
        transaction.commit().await.expect("commit");
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM media_episode_links WHERE episode_external_id = 'ep1'",
        )
        .fetch_one(&pool)
        .await
        .expect("count links");
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn maps_specials_and_creditless_opening_ending_to_their_own_episodes() {
        let pool = db::test_pool().await.expect("database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '动画', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("work");
        for (id, number, sort, episode_type) in [
            ("ep1", 1_i64, 1_i64, 0_i64),
            ("sp1", 1, 11, 1),
            ("sp2", 2, 12, 1),
            ("op1", 1, 21, 2),
            ("op2", 2, 22, 2),
            ("ed1", 1, 31, 3),
        ] {
            sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, episode_type, title, fetched_at) VALUES ('work', 'bangumi', ?, ?, ?, ?, '', ?)")
                .bind(id).bind(number).bind(sort).bind(episode_type).bind(&now).execute(&pool).await.expect("episode");
        }
        for (id, name) in [
            ("tv", "Show - 01.mkv"),
            ("ova1", "Show OVA 01.mkv"),
            ("ova2", "Show OVA 02.mkv"),
            ("op", "Show [OP][1080p].mkv"),
            ("ncop", "Show [NCOP][1080p].mkv"),
            ("ed", "Show [ED][1080p].mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, size, missing, created_at, updated_at) VALUES (?, 'work', ?, ?, 'mkv', 'video', 10, 0, ?, ?)")
                .bind(id).bind(format!("C:\\Anime\\Show\\{name}")).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("media");
        }
        let mut transaction = pool.begin().await.expect("transaction");
        rebuild_episode_links(&mut transaction, "work").await.expect("mapping");
        transaction.commit().await.expect("commit");
        let links: Vec<(String, String)> =
            sqlx::query_as("SELECT media_file_id, episode_external_id FROM media_episode_links ORDER BY media_file_id")
                .fetch_all(&pool).await.expect("links");
        assert_eq!(
            links,
            vec![
                ("ed".to_string(), "ed1".to_string()),
                ("ncop".to_string(), "op2".to_string()),
                ("op".to_string(), "op1".to_string()),
                ("ova1".to_string(), "sp1".to_string()),
                ("ova2".to_string(), "sp2".to_string()),
                ("tv".to_string(), "ep1".to_string()),
            ]
        );
    }

    /// 同一文件夹里混装了别的季度时，只能自动分集本作品季度内的文件。
    #[tokio::test]
    async fn only_links_files_from_the_anchored_season() {
        let pool = db::test_pool().await.expect("database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '动画', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("work");
        let mut metadata = crate::explore::lookup_title("葬送的芙莉莲").expect("index").remove(0);
        metadata.season = Some(1);
        sqlx::query("INSERT INTO metadata_provider_records (work_id, provider, external_id, title, year, confidence, response_json, fetched_at) VALUES ('work', 'bangumi', ?, ?, ?, 1, ?, ?)")
            .bind(&metadata.external_id).bind(&metadata.title).bind(metadata.year).bind(serde_json::to_string(&metadata).unwrap()).bind(&now)
            .execute(&pool).await.expect("record");
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, episode_type, title, fetched_at) VALUES ('work', 'bangumi', 'ep1', 1, 1, 0, '', ?), ('work', 'bangumi', 'ep2', 2, 2, 0, '', ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("episodes");
        for (id, name) in [("s1", "Show - 02.mkv"), ("s2", "Show S2 - 02.mkv")] {
            sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, size, missing, created_at, updated_at) VALUES (?, 'work', ?, ?, 'mkv', 'video', 10, 0, ?, ?)")
                .bind(id).bind(format!("C:\\Anime\\Show\\{name}")).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("media");
        }
        let mut transaction = pool.begin().await.expect("transaction");
        rebuild_episode_links(&mut transaction, "work").await.expect("mapping");
        transaction.commit().await.expect("commit");
        let links: Vec<(String, String)> =
            sqlx::query_as("SELECT media_file_id, episode_external_id FROM media_episode_links")
                .fetch_all(&pool).await.expect("links");
        assert_eq!(links, vec![("s1".to_string(), "ep2".to_string())]);
    }

    #[tokio::test]
    async fn manual_episode_mapping_survives_automatic_rebuild() {
        let pool = db::test_pool().await.expect("database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '动画', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("work");
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, title, fetched_at) VALUES ('work', 'bangumi', 'ep1', 1, 1, '第一集', ?), ('work', 'bangumi', 'ep2', 2, 2, '第二集', ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("episodes");
        sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, size, missing, parsed_episode_start, created_at, updated_at) VALUES ('media', 'work', 'C:\\Anime\\01.mkv', '01.mkv', 'mkv', 'video', 10, 0, 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("media");
        set_episode_link(&pool, "media", Some("ep2"))
            .await
            .expect("manual mapping");
        let mut transaction = pool.begin().await.expect("transaction");
        rebuild_episode_links(&mut transaction, "work")
            .await
            .expect("mapping");
        transaction.commit().await.expect("commit");
        let link: (String, String) = sqlx::query_as("SELECT episode_external_id, match_method FROM media_episode_links WHERE media_file_id = 'media'")
            .fetch_one(&pool).await.expect("link");
        assert_eq!(link, ("ep2".to_string(), "manual".to_string()));
    }
}
