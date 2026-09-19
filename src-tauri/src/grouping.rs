use crate::anime_parser::{normalize_title, parse_file_name, parse_media_path};
use crate::error::AppResult;
use crate::models::{LibraryRoot, MediaFile, UnassignedMediaGroup};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::Path;

const MEDIA_COLUMNS: &str = "id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path";

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct GroupIdentity {
    key: String,
    folder_path: Option<String>,
    title: String,
}

#[derive(Debug, Clone)]
pub struct MediaGroupContext {
    pub title: String,
    pub members: Vec<MediaFile>,
}

fn normalized_key(path: &Path) -> String {
    if path.to_string_lossy().starts_with("webdav:") {
        return path.to_string_lossy().replace('/', "\\");
    }
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

fn group_identity(media: &MediaFile, root_path: Option<&str>) -> GroupIdentity {
    let mut decoded_media;
    let media = if media.path.starts_with("webdav://") {
        decoded_media = media.clone();
        decoded_media.path = crate::remote_storage::display_path(&media.path);
        &decoded_media
    } else {
        media
    };
    let mut identity = container_identity(media, root_path);
    if media.media_type == "video" || is_subtitle_file(media) {
        // Use fresh filename/path evidence: older group recognition may have copied
        // the representative's season into every database row in the folder.
        let parsed = parse_media_path(
            &media.file_name,
            Path::new(&media.path),
            root_path.map(Path::new),
        );
        let season = parsed.season.unwrap_or(1);
        let special = parsed.special_type.as_deref().unwrap_or_default();
        identity.key = format!("{}:season:{season}:special:{special}", identity.key);
        if season > 1 {
            identity.title = format!("{} · 第 {season} 季", identity.title);
        }
        if !special.is_empty() {
            identity.title = format!("{} · {special}", identity.title);
        }
    }
    identity
}

fn container_identity(media: &MediaFile, root_path: Option<&str>) -> GroupIdentity {
    let media_path = Path::new(&media.path);
    if let Some(root_path) = root_path {
        let root = Path::new(root_path);
        if let Ok(relative) = media_path.strip_prefix(root) {
            let components: Vec<_> = relative.components().collect();
            if components.len() >= 2 {
                if is_subtitle_file(media) {
                    let folder = root.join(components[0].as_os_str());
                    return GroupIdentity {
                        key: format!("folder:{}", normalized_key(&folder)),
                        folder_path: Some(folder.to_string_lossy().to_string()),
                        title: components[0].as_os_str().to_string_lossy().to_string(),
                    };
                }
                if media.media_type == "comic" {
                    return comic_identity(media);
                }
                if matches!(media.media_type.as_str(), "novel" | "other") {
                    return file_identity(media);
                }
                let folder = root.join(components[0].as_os_str());
                return GroupIdentity {
                    key: format!("folder:{}", normalized_key(&folder)),
                    folder_path: Some(folder.to_string_lossy().to_string()),
                    title: components[0].as_os_str().to_string_lossy().to_string(),
                };
            }
            if components.len() == 1 {
                if is_subtitle_file(media) {
                    return subtitle_identity(media, root);
                }
                return direct_file_identity(media, root);
            }
        }
        return file_identity(media);
    }

    if let Some(parent) = media_path.parent() {
        return GroupIdentity {
            key: format!("folder:{}", normalized_key(parent)),
            folder_path: Some(parent.to_string_lossy().to_string()),
            title: parent
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| media.file_name.clone()),
        };
    }
    file_identity(media)
}

fn is_subtitle_file(media: &MediaFile) -> bool {
    matches!(
        media.extension.to_ascii_lowercase().as_str(),
        "ass" | "ssa" | "srt" | "vtt" | "sub"
    )
}

fn subtitle_identity(media: &MediaFile, root: &Path) -> GroupIdentity {
    let parsed = parse_file_name(&media.file_name);
    if let Some(title) = parsed.title.filter(|value| !value.trim().is_empty()) {
        let normalized = normalize_title(&title);
        return GroupIdentity {
            key: format!("direct-anime:{}:title:{}", normalized_key(root), normalized),
            folder_path: Some(root.to_string_lossy().to_string()),
            title,
        };
    }
    file_identity(media)
}

