use crate::bangumi::BangumiProvider;
use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::metadata;
use crate::models::{
    AnimeEpisodeEntry, AnimeEpisodeMetadata, AnimeSeasonOption, AnimeWorkStructure, MediaFile,
};
use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MEDIA_COLUMNS: &str = "id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path";

// Local IDs cannot collide with numeric Bangumi IDs. The namespace explicitly
// marks these as unverified, rather than presenting guessed metadata as official.
fn parse_media_with_root(
    file: &MediaFile,
    roots: &HashMap<String, String>,
) -> crate::anime_parser::ParsedAnime {
    let path = crate::remote_storage::display_path(&file.path);
    let root = file
        .library_root_id
        .as_ref()
        .and_then(|id| roots.get(id))
        .map(|value| crate::remote_storage::display_path(value));
    crate::anime_parser::parse_media_path(
        &file.file_name,
        Path::new(&path),
        root.as_deref().map(Path::new),
    )
}

fn local_episode_id(parsed: &crate::anime_parser::ParsedAnime, number: u32) -> String {
    format!(
        "local/unverified:s{}:{}:{number}",
        parsed.season.unwrap_or(1),
        parsed.special_type.as_deref().unwrap_or("tv")
    )
}

fn local_episode_metadata(
    parsed: &crate::anime_parser::ParsedAnime,
    number: u32,
) -> AnimeEpisodeMetadata {
    let kind = parsed.special_type.as_deref().unwrap_or("tv");
    AnimeEpisodeMetadata {
        provider: "local".into(),
        external_id: local_episode_id(parsed, number),
        episode_number: Some(number),
        sort_number: number,
        title: format!(
            "{}第 {number} 集（本地未核实）",
            if kind == "tv" {
                String::new()
            } else {
                format!("{kind} · ")
            }
        ),
        original_title: None,
        description: "local/unverified".into(),
        air_date: None,
        duration: None,
        fetched_at: Utc::now().to_rfc3339(),
    }
}

async fn insert_local_episode(
    tx: &mut Transaction<'_, Sqlite>,
    work_id: &str,
    episode: &AnimeEpisodeMetadata,
) -> AppResult<()> {
    sqlx::query("INSERT INTO anime_episodes (work_id,provider,external_id,episode_number,sort_number,title,description,fetched_at) VALUES (?,'local',?,?,?,?, 'local/unverified',?) ON CONFLICT DO NOTHING")
        .bind(work_id)
        .bind(&episode.external_id)
        .bind(episode.episode_number.map(i64::from))
        .bind(i64::from(episode.sort_number))
        .bind(&episode.title)
        .bind(&episode.fetched_at)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn root_paths(
    executor: impl sqlx::Executor<'_, Database = Sqlite>,
) -> AppResult<HashMap<String, String>> {
    Ok(sqlx::query_as("SELECT id,path FROM library_roots")
        .fetch_all(executor)
        .await?
        .into_iter()
        .collect())
}

/// This runs only in an already user-initiated write operation. Reading a work
/// structure must stay read-only, otherwise initial page loading can race a scan.
async fn ensure_local_episodes(tx: &mut Transaction<'_, Sqlite>, work_id: &str) -> AppResult<()> {
    let files = sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE work_id=? AND media_type='video'"
    ))
    .bind(work_id)
    .fetch_all(&mut **tx)
    .await?;
    let roots = root_paths(&mut **tx).await?;
    let parsed_files = files
        .into_iter()
        .map(|file| (file.clone(), parse_media_with_root(&file, &roots)))
        .collect::<Vec<_>>();
    let tv_seasons = parsed_files
        .iter()
        .filter(|(_, p)| p.special_type.is_none())
        .map(|(_, p)| p.season.unwrap_or(1))
        .collect::<HashSet<_>>();
    let now = Utc::now().to_rfc3339();
    for (file, parsed) in parsed_files {
        let Some(number) = parsed.episode_start.or(file
            .parsed_episode_start
            .and_then(|n| u32::try_from(n).ok()))
        else {
            continue;
        };
        let kind = parsed.special_type.as_deref().unwrap_or("tv");
        let id = format!(
            "local/unverified:s{}:{kind}:{number}",
            parsed.season.unwrap_or(1)
        );
        let official: Option<String> = if kind == "tv" && tv_seasons.len() == 1 {
            sqlx::query_scalar("SELECT external_id FROM anime_episodes WHERE work_id=? AND provider='bangumi' AND episode_number=? AND (SELECT count(*) FROM anime_episodes WHERE work_id=? AND provider='bangumi' AND episode_number=?)=1")
                .bind(work_id).bind(i64::from(number)).bind(work_id).bind(i64::from(number)).fetch_optional(&mut **tx).await?
        } else {
            None
        };
        if let Some(official) = official {
            sqlx::query("UPDATE media_episode_links SET provider='bangumi',episode_external_id=?,updated_at=? WHERE work_id=? AND provider='local' AND episode_external_id=?")
                .bind(official).bind(&now).bind(work_id).bind(&id).execute(&mut **tx).await?;
            sqlx::query(
                "DELETE FROM anime_episodes WHERE work_id=? AND provider='local' AND external_id=?",
            )
            .bind(work_id)
            .bind(&id)
            .execute(&mut **tx)
            .await?;
        } else {
            let mut episode = local_episode_metadata(&parsed, number);
            episode.external_id = id;
            episode.fetched_at = now.clone();
            insert_local_episode(tx, work_id, &episode).await?;
        }
    }
    Ok(())
}

