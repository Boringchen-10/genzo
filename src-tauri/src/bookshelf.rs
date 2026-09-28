use crate::db::AppState;
use crate::error::{AppError, AppResult};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
struct BookFile {
    id: String,
    path: String,
    file_name: String,
    extension: String,
    missing: bool,
    created_at: String,
}

#[derive(Debug, Clone, FromRow)]
struct BookOverride {
    media_file_id: String,
    title: Option<String>,
    volume_number: Option<f64>,
    chapter_number: Option<f64>,
    read_state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEntry {
    pub id: String,
    pub title: String,
    pub volume_number: Option<f64>,
    pub chapter_number: Option<f64>,
    pub media_file_ids: Vec<String>,
    pub format: String,
    pub missing: bool,
    pub read_state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEntryInput {
    pub title: Option<String>,
    pub volume_number: Option<f64>,
    pub chapter_number: Option<f64>,
    pub read_state: String,
}

#[derive(Debug, Clone, FromRow)]
struct UnassignedBookFile {
    id: String,
    path: String,
    file_name: String,
    extension: String,
    media_type: String,
    missing: bool,
    root_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookImportFile {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub extension: String,
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookImportGroup {
    pub title: String,
    pub media_type: String,
    pub folder_path: Option<String>,
    pub media_file_ids: Vec<String>,
    pub files: Vec<BookImportFile>,
}

fn import_groups(files: Vec<UnassignedBookFile>) -> Vec<BookImportGroup> {
    let mut groups: HashMap<String, BookImportGroup> = HashMap::new();
    for file in files {
        let root = file.root_path.trim_end_matches(['/', '\\']);
        let relative = file.path.get(root.len()..).filter(|_| file.path.get(..root.len()).is_some_and(|head| head.eq_ignore_ascii_case(root)))
            .unwrap_or(&file.file_name).trim_start_matches(['/', '\\']);
        let parts = relative.split(['/', '\\']).filter(|part| !part.is_empty()).collect::<Vec<_>>();
        let directory_count = parts.len().saturating_sub(1);
        let group_depth = if image_extension(&file.extension.to_ascii_lowercase()) && directory_count > 1 { directory_count - 1 } else { directory_count };
        let (key, title, folder_path) = if group_depth > 0 {
            let separator = if root.contains('/') { '/' } else { '\\' };
            let folder = format!("{root}{separator}{}", parts[..group_depth].join(&separator.to_string()));
            (format!("{}:{}", file.media_type, folder.to_lowercase()), parts[group_depth - 1].to_string(), Some(folder))
        } else {
            (format!("file:{}", file.id), file.file_name.rsplit_once('.').map_or(file.file_name.as_str(), |(stem, _)| stem).to_string(), None)
        };
        let group = groups.entry(key).or_insert_with(|| BookImportGroup { title, media_type: file.media_type, folder_path, media_file_ids: Vec::new(), files: Vec::new() });
        group.media_file_ids.push(file.id.clone());
        group.files.push(BookImportFile { id: file.id, path: file.path, file_name: file.file_name, extension: file.extension, missing: file.missing });
    }
    let mut groups = groups.into_values().collect::<Vec<_>>();
    for group in &mut groups {
        group.files.sort_by(|left, right| natord::compare(&left.path, &right.path));
    }
    groups.sort_by(|left, right| natord::compare(&left.title, &right.title));
    groups
}

pub async fn import_groups_in_pool(pool: &SqlitePool) -> AppResult<Vec<BookImportGroup>> {
    let files = sqlx::query_as::<_, UnassignedBookFile>("SELECT m.id, m.path, m.file_name, m.extension, m.media_type, m.missing, r.path AS root_path FROM media_files m JOIN library_roots r ON r.id = m.library_root_id WHERE m.work_id IS NULL AND m.media_type IN ('comic', 'novel') AND r.destination = 'bookshelf' ORDER BY m.path LIMIT 10001")
        .fetch_all(pool).await?;
    if files.len() > 10000 { return Err(AppError::Validation("待读物超过 10000 个文件，请缩小资源目录范围".into())); }
    Ok(import_groups(files))
}

#[tauri::command]
pub async fn list_book_import_groups(state: State<'_, AppState>) -> AppResult<Vec<BookImportGroup>> {
    import_groups_in_pool(&state.pool).await
}

fn unit_count(files: impl IntoIterator<Item = (String, String, String)>) -> usize {
    let mut units = HashSet::new();
    for (id, path, extension) in files {
        let key = if image_extension(&extension.to_ascii_lowercase()) {
            format!("folder:{}", parent_key(&path).to_lowercase())
        } else { format!("file:{id}") };
        units.insert(key);
    }
    units.len()
}

async fn selected_unit_count(pool: &SqlitePool, media_file_ids: &[String]) -> AppResult<usize> {
    let mut files = Vec::new();
    for chunk in media_file_ids.chunks(400) {
        let mut query = QueryBuilder::<Sqlite>::new("SELECT id, path, extension FROM media_files WHERE id IN (");
        let mut ids = query.separated(",");
        for id in chunk { ids.push_bind(id); }
        ids.push_unseparated(")");
        files.extend(query.build_query_as::<(String, String, String)>().fetch_all(pool).await?);
    }
    Ok(unit_count(files))
}

async fn create_book_work_with_match_in_pool(pool: &SqlitePool, title: &str, media_type: &str, media_file_ids: &[String], prepared: Option<crate::book_scrape::PreparedBookMatch>, local_cover_path: Option<String>) -> AppResult<String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 300 { return Err(AppError::Validation("书籍标题不能为空且最多 300 字".into())); }
    if !matches!(media_type, "comic" | "novel") { return Err(AppError::Validation("请选择漫画或小说类型".into())); }
    if media_file_ids.is_empty() || media_file_ids.len() > 1000 { return Err(AppError::Validation("请选择 1–1000 个书籍文件".into())); }
    let mut unique = std::collections::HashSet::new();
    if media_file_ids.iter().any(|id| !unique.insert(id)) { return Err(AppError::Validation("文件列表存在重复项".into())); }
    let work_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let (_guard, mut transaction) = crate::db::begin_write(pool).await?;
    sqlx::query("INSERT INTO works (id, title, type, cover_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&work_id).bind(title).bind(media_type).bind(local_cover_path).bind(&now).bind(&now).execute(&mut *transaction).await?;
    for id in media_file_ids {
        let result = sqlx::query("UPDATE media_files SET work_id = ?, updated_at = ? WHERE id = ? AND work_id IS NULL AND (media_type = ? OR (? = 'comic' AND extension = 'pdf')) AND EXISTS (SELECT 1 FROM library_roots r WHERE r.id = media_files.library_root_id AND r.destination = 'bookshelf')")
            .bind(&work_id).bind(&now).bind(id).bind(media_type).bind(media_type).execute(&mut *transaction).await?;
        if result.rows_affected() != 1 { return Err(AppError::Validation("有文件已归档、类型不符、离开书架目录或被移除，请刷新后重试".into())); }
    }
    if let Some(prepared) = prepared {
        if prepared.single_volume {
            let files = sqlx::query_as::<_, (String, String, String)>("SELECT id, path, extension FROM media_files WHERE work_id = ?")
                .bind(&work_id).fetch_all(&mut *transaction).await?;
            if unit_count(files) > 1 { return Err(AppError::Validation("该候选是单册条目，所选文件包含多册；请选择系列条目或减少文件".into())); }
        }
        crate::book_scrape::apply_prepared_match(&mut transaction, &work_id, prepared, &now).await?;
    }
    transaction.commit().await?;
    Ok(work_id)
}

pub async fn create_book_work_in_pool(pool: &SqlitePool, title: &str, media_type: &str, media_file_ids: &[String]) -> AppResult<String> {
    create_book_work_with_match_in_pool(pool, title, media_type, media_file_ids, None, None).await
}

#[tauri::command]
pub async fn create_book_work(title: String, media_type: String, media_file_ids: Vec<String>, external_id: Option<String>, cover_media_file_id: Option<String>, state: State<'_, AppState>) -> AppResult<String> {
    if external_id.is_none() && cover_media_file_id.is_none() {
        return create_book_work_in_pool(&state.pool, &title, &media_type, &media_file_ids).await;
    }
    let local_cover_path = if let Some(cover_id) = cover_media_file_id {
        if !media_file_ids.contains(&cover_id) { return Err(AppError::Validation("封面文件不在所选书籍文件中".into())); }
        crate::book_metadata::embedded_in_pool(&state.pool, &state.cover_cache_path, &cover_id).await.ok().and_then(|metadata| metadata.cover_path)
    } else { None };
    let prepared = if let Some(external_id) = external_id {
        if media_file_ids.is_empty() || media_file_ids.len() > 1000 { return Err(AppError::Validation("请选择 1–1000 个书籍文件".into())); }
        let unit_count = selected_unit_count(&state.pool, &media_file_ids).await?;
        Some(crate::book_scrape::prepare_match(&state, &external_id, &media_type, unit_count).await?)
    } else { None };
    create_book_work_with_match_in_pool(&state.pool, &title, &media_type, &media_file_ids, prepared, local_cover_path).await
}

fn image_extension(extension: &str) -> bool {
    matches!(extension, "jpg" | "jpeg" | "png" | "webp" | "avif")
}

fn parent_key(path: &str) -> &str {
    path.rfind(['/', '\\']).map_or("", |position| &path[..position])
}

fn parse_number(regex: &Regex, title: &str) -> Option<f64> {
    let captures = regex.captures(title)?;
    captures.get(1).or_else(|| captures.get(2))?.as_str().parse::<f64>().ok()
}

fn parse_book_numbers(title: &str) -> (Option<f64>, Option<f64>) {
    static VOLUME: OnceLock<Regex> = OnceLock::new();
    static CHAPTER: OnceLock<Regex> = OnceLock::new();
    let volume = VOLUME.get_or_init(|| Regex::new(r"(?i)(?:第\s*(\d+(?:\.\d+)?)\s*[卷巻册冊]|\bvol(?:ume)?\.?\s*(\d+(?:\.\d+)?))").unwrap());
    let chapter = CHAPTER.get_or_init(|| Regex::new(r"(?i)(?:第\s*(\d+(?:\.\d+)?)\s*[话話章]|\b(?:ch|chapter)\.?\s*(\d+(?:\.\d+)?))").unwrap());
    (
        parse_number(volume, title),
        parse_number(chapter, title),
    )
}

fn make_entries(files: Vec<BookFile>, overrides: Vec<BookOverride>) -> Vec<BookEntry> {
    let overrides: HashMap<_, _> = overrides.into_iter().map(|row| (row.media_file_id.clone(), row)).collect();
    let mut grouped: HashMap<String, Vec<BookFile>> = HashMap::new();
    for file in files {
        let key = if image_extension(&file.extension.to_ascii_lowercase()) {
            format!("folder:{}", parent_key(&file.path).to_lowercase())
        } else {
            format!("file:{}", file.id)
        };
        grouped.entry(key).or_default().push(file);
    }
    let mut entries = Vec::with_capacity(grouped.len());
    for (key, mut members) in grouped {
        members.sort_by(|left, right| natord::compare(&left.path, &right.path).then(left.created_at.cmp(&right.created_at)).then(left.id.cmp(&right.id)));
        let representative = &members[0];
        let image_folder = key.starts_with("folder:");
        let default_title = if image_folder {
            parent_key(&representative.path)
                .rsplit(['/', '\\'])
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or(&representative.file_name)
                .to_string()
        } else {
            representative.file_name
                .rsplit_once('.')
                .map_or(representative.file_name.as_str(), |(stem, _)| stem)
                .to_string()
        };
        let (parsed_volume, parsed_chapter) = parse_book_numbers(&default_title);
        let manual = overrides.get(&representative.id);
        entries.push(BookEntry {
            id: representative.id.clone(),
            title: manual.and_then(|value| value.title.clone()).unwrap_or(default_title),
            volume_number: manual.and_then(|value| value.volume_number).or(parsed_volume),
            chapter_number: manual.and_then(|value| value.chapter_number).or(parsed_chapter),
            media_file_ids: members.iter().map(|file| file.id.clone()).collect(),
            format: if image_folder { "images".into() } else { representative.extension.clone() },
            missing: members.iter().all(|file| file.missing),
            read_state: manual.map_or("unread", |value| &value.read_state).to_string(),
        });
    }
    entries.sort_by(|left, right| {
        left.volume_number.partial_cmp(&right.volume_number).unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.chapter_number.partial_cmp(&right.chapter_number).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| natord::compare(&left.title, &right.title))
    });
    entries
}

pub async fn entries_in_pool(pool: &SqlitePool, work_id: &str) -> AppResult<Vec<BookEntry>> {
    let kind: Option<String> = sqlx::query_scalar("SELECT type FROM works WHERE id = ?")
        .bind(work_id).fetch_optional(pool).await?;
    if !matches!(kind.as_deref(), Some("comic" | "novel")) {
        return Err(AppError::Validation("请选择漫画或小说作品".into()));
    }
    let files = sqlx::query_as::<_, BookFile>("SELECT id, path, file_name, extension, missing, created_at FROM media_files WHERE work_id = ? AND media_type IN ('comic', 'novel')")
        .bind(work_id).fetch_all(pool).await?;
    let overrides = sqlx::query_as::<_, BookOverride>("SELECT o.media_file_id, o.title, o.volume_number, o.chapter_number, o.read_state FROM book_entry_overrides o JOIN media_files m ON m.id = o.media_file_id WHERE m.work_id = ?")
        .bind(work_id).fetch_all(pool).await?;
    Ok(make_entries(files, overrides))
}

#[tauri::command]
pub async fn list_book_entries(work_id: String, state: State<'_, AppState>) -> AppResult<Vec<BookEntry>> {
    entries_in_pool(&state.pool, &work_id).await
}

pub async fn save_entry_in_pool(pool: &SqlitePool, work_id: &str, entry_id: &str, input: BookEntryInput) -> AppResult<Vec<BookEntry>> {
    if input.title.as_ref().is_some_and(|value| value.trim().chars().count() > 300) {
        return Err(AppError::Validation("书籍标题过长".into()));
    }
    let title = input.title.map(|title| title.trim().to_string()).filter(|title| !title.is_empty());
    if !["unread", "reading", "read"].contains(&input.read_state.as_str()) {
        return Err(AppError::Validation("无效的阅读状态".into()));
    }
    for number in [input.volume_number, input.chapter_number].into_iter().flatten() {
        if !number.is_finite() || !(0.0..=100000.0).contains(&number) {
            return Err(AppError::Validation("卷号或话数无效".into()));
        }
    }
    let entries = entries_in_pool(pool, work_id).await?;
    if !entries.iter().any(|entry| entry.id == entry_id) {
        return Err(AppError::Validation("书籍条目已变化，请刷新后重试".into()));
    }
    let (_guard, mut transaction) = crate::db::begin_write(pool).await?;
    let still_linked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files WHERE id = ? AND work_id = ?)")
        .bind(entry_id).bind(work_id).fetch_one(&mut *transaction).await?;
    if !still_linked { return Err(AppError::Validation("书籍条目已变化，请刷新后重试".into())); }
    sqlx::query("INSERT INTO book_entry_overrides (media_file_id, title, volume_number, chapter_number, read_state, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(media_file_id) DO UPDATE SET title = excluded.title, volume_number = excluded.volume_number, chapter_number = excluded.chapter_number, read_state = excluded.read_state, updated_at = excluded.updated_at")
        .bind(entry_id).bind(title).bind(input.volume_number).bind(input.chapter_number).bind(&input.read_state).bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction).await?;
    transaction.commit().await?;
    entries_in_pool(pool, work_id).await
}

#[tauri::command]
pub async fn save_book_entry(work_id: String, entry_id: String, input: BookEntryInput, state: State<'_, AppState>) -> AppResult<Vec<BookEntry>> {
    save_entry_in_pool(&state.pool, &work_id, &entry_id, input).await
}

#[tauri::command]
pub async fn open_book_entry(work_id: String, entry_id: String, tool_id: Option<String>, state: State<'_, AppState>) -> AppResult<()> {
    let entries = entries_in_pool(&state.pool, &work_id).await?;
    let entry = entries.iter().find(|entry| entry.id == entry_id)
        .ok_or_else(|| AppError::Validation("书籍条目已变化，请刷新后重试".into()))?;
    if entry.format != "images" {
        return crate::commands::launch_media(entry_id, tool_id, false, None, state).await;
    }
    let path: String = sqlx::query_scalar("SELECT path FROM media_files WHERE id = ? AND work_id = ?")
        .bind(&entry.id).bind(&work_id).fetch_one(&state.pool).await?;
    if path.starts_with("webdav://") {
        return Err(AppError::Validation("远程图片目录暂不支持直接交给外部阅读器，请先使用本地挂载目录".into()));
    }
    let folder = parent_key(&path).to_string();
    if !Path::new(&folder).is_dir() { return Err(AppError::Validation("漫画目录暂时不可用".into())); }
    let selected_tool: Option<(String, String, Option<String>, String)> = if let Some(id) = tool_id {
        Some(sqlx::query_as("SELECT executable_path, arguments_template, working_directory, supported_media_types FROM external_tools WHERE id = ?")
            .bind(id).fetch_optional(&state.pool).await?
            .ok_or_else(|| AppError::NotFound("外部阅读器不存在".into()))?)
    } else {
        sqlx::query_as("SELECT executable_path, arguments_template, working_directory, supported_media_types FROM external_tools WHERE is_default = 1 ORDER BY updated_at DESC")
            .fetch_all(&state.pool).await?.into_iter().find(|(_, _, _, kinds): &(String, String, Option<String>, String)| {
                serde_json::from_str::<Vec<String>>(kinds).is_ok_and(|kinds| kinds.iter().any(|kind| kind == "comic"))
            })
    };
    let title = entry.title.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some((executable, template, working_directory, supported)) = selected_tool {
            if !serde_json::from_str::<Vec<String>>(&supported).is_ok_and(|kinds| kinds.iter().any(|kind| kind == "comic")) {
                return Err(AppError::Validation("所选工具未声明支持漫画".into()));
            }
            let folder = crate::launcher::shell_compatible_path(&folder);
            let context = crate::launcher::TemplateContext { file: &folder, folder: &folder, title: &title };
            let arguments = crate::launcher::expand_arguments(&template, &context)?;
            crate::launcher::launch_executable(&executable, &arguments, working_directory.as_deref())
        } else {
            crate::launcher::open_directory(&folder)
        }
    }).await.map_err(|error| AppError::System(format!("启动阅读器失败：{error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;

    fn file(id: &str, path: &str, extension: &str, created: &str) -> BookFile {
        BookFile { id: id.into(), path: path.into(), file_name: path.rsplit(['/', '\\']).next().unwrap().into(), extension: extension.into(), missing: false, created_at: created.into() }
    }

    #[test]
    fn image_folder_is_one_entry_and_order_is_natural() {
        let entries = make_entries(vec![
            file("a", r"C:\Books\A\第2卷\001.jpg", "jpg", "1"),
            file("b", r"C:\Books\A\第2卷\002.jpg", "jpg", "2"),
            file("c", r"C:\Books\A\第10卷.cbz", "cbz", "3"),
        ], vec![]);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].media_file_ids, vec!["a", "b"]);
        assert_eq!(entries[0].volume_number, Some(2.0));
        assert_eq!(entries[1].volume_number, Some(10.0));
    }

    #[test]
    fn ambiguous_digits_do_not_become_volume() {
        assert_eq!(parse_book_numbers("第2024年的故事 第2卷"), (Some(2.0), None));
        assert_eq!(parse_book_numbers("故事 2024.cbz"), (None, None));
        assert_eq!(parse_book_numbers("第12话"), (None, Some(12.0)));
    }

    #[test]
    fn import_group_keeps_series_and_types_separate() {
        let group = import_groups(vec![
            UnassignedBookFile { id: "1".into(), path: r"C:\Books\Series\01.cbz".into(), file_name: "01.cbz".into(), extension: "cbz".into(), media_type: "comic".into(), missing: false, root_path: r"C:\Books".into() },
            UnassignedBookFile { id: "2".into(), path: r"C:\Books\Series\02.cbz".into(), file_name: "02.cbz".into(), extension: "cbz".into(), media_type: "comic".into(), missing: true, root_path: r"C:\Books".into() },
            UnassignedBookFile { id: "3".into(), path: r"C:\Books\Series\01.epub".into(), file_name: "01.epub".into(), extension: "epub".into(), media_type: "novel".into(), missing: false, root_path: r"C:\Books".into() },
        ]);
        assert_eq!(group.len(), 2);
        let comic = group.iter().find(|item| item.media_type == "comic").unwrap();
        assert_eq!(comic.media_file_ids.len(), 2);
        assert_eq!(comic.files[0].file_name, "01.cbz");
        assert!(comic.files[1].missing);
        assert_eq!(unit_count(vec![("a".into(), r"C:\Books\Series\01.jpg".into(), "jpg".into()), ("b".into(), r"C:\Books\Series\02.jpg".into(), "jpg".into())]), 1);
        let nested = import_groups(vec![
            UnassignedBookFile { id: "4".into(), path: r"C:\Books\合集\甲\第1卷.cbz".into(), file_name: "第1卷.cbz".into(), extension: "cbz".into(), media_type: "comic".into(), missing: false, root_path: r"C:\Books".into() },
            UnassignedBookFile { id: "5".into(), path: r"C:\Books\合集\乙\第1卷.cbz".into(), file_name: "第1卷.cbz".into(), extension: "cbz".into(), media_type: "comic".into(), missing: false, root_path: r"C:\Books".into() },
            UnassignedBookFile { id: "6".into(), path: r"C:\Books\合集\甲\第2卷\001.jpg".into(), file_name: "001.jpg".into(), extension: "jpg".into(), media_type: "comic".into(), missing: false, root_path: r"C:\Books".into() },
        ]);
        assert_eq!(nested.len(), 2);
        assert_eq!(nested.iter().find(|item| item.title == "甲").unwrap().files.len(), 2);
    }

    #[tokio::test]
    async fn import_creates_one_work_atomically_and_preserves_unselected_files() {
        let pool = crate::db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO library_roots (id, path, kind, destination, created_at, updated_at) VALUES ('root', 'C:\\\\Books', 'auto', 'bookshelf', 't', 't')")
            .execute(&pool).await.unwrap();
        for (id, name) in [("one", "第1卷.cbz"), ("two", "第2卷.cbz"), ("other", "别的书.cbz")] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'cbz', 'comic', 't', 't')")
                .bind(id).bind(format!("C:\\\\Books\\\\系列\\\\{name}")).bind(name).execute(&pool).await.unwrap();
        }
        let invalid = create_book_work_in_pool(&pool, "系列", "comic", &["one".into(), "missing".into()]).await;
        assert!(invalid.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM works").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
        let work_id = create_book_work_in_pool(&pool, "系列", "comic", &["one".into(), "two".into()]).await.unwrap();
        let entries = entries_in_pool(&pool, &work_id).await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].volume_number, Some(1.0));
        assert_eq!(entries[1].volume_number, Some(2.0));
        let other_work: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = 'other'").fetch_one(&pool).await.unwrap();
        assert_eq!(other_work, None);
    }

    #[tokio::test]
    async fn matched_import_rolls_back_conflicts_and_multiple_volumes() {
        let pool = crate::db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO library_roots (id, path, kind, destination, created_at, updated_at) VALUES ('root', 'C:\\Books', 'comic', 'bookshelf', 't', 't')")
            .execute(&pool).await.unwrap();
        for (id, name) in [("one", "第1卷.cbz"), ("two", "第2卷.cbz")] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'cbz', 'comic', 't', 't')")
                .bind(id).bind(format!("C:\\Books\\系列\\{name}")).bind(name).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('existing', '现有作品', 'comic', 't', 't')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES ('existing', 'bangumi', '42', 't', 't')")
            .execute(&pool).await.unwrap();
        let prepared = |external_id: &str, single_volume: bool| {
            let details = serde_json::json!({"id": external_id.parse::<i64>().unwrap(), "type": 1, "name": "系列", "platform": "漫画"});
            let mut metadata = crate::bangumi::subject_to_metadata(&details).unwrap();
            metadata.subject_type = "comic".into();
            crate::book_scrape::PreparedBookMatch { external_id: external_id.into(), metadata, cover_path: None, single_volume }
        };
        let duplicate = create_book_work_with_match_in_pool(&pool, "系列", "comic", &["one".into()], Some(prepared("42", false)), None).await;
        assert!(duplicate.is_err());
        let multiple = create_book_work_with_match_in_pool(&pool, "系列", "comic", &["one".into(), "two".into()], Some(prepared("43", true)), None).await;
        assert!(multiple.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM works").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1);
        let still_unassigned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_files WHERE work_id IS NULL").fetch_one(&pool).await.unwrap();
        assert_eq!(still_unassigned, 2);
        let id = create_book_work_with_match_in_pool(&pool, "系列", "comic", &["one".into()], Some(prepared("43", true)), Some("cache/book.png".into())).await.unwrap();
        let matched: (String, String, String) = sqlx::query_as("SELECT e.external_id, w.metadata_status, w.cover_path FROM works w JOIN work_external_ids e ON e.work_id = w.id WHERE w.id = ?")
            .bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(matched, ("43".into(), "matched".into(), "cache/book.png".into()));
        let other: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = 'two'").fetch_one(&pool).await.unwrap();
        assert_eq!(other, None);
    }

    #[tokio::test]
    async fn pdf_can_be_classified_as_comic_without_accepting_novel_files() {
        let pool = crate::db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO library_roots (id, path, kind, destination, created_at, updated_at) VALUES ('root', 'C:\\Books', 'auto', 'bookshelf', 't', 't')")
            .execute(&pool).await.unwrap();
        for (id, name, extension) in [("pdf", "画集.pdf", "pdf"), ("epub", "小说.epub", "epub")] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, ?, 'novel', 't', 't')")
                .bind(id).bind(format!("C:\\Books\\{name}")).bind(name).bind(extension).execute(&pool).await.unwrap();
        }
        assert!(create_book_work_in_pool(&pool, "错配", "comic", &["epub".into()]).await.is_err());
        let work_id = create_book_work_in_pool(&pool, "画集", "comic", &["pdf".into()]).await.unwrap();
        let kind: String = sqlx::query_scalar("SELECT type FROM works WHERE id = ?").bind(&work_id).fetch_one(&pool).await.unwrap();
        assert_eq!(kind, "comic");
        let untouched: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = 'epub'").fetch_one(&pool).await.unwrap();
        assert_eq!(untouched, None);
    }

    #[tokio::test]
    async fn existing_library_upgrades_without_losing_book_files() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut previous = sqlx::migrate!("./migrations");
        let mut migrations = previous.migrations.into_owned();
        migrations.retain(|migration| migration.version <= 19);
        previous.migrations = Cow::Owned(migrations);
        previous.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('book', '原有漫画', 'comic', 't', 't')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, created_at, updated_at) VALUES ('page', 'book', 'C:\\Books\\01\\001.jpg', '001.jpg', 'jpg', 'comic', 't', 't')")
            .execute(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let entries = entries_in_pool(&pool, "book").await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "page");
        save_entry_in_pool(&pool, "book", "page", BookEntryInput { title: Some("第一卷".into()), volume_number: Some(1.0), chapter_number: None, read_state: "reading".into() }).await.unwrap();
        sqlx::query("UPDATE media_files SET path = 'D:\\Moved\\01\\001.jpg' WHERE id = 'page'").execute(&pool).await.unwrap();
        let entries = entries_in_pool(&pool, "book").await.unwrap();
        assert_eq!(entries[0].title, "第一卷");
        assert_eq!(entries[0].read_state, "reading");
        crate::migration_compat::run(&pool).await.unwrap();
    }
}