fn comic_identity(media: &MediaFile) -> GroupIdentity {
    if !matches!(
        media.extension.to_ascii_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "avif"
    ) {
        return file_identity(media);
    }

    let media_path = Path::new(&media.path);
    let Some(parent) = media_path.parent() else {
        return file_identity(media);
    };
    GroupIdentity {
        key: format!("comic-folder:{}", normalized_key(parent)),
        folder_path: Some(parent.to_string_lossy().to_string()),
        title: parent
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| media.file_name.clone()),
    }
}

fn direct_file_identity(media: &MediaFile, root: &Path) -> GroupIdentity {
    if media.media_type == "comic" {
        return comic_identity(media);
    }
    if media.media_type != "video" {
        return file_identity(media);
    }

    let root_key = normalized_key(root);
    let parsed_from_name = parse_file_name(&media.file_name);
    if let Some(parsed_title) = parsed_from_name
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        let normalized_title = normalize_title(parsed_title);
        return GroupIdentity {
            key: format!("direct-anime:{root_key}:title:{normalized_title}"),
            folder_path: Some(root.to_string_lossy().to_string()),
            title: parsed_title.to_string(),
        };
    }

    let title = root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| media.file_name.clone());
    GroupIdentity {
        key: format!("direct-anime:{root_key}:unparsed"),
        folder_path: Some(root.to_string_lossy().to_string()),
        title,
    }
}

fn file_identity(media: &MediaFile) -> GroupIdentity {
    GroupIdentity {
        key: format!("file:{}", media.id),
        folder_path: None,
        title: Path::new(&media.file_name)
            .file_stem()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| media.file_name.clone()),
    }
}

fn choose_representative(files: &[MediaFile], media_type: &str) -> MediaFile {
    let mut candidates: Vec<&MediaFile> = files
        .iter()
        .filter(|file| file.media_type == media_type)
        .collect();
    candidates.sort_by(|left, right| {
        let left_special = left.parsed_special_type.is_some();
        let right_special = right.parsed_special_type.is_some();
        left_special
            .cmp(&right_special)
            .then_with(|| natord::compare_ignore_case(&left.file_name, &right.file_name))
    });
    candidates.first().copied().unwrap_or(&files[0]).clone()
}

fn dominant_media_type(files: &[MediaFile]) -> String {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for file in files {
        *counts.entry(&file.media_type).or_default() += 1;
    }
    counts
        .into_iter()
        .max_by(|(left_type, left_count), (right_type, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| media_priority(left_type).cmp(&media_priority(right_type)))
        })
        .map(|(media_type, _)| media_type.to_string())
        .unwrap_or_else(|| "other".to_string())
}

fn group_recognition_status(files: &[MediaFile], representative: &MediaFile) -> String {
    for status in ["candidate_pending", "error", "unmatched"] {
        if files.iter().any(|file| file.recognition_status == status) {
            return status.to_string();
        }
    }
    representative.recognition_status.clone()
}

fn media_priority(media_type: &str) -> u8 {
    match media_type {
        "video" => 5,
        "comic" => 4,
        "novel" => 3,
        "game" => 2,
        _ => 1,
    }
}

async fn roots_by_id(pool: &SqlitePool) -> AppResult<HashMap<String, String>> {
    let roots = sqlx::query_as::<_, LibraryRoot>(
        "SELECT id, path, kind, enabled, last_scanned_at, created_at, updated_at FROM library_roots",
    )
    .fetch_all(pool)
    .await?;
    Ok(roots.into_iter().map(|root| (root.id, root.path)).collect())
}

async fn unassigned_media(pool: &SqlitePool) -> AppResult<Vec<MediaFile>> {
    Ok(sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE work_id IS NULL ORDER BY path COLLATE NOCASE"
    ))
    .fetch_all(pool)
    .await?)
}

