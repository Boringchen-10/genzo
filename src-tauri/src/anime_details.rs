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

pub async fn rebuild_episode_links(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
) -> AppResult<()> {
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
    // Episode numbers alone cannot identify episodes in a mixed-season work.
    // Keep explicit manual mappings, and let the user recognize each group first.
    if has_mixed_installments(&files) {
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
        "SELECT external_id, episode_number FROM anime_episodes WHERE work_id = ? AND provider = 'bangumi' AND episode_number IS NOT NULL",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .map(|(id, number)| (number, id))
    .collect::<HashMap<_, _>>();
    let media = sqlx::query_as::<_, (String, i64)>(
        "SELECT id, parsed_episode_start FROM media_files WHERE work_id = ? AND media_type = 'video' AND missing = 0 AND parsed_episode_start IS NOT NULL",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?;
    let now = Utc::now().to_rfc3339();
    for (media_file_id, episode_number) in media {
        if manual_media_ids.contains(&media_file_id) {
            continue;
        }
        let Some(episode_external_id) = episode_ids.get(&episode_number) else {
            continue;
        };
        sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, ?, 'bangumi', ?, 'parsed', 1, ?)")
            .bind(media_file_id)
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
    sqlx::query("DELETE FROM media_episode_links WHERE media_file_id = ?")
        .bind(media_file_id)
        .execute(&mut *transaction)
        .await?;
    if let Some(episode_external_id) = episode_external_id {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM anime_episodes WHERE work_id = ? AND provider = 'bangumi' AND external_id = ?)")
            .bind(&work_id)
            .bind(episode_external_id)
            .fetch_one(&mut *transaction)
            .await?;
        if !exists {
            return Err(AppError::NotFound("官方分集不存在".to_string()));
        }
        sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, ?, 'bangumi', ?, 'manual', 1, ?)")
            .bind(media_file_id)
            .bind(&work_id)
            .bind(episode_external_id)
            .bind(Utc::now().to_rfc3339())
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
        warnings.push("检测到不同季度或特别篇混在同一作品中，请在文件操作中选择“识别到其他作品”；确认拆分前暂停自动分集关联。".to_string());
    }
    let linked = linked
        .into_iter()
        .filter(|(_, _, method)| !mixed || method == "manual")
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
    work_structure(&state.pool, work_id).await
}

pub async fn media_thumbnail(
    state: &AppState,
    app: &AppHandle,
    media_file_id: &str,
) -> AppResult<Option<String>> {
    let result = media_thumbnail_path(state, media_file_id).await?;
    if let Some(path) = &result {
        db::allow_cover_file(app, Path::new(path))?;
    }
    Ok(result)
}

async fn media_thumbnail_path(state: &AppState, media_file_id: &str) -> AppResult<Option<String>> {
    media_thumbnail_with(state, media_file_id, crate::thumbnail::extract_on_demand).await
}

async fn media_thumbnail_with<F, Fut>(
    state: &AppState,
    media_file_id: &str,
    extract: F,
) -> AppResult<Option<String>>
where
    F: FnOnce(PathBuf, PathBuf) -> Fut,
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
    let Some(created) = extract(source, destination.clone()).await? else {
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
        let failed = media_thumbnail_with(&state, "m", |source, _| async move {
            assert_eq!(source, Path::new(raw)); // original persisted path reaches the boundary
            Ok(Some(false))
        })
        .await
        .unwrap();
        assert!(failed.is_none());
        let image = media_thumbnail_with(&state, "m", |_, destination| async move {
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
        let cached = media_thumbnail_with(&state, "m", |_, _| async {
            panic!("cached image must not touch the disconnected mount")
        })
        .await
        .unwrap();
        assert_eq!(cached, Some(image));
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