pub async fn rebuild_episode_links(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
) -> AppResult<()> {
    ensure_local_episodes(transaction, work_id).await?;
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
    let roots = root_paths(&mut **transaction).await?;
    let parsed_files = files
        .iter()
        .map(|file| (file, parse_media_with_root(file, &roots)))
        .collect::<Vec<_>>();
    // Episode numbers alone cannot identify episodes in a mixed-season work.
    // Keep explicit manual mappings, and let the user recognize each group first.
    if parsed_files
        .iter()
        .map(|(_, parsed)| (parsed.season.unwrap_or(1), parsed.special_type.clone()))
        .collect::<HashSet<_>>()
        .len()
        > 1
    {
        return Ok(());
    }
    let manual_media_ids = sqlx::query_scalar::<_, String>(
        "SELECT media_file_id FROM media_episode_links WHERE work_id = ? AND match_method = 'manual'",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .collect::<HashSet<_>>();
    let episode_ids = sqlx::query_as::<_, (String, i64)>(
        "SELECT external_id, episode_number FROM anime_episodes WHERE work_id = ? AND provider = 'bangumi' AND episode_number IS NOT NULL GROUP BY episode_number HAVING count(*)=1",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .map(|(id, number)| (number, id))
    .collect::<HashMap<_, _>>();
    let now = Utc::now().to_rfc3339();
    for (file, parsed) in parsed_files {
        if file.media_type != "video" || file.missing || parsed.special_type.is_some() {
            continue;
        }
        let Some(episode_number) = parsed.episode_start.or(file
            .parsed_episode_start
            .and_then(|value| u32::try_from(value).ok()))
        else {
            continue;
        };
        if manual_media_ids.contains(&file.id) {
            continue;
        }
        let Some(episode_external_id) = episode_ids.get(&i64::from(episode_number)) else {
            continue;
        };
        sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, ?, 'bangumi', ?, 'parsed', 1, ?)")
            .bind(&file.id)
            .bind(work_id)
            .bind(episode_external_id)
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
    let mut transaction = pool.begin().await?;
    let work_id: String =
        sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = ? AND work_id IS NOT NULL")
            .bind(media_file_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or_else(|| AppError::Validation("该文件尚未关联作品".to_string()))?;
    if let Some(episode_external_id) = episode_external_id {
        let mut provider: Option<String> = sqlx::query_scalar("SELECT provider FROM anime_episodes WHERE work_id = ? AND external_id = ? AND provider IN ('bangumi','local')")
            .bind(&work_id)
            .bind(episode_external_id)
            .fetch_optional(&mut *transaction)
            .await?;
        if provider.is_none() && episode_external_id.starts_with("local/unverified:") {
            let file = sqlx::query_as::<_, MediaFile>(&format!(
                "SELECT {MEDIA_COLUMNS} FROM media_files WHERE id = ?"
            ))
            .bind(media_file_id)
            .fetch_one(&mut *transaction)
            .await?;
            let roots = root_paths(&mut *transaction).await?;
            let parsed = parse_media_with_root(&file, &roots);
            let number = parsed
                .episode_start
                .or(file
                    .parsed_episode_start
                    .and_then(|value| u32::try_from(value).ok()))
                .ok_or_else(|| {
                    AppError::Validation("文件未解析出集数，不能建立本地占位分集".to_string())
                })?;
            if local_episode_id(&parsed, number) != episode_external_id {
                return Err(AppError::Validation(
                    "本地占位分集不属于这个文件".to_string(),
                ));
            }
            insert_local_episode(
                &mut transaction,
                &work_id,
                &local_episode_metadata(&parsed, number),
            )
            .await?;
            provider = Some("local".to_string());
        }
        let provider = provider.ok_or_else(|| AppError::NotFound("分集不存在".to_string()))?;
        sqlx::query("DELETE FROM media_episode_links WHERE media_file_id = ?")
            .bind(media_file_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, ?, ?, ?, 'manual', 1, ?)")
            .bind(media_file_id)
            .bind(&work_id)
            .bind(provider)
            .bind(episode_external_id)
            .bind(Utc::now().to_rfc3339())
            .execute(&mut *transaction)
            .await?;
    } else {
        sqlx::query("DELETE FROM media_episode_links WHERE media_file_id = ?")
            .bind(media_file_id)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}

pub async fn work_structure(pool: &SqlitePool, work_id: &str) -> AppResult<AnimeWorkStructure> {
    let bangumi_id: String = sqlx::query_scalar(
        "SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = 'bangumi'",
    )
    .bind(work_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or_default();
    let (title, original_title, cover_path): (String, Option<String>, Option<String>) =
        sqlx::query_as("SELECT title, original_title, cover_path FROM works WHERE id = ?")
            .bind(work_id)
            .fetch_one(pool)
            .await?;
    let (related, related_warning) =
        cached_structure(pool, &format!("structure:{bangumi_id}:relations")).await;
    let (staff, staff_warning) =
        cached_structure(pool, &format!("structure:{bangumi_id}:staff")).await;
    let (characters, character_warning) =
        cached_structure(pool, &format!("structure:{bangumi_id}:characters")).await;
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
    let mut official = crate::metadata_aggregator::episodes_for_work(pool, work_id).await?;
    let linked = sqlx::query_as::<_, (String, String, String)>(
        "SELECT media_file_id, episode_external_id, match_method FROM media_episode_links WHERE work_id = ?",
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
    let roots = root_paths(pool).await?;
    let parsed = media
        .iter()
        .map(|file| (file.id.clone(), parse_media_with_root(file, &roots)))
        .collect::<HashMap<_, _>>();
    let mixed = parsed
        .values()
        .map(|value| (value.season.unwrap_or(1), value.special_type.clone()))
        .collect::<HashSet<_>>()
        .len()
        > 1;
    let official_unavailable = official.iter().all(|episode| episode.provider != "bangumi");
    let existing = official
        .iter()
        .map(|episode| episode.external_id.clone())
        .collect::<HashSet<_>>();
    let mut placeholders = Vec::new();
    for file in &media {
        let Some(parsed) = parsed.get(&file.id) else {
            continue;
        };
        let Some(number) = parsed.episode_start.or(file
            .parsed_episode_start
            .and_then(|value| u32::try_from(value).ok()))
        else {
            continue;
        };
        // Bangumi's normal-episode list rarely includes OP/ED/OVA. Keep those
        // selectable even when ordinary episodes were cached successfully.
        if !official_unavailable && parsed.special_type.is_none() {
            continue;
        }
        let episode = local_episode_metadata(parsed, number);
        if !existing.contains(&episode.external_id)
            && !placeholders
                .iter()
                .any(|value: &AnimeEpisodeMetadata| value.external_id == episode.external_id)
        {
            placeholders.push(episode);
        }
    }
    if official_unavailable {
        warnings.push("官方分集暂不可用，已保留缓存并提供本地未核实分集，可手动关联。".into());
    }
    if !placeholders.is_empty() && !official_unavailable {
        warnings.push("特别篇使用本地未核实分集，可手动关联。".into());
    }
    official.extend(placeholders);
    official.sort_by_key(|episode| (episode.sort_number, episode.provider != "bangumi"));
    if mixed {
        warnings.push("检测到不同季度或特别篇混在同一作品中，请在文件操作中选择“识别到其他作品”；确认拆分前暂停自动分集关联。".to_string());
    }
    let linked = linked
        .into_iter()
        .filter(|(id, _, method)| {
            method == "manual"
                || (!mixed
                    && parsed
                        .get(id)
                        .is_some_and(|value| value.special_type.is_none()))
        })
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
    let bangumi_id: String = sqlx::query_scalar(
        "SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = 'bangumi'",
    )
    .bind(work_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Validation("该作品尚未关联 Bangumi 条目".to_string()))?;
    let provider = BangumiProvider::new()?.with_pool(&state.pool);
    let primary = match provider.get_details(&bangumi_id).await {
        Ok(value) => value,
        Err(error) => {
            let mut structure = work_structure(&state.pool, work_id).await?;
            structure
                .warnings
                .push(format!("刷新失败，保留旧分集和关联：{error}"));
            return Ok(structure);
        }
    };
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
    let relations_key = format!("structure:{bangumi_id}:relations");
    let staff_key = format!("structure:{bangumi_id}:staff");
    let characters_key = format!("structure:{bangumi_id}:characters");
    let extension_results = tokio::join!(
        fetch_extension(
            &state.pool,
            &provider,
            &relations_key,
            provider.related_subjects(&bangumi_id)
        ),
        fetch_extension(
            &state.pool,
            &provider,
            &staff_key,
            provider.staff(&bangumi_id)
        ),
        fetch_extension(
            &state.pool,
            &provider,
            &characters_key,
            provider.characters(&bangumi_id)
        )
    );
    let now = Utc::now().to_rfc3339();
    let mut transaction = state.pool.begin().await?;
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
    let mut structure = work_structure(&state.pool, work_id).await?;
    structure.warnings.extend(aggregation.warnings);
    structure.warnings.extend(
        [
            extension_results.0,
            extension_results.1,
            extension_results.2,
        ]
        .into_iter()
        .filter_map(|r| r.err().map(|e| format!("扩展信息刷新失败，保留缓存：{e}"))),
    );
    structure.warnings.extend(provider.take_warnings());
    Ok(structure)
}

pub async fn media_thumbnail(
    state: &AppState,
    app: &AppHandle,
    media_file_id: &str,
) -> AppResult<Option<String>> {
    let (path, media_type, missing, cached): (String, String, bool, Option<String>) =
        sqlx::query_as(
            "SELECT path, media_type, missing, thumbnail_path FROM media_files WHERE id = ?",
        )
        .bind(media_file_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
    let network_source: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files m JOIN library_roots r ON r.id=m.library_root_id WHERE m.id=? AND r.source_type IN ('mounted','webdav'))")
        .bind(media_file_id).fetch_one(&state.pool).await?;
    if media_type != "video" || missing || network_source || path.starts_with("webdav://") {
        return Ok(None);
    }
    if let Some(cached) = cached {
        if cached == "__unsupported__" {
            return Ok(None);
        }
        if Path::new(&cached).is_file() {
            db::allow_cover_file(app, Path::new(&cached))?;
            return Ok(Some(cached));
        }
    }
    let source = PathBuf::from(path);
    let destination = state
        .thumbnail_cache_path
        .join(format!("media-{media_file_id}.jpg"));
    let source_for_task = source.clone();
    let destination_for_task = destination.clone();
    let created = tauri::async_runtime::spawn_blocking(move || {
        crate::thumbnail::extract_video_thumbnail(&source_for_task, &destination_for_task)
    })
    .await
    .map_err(|error| AppError::System(format!("视频缩略图任务失败：{error}")))??;
    if !created {
        sqlx::query("UPDATE media_files SET thumbnail_path = '__unsupported__' WHERE id = ?")
            .bind(media_file_id)
            .execute(&state.pool)
            .await?;
        return Ok(None);
    }
    let stored = destination.to_string_lossy().to_string();
    sqlx::query("UPDATE media_files SET thumbnail_path = ? WHERE id = ?")
        .bind(&stored)
        .bind(media_file_id)
        .execute(&state.pool)
        .await?;
    db::allow_cover_file(app, &destination)?;
    Ok(Some(stored))
}

async fn cache_artwork(url: Option<&str>, destination: PathBuf, cover: bool) -> Option<String> {
    let url = url?;
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

async fn fetch_extension<T: Serialize, F: Future<Output = AppResult<T>>>(
    pool: &SqlitePool,
    provider: &BangumiProvider,
    key: &str,
    future: F,
) -> AppResult<()> {
    let value = future.await?;
    if provider.has_warnings() {
        return Ok(());
    }
    let now = Utc::now();
    sqlx::query("INSERT INTO metadata_cache (provider,cache_key,response_json,fetched_at,expires_at) VALUES ('bangumi',?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
        .bind(key).bind(serde_json::to_string(&value)?).bind(now.to_rfc3339()).bind((now+chrono::Duration::days(7)).to_rfc3339()).execute(pool).await?;
    Ok(())
}

async fn cached_structure<T>(pool: &SqlitePool, key: &str) -> (Option<T>, Option<String>)
where
    T: Serialize + DeserializeOwned,
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
    async fn extension_502_keeps_expired_cache() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES ('bangumi','structure:1:staff','[\"old staff\"]','2000','2000')").execute(&pool).await.unwrap();
        let provider = BangumiProvider::new().unwrap().with_pool(&pool);
        let result =
            fetch_extension::<Vec<String>, _>(&pool, &provider, "structure:1:staff", async {
                Err(AppError::Network("HTTP 502".into()))
            })
            .await;
        assert!(result.is_err());
        let (cached, warning) = cached_structure::<Vec<String>>(&pool, "structure:1:staff").await;
        assert_eq!(cached, Some(vec!["old staff".into()]));
        assert!(warning.unwrap().contains("过期"));
    }

    #[tokio::test]
    async fn offline_mixed_nced_manual_mapping_migrates_when_official_returns() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES ('w','Show','video','now','now')").execute(&pool).await.unwrap();
        for (id, name) in [("tv", "Show [01].mkv"), ("nced", "Show [NCED][01].mkv")] {
            sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,missing,created_at,updated_at) VALUES (?,'w',?,?,'mkv','video',1,'now','now')")
                .bind(id).bind(format!(r"\\?\UNC\server\share\Show\{name}")).bind(name).execute(&pool).await.unwrap();
        }
        let structure = work_structure(&pool, "w").await.unwrap();
        assert_eq!(structure.episodes.len(), 2);
        assert!(structure
            .episodes
            .iter()
            .all(|ep| ep.episode.provider == "local"));
        let before_manual_mapping: i64 =
            sqlx::query_scalar("SELECT count(*) FROM anime_episodes WHERE work_id = 'w'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            before_manual_mapping, 0,
            "reading structure must not acquire a write lock"
        );
        assert!(structure.warnings.iter().any(|w| w.contains("暂停自动")));
        set_episode_link(&pool, "tv", Some("local/unverified:s1:tv:1"))
            .await
            .unwrap();
        set_episode_link(&pool, "nced", Some("local/unverified:s1:NCED:1"))
            .await
            .unwrap();
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,fetched_at) VALUES ('w','bangumi','100',1,1,'now')").execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        rebuild_episode_links(&mut tx, "w").await.unwrap();
        tx.commit().await.unwrap();
        let links: Vec<(String,String,String,String)> = sqlx::query_as("SELECT media_file_id,provider,episode_external_id,match_method FROM media_episode_links ORDER BY media_file_id").fetch_all(&pool).await.unwrap();
        assert_eq!(
            links,
            vec![
                (
                    "nced".into(),
                    "local".into(),
                    "local/unverified:s1:NCED:1".into(),
                    "manual".into()
                ),
                ("tv".into(), "bangumi".into(), "100".into(), "manual".into())
            ]
        );
        set_episode_link(&pool, "tv", None).await.unwrap();
        let structure = work_structure(&pool, "w").await.unwrap();
        assert!(structure.unmatched_files.iter().any(|file| file.id == "tv"));
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