pub async fn list_unassigned_groups(pool: &SqlitePool) -> AppResult<Vec<UnassignedMediaGroup>> {
    let roots = roots_by_id(pool).await?;
    let mut grouped: HashMap<GroupIdentity, Vec<MediaFile>> = HashMap::new();
    for media in unassigned_media(pool).await? {
        let root_path = media
            .library_root_id
            .as_ref()
            .and_then(|id| roots.get(id))
            .map(String::as_str);
        grouped
            .entry(group_identity(&media, root_path))
            .or_default()
            .push(media);
    }

    let mut result: Vec<_> = grouped
        .into_iter()
        .map(|(identity, files)| {
            let media_type = dominant_media_type(&files);
            let representative = choose_representative(&files, &media_type);
            UnassignedMediaGroup {
                key: identity.key,
                title: identity.title,
                folder_path: identity.folder_path,
                media_type,
                file_count: i64::try_from(files.len()).unwrap_or(i64::MAX),
                missing_count: i64::try_from(files.iter().filter(|file| file.missing).count())
                    .unwrap_or(i64::MAX),
                total_size: files
                    .iter()
                    .fold(0_i64, |total, file| total.saturating_add(file.size)),
                recognition_status: group_recognition_status(&files, &representative),
                representative,
            }
        })
        .collect();
    result.sort_by(|left, right| natord::compare_ignore_case(&left.title, &right.title));
    Ok(result)
}

pub async fn unassigned_group_context(
    pool: &SqlitePool,
    media_file_id: &str,
) -> AppResult<Option<MediaGroupContext>> {
    let roots = roots_by_id(pool).await?;
    let files = unassigned_media(pool).await?;
    let Some(requested) = files.iter().find(|file| file.id == media_file_id) else {
        return Ok(None);
    };
    let root_path = requested
        .library_root_id
        .as_ref()
        .and_then(|id| roots.get(id))
        .map(String::as_str);
    let identity = group_identity(requested, root_path);
    let members: Vec<_> = files
        .into_iter()
        .filter(|file| {
            let file_root = file
                .library_root_id
                .as_ref()
                .and_then(|id| roots.get(id))
                .map(String::as_str);
            group_identity(file, file_root) == identity
        })
        .collect();
    Ok(Some(MediaGroupContext {
        title: identity.title,
        members,
    }))
}

/// Recognition of an already organized file affects only its season/special group
/// inside the current work. It must never silently rename other seasons.
pub async fn recognition_group_context(
    pool: &SqlitePool,
    media_file_id: &str,
) -> AppResult<Option<MediaGroupContext>> {
    let requested = sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE id = ?"
    ))
    .bind(media_file_id)
    .fetch_optional(pool)
    .await?;
    let Some(requested) = requested else {
        return Ok(None);
    };
    let Some(work_id) = &requested.work_id else {
        return unassigned_group_context(pool, media_file_id).await;
    };
    let roots = roots_by_id(pool).await?;
    let root_for = |file: &MediaFile| {
        file.library_root_id
            .as_ref()
            .and_then(|id| roots.get(id))
            .map(String::as_str)
    };
    let identity = group_identity(&requested, root_for(&requested));
    let members = sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE work_id = ? ORDER BY path COLLATE NOCASE"
    ))
    .bind(work_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter(|file| group_identity(file, root_for(file)) == identity)
    .collect();
    Ok(Some(MediaGroupContext {
        title: identity.title,
        members,
    }))
}

pub async fn unassigned_group_member_ids(
    pool: &SqlitePool,
    representative_id: &str,
) -> AppResult<Vec<String>> {
    Ok(
        match unassigned_group_context(pool, representative_id).await? {
            Some(context) => context.members.into_iter().map(|file| file.id).collect(),
            None => vec![representative_id.to_string()],
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::Utc;

    #[tokio::test]
    async fn separates_mixed_seasons_and_specials_with_their_subtitles() {
        let pool = db::test_pool().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Anime', 'video', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        for (id, relative, name, extension, kind) in [
            (
                "tv1",
                r"Show\Show S1 - 01.mkv",
                "Show S1 - 01.mkv",
                "mkv",
                "video",
            ),
            (
                "tv1b",
                r"Show\Show - 01 [1080p].mkv",
                "Show - 01 [1080p].mkv",
                "mkv",
                "video",
            ),
            ("tv2", r"Show\Season 2\01.mkv", "01.mkv", "mkv", "video"),
            (
                "tv2b",
                r"Show\Show S02E02.mkv",
                "Show S02E02.mkv",
                "mkv",
                "video",
            ),
            (
                "oad1",
                r"Show\Show - OAD 01.mkv",
                "Show - OAD 01.mkv",
                "mkv",
                "video",
            ),
            ("oad2", r"Show\OAD\02.mkv", "02.mkv", "mkv", "video"),
            (
                "oadsub",
                r"Show\字幕\Show - OAD 01.ass",
                "Show - OAD 01.ass",
                "ass",
                "other",
            ),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, parsed_season, created_at, updated_at) VALUES (?, 'root', ?, ?, ?, ?, 1, ?, ?)")
                .bind(id).bind(format!(r"C:\Anime\{relative}")).bind(name).bind(extension).bind(kind).bind(&now).bind(&now).execute(&pool).await.unwrap();
        }
        let groups = list_unassigned_groups(&pool).await.unwrap();
        assert_eq!(groups.len(), 3);
        assert_eq!(
            unassigned_group_member_ids(&pool, "tv1")
                .await
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            unassigned_group_member_ids(&pool, "tv2")
                .await
                .unwrap()
                .len(),
            2
        );
        let specials = unassigned_group_member_ids(&pool, "oad1").await.unwrap();
        assert_eq!(specials.len(), 3);
        assert!(specials.contains(&"oadsub".to_string()));
        // Recognition must not change group membership after persisting parsed fields.
        sqlx::query("UPDATE media_files SET parsed_season = 2 WHERE id = 'tv2'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            unassigned_group_member_ids(&pool, "tv2")
                .await
                .unwrap()
                .len(),
            2
        );
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', 'Show', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        sqlx::query("UPDATE media_files SET work_id = 'work'")
            .execute(&pool)
            .await
            .unwrap();
        let existing = recognition_group_context(&pool, "oad1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(existing.members.len(), 3);
        assert!(existing
            .members
            .iter()
            .all(|file| specials.contains(&file.id)));
    }

    #[tokio::test]
    async fn groups_nested_files_by_top_level_work_folder() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Anime', 'video', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("1", "C:\\Anime\\Work A\\Season 1\\01.mkv", "01.mkv"),
            ("2", "C:\\Anime\\Work A\\Season 1\\02.mkv", "02.mkv"),
            ("3", "C:\\Anime\\Work B\\movie.mkv", "movie.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'mkv', 'video', ?, ?)")
                .bind(id).bind(path).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }
        let groups = list_unassigned_groups(&pool).await.expect("list groups");
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].title, "Work A");
        assert_eq!(groups[0].file_count, 2);
    }

    #[tokio::test]
    async fn groups_files_directly_under_scan_root() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Anime\\Work A', 'video', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("1", "C:\\Anime\\Work A\\01.mkv", "01.mkv"),
            ("2", "C:\\Anime\\Work A\\02.mkv", "02.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'mkv', 'video', ?, ?)")
                .bind(id).bind(path).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "Work A");
        assert_eq!(groups[0].file_count, 2);
        assert_eq!(groups[0].folder_path.as_deref(), Some("C:\\Anime\\Work A"));
        assert_eq!(groups[0].representative.file_name, "01.mkv");

        let member_ids = unassigned_group_member_ids(&pool, &groups[0].representative.id)
            .await
            .expect("list group members");
        assert_eq!(member_ids.len(), 2);
        assert!(member_ids.contains(&"1".to_string()));
        assert!(member_ids.contains(&"2".to_string()));
    }

    #[tokio::test]
    async fn keeps_unrelated_direct_anime_files_separate() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Videos', 'video', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name, parsed_title) in [
            ("1", "C:\\Videos\\Show A 01.mkv", "Show A 01.mkv", "Show A"),
            ("2", "C:\\Videos\\Movie B.mkv", "Movie B.mkv", "Movie B"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, parsed_title, created_at, updated_at) VALUES (?, 'root', ?, ?, 'mkv', 'video', ?, ?, ?)")
                .bind(id).bind(path).bind(name).bind(parsed_title).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|group| group.file_count == 1));
        let show_group = groups.iter().find(|group| group.title == "Show A").unwrap();
        let member_ids = unassigned_group_member_ids(&pool, &show_group.representative.id)
            .await
            .expect("list group members");
        assert_eq!(member_ids, vec!["1"]);
    }

    #[tokio::test]
    async fn separates_direct_anime_files_before_recognition_has_run() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Videos', 'video', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("1", "C:\\Videos\\Show A - 01.mkv", "Show A - 01.mkv"),
            ("2", "C:\\Videos\\Show A - 02.mkv", "Show A - 02.mkv"),
            ("3", "C:\\Videos\\Movie B.mkv", "Movie B.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'mkv', 'video', ?, ?)")
                .bind(id).bind(path).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");
        assert_eq!(groups.len(), 2);
        assert_eq!(
            groups
                .iter()
                .find(|group| group.title == "Show A")
                .map(|group| group.file_count),
            Some(2)
        );
        assert_eq!(
            groups
                .iter()
                .find(|group| group.title == "Movie B · MOVIE")
                .map(|group| group.file_count),
            Some(1)
        );
    }

    #[tokio::test]
    async fn groups_direct_anime_files_with_the_same_parsed_title() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Anime\\Work A', 'video', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("1", "C:\\Anime\\Work A\\Work A 01.mkv", "Work A 01.mkv"),
            ("2", "C:\\Anime\\Work A\\Work A 02.mkv", "Work A 02.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, parsed_title, parsed_episode, created_at, updated_at) VALUES (?, 'root', ?, ?, 'mkv', 'video', 'Work A', ?, ?, ?)")
                .bind(id).bind(path).bind(name).bind(id).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "Work A");
        assert_eq!(groups[0].file_count, 2);
    }

    #[tokio::test]
    async fn keeps_direct_files_of_different_media_types_separate() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Mixed', 'mixed', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name, extension, media_type) in [
            ("1", "C:\\Mixed\\01.mkv", "01.mkv", "mkv", "video"),
            ("2", "C:\\Mixed\\chapter.cbz", "chapter.cbz", "cbz", "comic"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, ?, ?, ?, ?)")
                .bind(id).bind(path).bind(name).bind(extension).bind(media_type).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|group| group.file_count == 1));
    }

    #[tokio::test]
    async fn splits_nested_comic_collection_by_leaf_folder() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Library', 'mixed', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("1", "C:\\Library\\Junji Ito\\Tomie\\001.jpg", "001.jpg"),
            ("2", "C:\\Library\\Junji Ito\\Tomie\\002.jpg", "002.jpg"),
            ("3", "C:\\Library\\Junji Ito\\Uzumaki\\001.jpg", "001.jpg"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'jpg', 'comic', ?, ?)")
                .bind(id).bind(path).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].title, "Tomie");
        assert_eq!(groups[0].file_count, 2);
        assert_eq!(groups[1].title, "Uzumaki");
        assert_eq!(groups[1].file_count, 1);
    }

    #[tokio::test]
    async fn keeps_nested_comic_archives_as_individual_items() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Library', 'comic', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("1", "C:\\Library\\Collection\\Tomie.cbz", "Tomie.cbz"),
            ("2", "C:\\Library\\Collection\\Uzumaki.cbz", "Uzumaki.cbz"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'cbz', 'comic', ?, ?)")
                .bind(id).bind(path).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|group| group.file_count == 1));
    }

    #[tokio::test]
    async fn groups_images_when_the_comic_folder_is_the_scan_root() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Comics\\Tomie', 'comic', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("1", "C:\\Comics\\Tomie\\001.jpg", "001.jpg"),
            ("2", "C:\\Comics\\Tomie\\002.jpg", "002.jpg"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'jpg', 'comic', ?, ?)")
                .bind(id).bind(path).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "Tomie");
        assert_eq!(groups[0].file_count, 2);
    }

    #[tokio::test]
    async fn associates_nested_subtitles_with_the_video_folder() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'G:\\影音', 'auto', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name, extension, media_type) in [
            (
                "1",
                "G:\\影音\\Q 亲吻姐姐 12集全\\视频\\[ReinForce] Kiss x Sis - 01.mkv",
                "[ReinForce] Kiss x Sis - 01.mkv",
                "mkv",
                "video",
            ),
            (
                "2",
                "G:\\影音\\Q 亲吻姐姐 12集全\\字幕\\[ReinForce] Kiss x Sis - 01.ass",
                "[ReinForce] Kiss x Sis - 01.ass",
                "ass",
                "other",
            ),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, parsed_title, created_at, updated_at) VALUES (?, 'root', ?, ?, ?, ?, ?, ?, ?)")
                .bind(id).bind(path).bind(name).bind(extension).bind(media_type)
                .bind(if id == "1" { Some("Kiss x Sis") } else { None::<&str> })
                .bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }

        let groups = list_unassigned_groups(&pool).await.expect("list groups");

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "Q 亲吻姐姐 12集全");
        assert_eq!(groups[0].file_count, 2);
        assert_eq!(groups[0].media_type, "video");
    }
}
