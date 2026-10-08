//! Structured personal data package. Never exports the live database or access credentials.
use crate::{
    db::AppState,
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use std::collections::{BTreeMap, BTreeSet};
const MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Work {
    pub portable_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub kind: String,
    pub description: String,
    pub status: String,
    pub favorite: bool,
    pub rating: Option<f64>,
    pub notes: String,
    pub public_ids: BTreeMap<String, String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub year: Option<i64>,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileHint {
    pub work: String,
    pub name: String,
    pub size: i64,
    pub kind: String,
    pub extension: String,
}
#[derive(Debug, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reading {
    pub kind: String,
    pub book: String,
    pub group: String,
    pub entry: String,
    pub location: String,
    pub updated_at: String,
}
#[derive(Debug, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub kind: String,
    pub book: String,
    pub group: String,
    pub entry: String,
    pub location: String,
    pub label: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Package {
    pub format: String,
    pub version: u32,
    pub works: Vec<Work>,
    pub files: Vec<FileHint>,
    #[serde(default)]
    pub reading: Vec<Reading>,
    #[serde(default)]
    pub bookmarks: Vec<Bookmark>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SharedPackage {
    format: String,
    version: u32,
    library_id: String,
    data: Package,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkPreview {
    pub portable_id: String,
    pub title: String,
    pub existing: Option<String>,
    pub ambiguous: bool,
}
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FileCandidate {
    pub id: String,
    pub file_name: String,
    pub path: String,
    pub work_title: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub work: String,
    pub name: String,
    pub candidates: Vec<FileCandidate>,
}
#[derive(Debug, Serialize)]
pub struct Preview {
    pub works: Vec<WorkPreview>,
    pub files: Vec<FilePreview>,
    pub reading: usize,
    pub bookmarks: usize,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportChoice {
    pub portable_id: String,
    pub overwrite_existing: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileBinding {
    pub file_index: usize,
    pub media_file_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub created: usize,
    pub preserved: usize,
    pub updated: usize,
    pub matched_files: usize,
    pub reading: usize,
    pub bookmarks: usize,
}
fn invalid(message: &str) -> AppError {
    AppError::Validation(message.into())
}
fn kind(value: &str) -> bool {
    matches!(value, "video" | "comic" | "novel" | "game" | "other")
}
fn safe_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && !value.contains(['/', '\\', '\0'])
        && !value.chars().any(char::is_control)
}
fn reading_location(kind: &str, book: &str, group: &str, entry: &str, location: &str) -> bool {
    let id = |value: &str| {
        !value.is_empty()
            && value.len() <= 200
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
    };
    if !matches!(kind, "comic" | "novel")
        || !id(book)
        || !id(entry)
        || (!group.is_empty() && !id(group))
        || location.len() > 16384
    {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(location) else {
        return false;
    };
    let Some(fields) = value.as_object() else {
        return false;
    };
    if kind == "comic" {
        return fields
            .keys()
            .all(|key| matches!(key.as_str(), "pageIndex" | "offset"))
            && value["pageIndex"]
                .as_u64()
                .is_some_and(|page| page < 100000)
            && value["offset"].as_f64().unwrap_or(0.0).is_finite()
            && (0.0..=1.0).contains(&value["offset"].as_f64().unwrap_or(0.0));
    }
    if !fields
        .keys()
        .all(|key| matches!(key.as_str(), "href" | "type" | "title" | "locations"))
    {
        return false;
    }
    for field in ["type", "title"] {
        if !value[field].is_null() && !value[field].as_str().is_some_and(|s| s.len() <= 4096) {
            return false;
        }
    }
    if let Some(locations) = value.get("locations") {
        let Some(locations) = locations.as_object() else {
            return false;
        };
        if !locations.keys().all(|key| {
            matches!(
                key.as_str(),
                "fragments" | "progression" | "totalProgression" | "position" | "cssSelector"
            )
        }) {
            return false;
        }
        for field in ["progression", "totalProgression"] {
            if locations
                .get(field)
                .is_some_and(|number| !number.as_f64().is_some_and(|n| (0.0..=1.0).contains(&n)))
            {
                return false;
            }
        }
        if locations
            .get("position")
            .is_some_and(|number| !number.as_u64().is_some_and(|n| n > 0 && n < 10000000))
        {
            return false;
        }
        if locations.get("cssSelector").is_some_and(|s| {
            !s.as_str()
                .is_some_and(|s| s.len() < 4096 && !s.chars().any(char::is_control))
        }) {
            return false;
        }
        if locations.get("fragments").is_some_and(|array| {
            !array.as_array().is_some_and(|a| {
                a.len() <= 100
                    && a.iter().all(|v| {
                        v.as_str()
                            .is_some_and(|s| s.len() < 2048 && !s.chars().any(char::is_control))
                    })
            })
        }) {
            return false;
        }
    }
    let Some(href) = value["href"].as_str() else {
        return false;
    };
    !href.is_empty()
        && href.len() < 2048
        && !href.starts_with('/')
        && !href.contains([':', '\\', '?'])
        && !href.split('/').any(|part| part == "..")
}
fn parse(bytes: &[u8]) -> AppResult<Package> {
    if bytes.len() > MAX_BYTES {
        return Err(invalid("资料包超过16MiB限制"));
    }
    let package: Package = serde_json::from_slice(bytes)?;
    if package.format != "genzo-personal-data"
        || package.version != 1
        || package.works.len() > 10000
        || package.files.len() > 100000
    {
        return Err(invalid("资料包版本或记录数量不支持"));
    }
    let mut identities = BTreeSet::new();
    for work in &package.works {
        if uuid::Uuid::parse_str(&work.portable_id).is_err()
            || !identities.insert(work.portable_id.clone())
            || !kind(&work.kind)
            || work.title.trim().is_empty()
            || work.title.len() > 4096
            || work.description.len() > 256 * 1024
            || work.notes.len() > 256 * 1024
            || !matches!(
                work.status.as_str(),
                "planned" | "in_progress" | "completed" | "paused" | "dropped"
            )
            || work
                .rating
                .is_some_and(|value| !value.is_finite() || !(0.0..=10.0).contains(&value))
            || work
                .year
                .is_some_and(|value| !(1000..=2200).contains(&value))
            || work.original_title.as_ref().is_some_and(|s| s.len() > 4096)
            || [&work.cover_url, &work.banner_url].iter().any(|value| {
                value
                    .as_ref()
                    .is_some_and(|s| s.len() > 4096 || !genzo_sync::protocol::public_url(s))
            })
            || work.tags.len() > 1000
            || work.tags.iter().any(|tag| {
                tag.trim().is_empty() || tag.len() > 160 || tag.chars().any(char::is_control)
            })
        {
            return Err(invalid("资料包作品记录无效"));
        }
        for (provider, id) in &work.public_ids {
            if !matches!(
                provider.as_str(),
                "bangumi" | "tmdb" | "anilist" | "copymanga" | "copynovel"
            ) || id.is_empty()
                || id.len() > 200
                || !id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-'))
            {
                return Err(invalid("资料包公开来源标识无效"));
            }
        }
    }
    if package.files.iter().any(|file| {
        !identities.contains(&file.work)
            || !safe_name(&file.name)
            || file.size < 0
            || !kind(&file.kind)
            || file.extension.len() > 32
            || !file.extension.chars().all(|c| c.is_ascii_alphanumeric())
    }) {
        return Err(invalid("资料包文件描述无效，不能包含设备路径"));
    }
    if package.reading.len() > 10000
        || package.bookmarks.len() > 10000
        || package.reading.iter().any(|row| {
            !reading_location(&row.kind, &row.book, &row.group, &row.entry, &row.location)
        })
        || package.bookmarks.iter().any(|row| {
            row.label.len() > 4096
                || !reading_location(&row.kind, &row.book, &row.group, &row.entry, &row.location)
        })
    {
        return Err(invalid("资料包阅读记录无效"));
    }
    Ok(package)
}

pub async fn export(pool: &SqlitePool) -> AppResult<Vec<u8>> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let rows:Vec<(String,String,Option<String>,String,String,String,bool,Option<f64>,String,Option<i64>,Option<String>,Option<String>)>=sqlx::query_as("SELECT id,title,original_title,type,description,status,favorite,rating,notes,metadata_year,cover_path,banner_path FROM works ORDER BY created_at,id").fetch_all(&mut *tx).await?;
    if rows.len() > 10000 {
        return Err(invalid("作品数量超过资料包限制"));
    }
    let mut works = Vec::new();
    let mut mapping = BTreeMap::new();
    for (
        id,
        title,
        original_title,
        kind,
        description,
        status,
        favorite,
        rating,
        notes,
        year,
        cover,
        banner,
    ) in rows
    {
        sqlx::query(
            "INSERT OR IGNORE INTO portable_work_identity(local_work_id,portable_id) VALUES(?,?)",
        )
        .bind(&id)
        .bind(uuid::Uuid::new_v4().to_string())
        .execute(&mut *tx)
        .await?;
        let portable_id: String = sqlx::query_scalar(
            "SELECT portable_id FROM portable_work_identity WHERE local_work_id=?",
        )
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO portable_work_aliases(portable_id,local_work_id) VALUES(?,?)",
        )
        .bind(&portable_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        let public_ids=sqlx::query_as::<_,(String,String)>("SELECT provider,external_id FROM work_external_ids WHERE work_id=? AND provider IN ('bangumi','tmdb','anilist','copymanga','copynovel')").bind(&id).fetch_all(&mut *tx).await?.into_iter().collect();
        let tags=sqlx::query_scalar("SELECT t.name FROM tags t JOIN work_tags w ON w.tag_id=t.id WHERE w.work_id=? ORDER BY t.name").bind(&id).fetch_all(&mut *tx).await?;
        let cover_url = cover.filter(|url| genzo_sync::protocol::public_url(url));
        let banner_url = banner.filter(|url| genzo_sync::protocol::public_url(url));
        mapping.insert(id, portable_id.clone());
        works.push(Work {
            portable_id,
            title,
            original_title,
            kind,
            description,
            status,
            favorite,
            rating,
            notes,
            public_ids,
            tags,
            year,
            cover_url,
            banner_url,
        });
    }
    let rows:Vec<(String,String,i64,String,String)>=sqlx::query_as("SELECT work_id,file_name,size,media_type,extension FROM media_files WHERE work_id IS NOT NULL ORDER BY id").fetch_all(&mut *tx).await?;
    let files = rows
        .into_iter()
        .filter_map(|(work, name, size, kind, extension)| {
            mapping.get(&work).map(|work| FileHint {
                work: work.clone(),
                name,
                size,
                kind,
                extension,
            })
        })
        .collect();
    let mut reading:Vec<Reading>=sqlx::query_as("SELECT kind,book_id book,group_id `group`,entry_id entry,location_json location,updated_at FROM android_reading_progress ORDER BY updated_at").fetch_all(&mut *tx).await?;
    let mut bookmarks:Vec<Bookmark>=sqlx::query_as("SELECT kind,book_id book,group_id `group`,entry_id entry,location_json location,label FROM android_reading_bookmarks ORDER BY created_at").fetch_all(&mut *tx).await?;
    // Readium's text context contains excerpts. Positions do not need those excerpts.
    for location in reading
        .iter_mut()
        .map(|row| &mut row.location)
        .chain(bookmarks.iter_mut().map(|row| &mut row.location))
    {
        let mut value: serde_json::Value = serde_json::from_str(location)?;
        if let Some(fields) = value.as_object_mut() {
            fields.remove("text");
        }
        *location = serde_json::to_string(&value)?;
    }
    let package = Package {
        format: "genzo-personal-data".into(),
        version: 1,
        works,
        files,
        reading,
        bookmarks,
    };
    let bytes = serde_json::to_vec_pretty(&package)?;
    parse(&bytes)?;
    tx.commit().await?;
    Ok(bytes)
}

async fn candidates_in(
    connection: &mut sqlx::SqliteConnection,
    work: &Work,
) -> AppResult<BTreeSet<String>> {
    let mut matches = BTreeSet::new();
    if let Some((id,kind))=sqlx::query_as::<_,(String,String)>("SELECT p.local_work_id,w.type FROM portable_work_aliases p JOIN works w ON w.id=p.local_work_id WHERE p.portable_id=?").bind(&work.portable_id).fetch_optional(&mut *connection).await? {
        if kind!=work.kind{return Err(invalid("资料包身份对应的本机作品类型不一致"));}matches.insert(id);
    }
    for (provider, id) in &work.public_ids {
        let rows:Vec<String>=sqlx::query_scalar("SELECT w.id FROM works w JOIN work_external_ids e ON e.work_id=w.id WHERE w.type=? AND e.provider=? AND e.external_id=?").bind(&work.kind).bind(provider).bind(id).fetch_all(&mut *connection).await?;
        matches.extend(rows);
    }
    Ok(matches)
}
async fn candidates(pool: &SqlitePool, work: &Work) -> AppResult<BTreeSet<String>> {
    candidates_in(&mut *pool.acquire().await?, work).await
}

pub async fn apply(
    pool: &SqlitePool,
    bytes: &[u8],
    choices: Vec<ImportChoice>,
    bindings: Vec<FileBinding>,
) -> AppResult<ImportResult> {
    apply_with_reading(pool, bytes, choices, bindings, false, false).await
}
pub async fn apply_with_reading(
    pool: &SqlitePool,
    bytes: &[u8],
    choices: Vec<ImportChoice>,
    bindings: Vec<FileBinding>,
    include_reading: bool,
    overwrite_reading: bool,
) -> AppResult<ImportResult> {
    let package = parse(bytes)?;
    let mut selected = BTreeMap::new();
    for choice in choices {
        if !package
            .works
            .iter()
            .any(|work| work.portable_id == choice.portable_id)
            || selected
                .insert(choice.portable_id, choice.overwrite_existing)
                .is_some()
        {
            return Err(invalid("请选择资料包中唯一的作品记录"));
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    let mut result = ImportResult {
        created: 0,
        preserved: 0,
        updated: 0,
        matched_files: 0,
        reading: 0,
        bookmarks: 0,
    };
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let mut mapping = BTreeMap::new();
    for work in package
        .works
        .iter()
        .filter(|work| selected.contains_key(&work.portable_id))
    {
        let matches = candidates_in(&mut *tx, work).await?;
        if matches.len() > 1 {
            return Err(invalid("公开来源标识对应多部本机作品，请先核对后再导入"));
        }
        let prior = matches.first().cloned();
        let id = prior
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let overwrite = selected[&work.portable_id];
        if prior.is_none() {
            sqlx::query("INSERT INTO works(id,title,original_title,type,description,status,favorite,rating,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
                .bind(&id).bind(&work.title).bind(&work.original_title).bind(&work.kind).bind(&work.description).bind(&work.status).bind(work.favorite).bind(work.rating).bind(&work.notes).bind(&now).bind(&now).execute(&mut *tx).await?;
            result.created += 1;
        } else if overwrite {
            let existing_kind: String = sqlx::query_scalar("SELECT type FROM works WHERE id=?")
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
            if existing_kind != work.kind {
                return Err(invalid("导入作品类型与本机记录不一致"));
            }
            sqlx::query("UPDATE works SET title=?,original_title=?,description=?,status=?,favorite=?,rating=?,notes=?,updated_at=? WHERE id=?")
                .bind(&work.title).bind(&work.original_title).bind(&work.description).bind(&work.status).bind(work.favorite).bind(work.rating).bind(&work.notes).bind(&now).bind(&id).execute(&mut *tx).await?;
            result.updated += 1;
        } else {
            result.preserved += 1;
        }
        // A receiver keeps its own local ID; the portable ID makes repeated imports idempotent.
        sqlx::query(
            "INSERT OR IGNORE INTO portable_work_identity(local_work_id,portable_id) VALUES(?,?)",
        )
        .bind(&id)
        .bind(&work.portable_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO portable_work_aliases(portable_id,local_work_id) VALUES(?,?)",
        )
        .bind(&work.portable_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if prior.is_none() || overwrite {
            sqlx::query("UPDATE works SET metadata_year=?,cover_path=COALESCE(?,cover_path),banner_path=COALESCE(?,banner_path) WHERE id=?")
                .bind(work.year).bind(&work.cover_url).bind(&work.banner_url).bind(&id).execute(&mut *tx).await?;
            for (provider, external) in &work.public_ids {
                sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(work_id,provider) DO UPDATE SET external_id=excluded.external_id,updated_at=excluded.updated_at")
                .bind(&id).bind(provider).bind(external).bind(&now).bind(&now).execute(&mut *tx).await?;
            }
            if overwrite {
                sqlx::query("DELETE FROM work_tags WHERE work_id=?")
                    .bind(&id)
                    .execute(&mut *tx)
                    .await?;
            }
            for name in &work.tags {
                sqlx::query("INSERT OR IGNORE INTO tags(id,name,created_at) VALUES(?,?,?)")
                    .bind(uuid::Uuid::new_v4().to_string())
                    .bind(name)
                    .bind(&now)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("INSERT OR IGNORE INTO work_tags(work_id,tag_id) SELECT ?,id FROM tags WHERE name=? COLLATE NOCASE").bind(&id).bind(name).execute(&mut *tx).await?;
            }
        }
        mapping.insert(work.portable_id.clone(), id);
    }
    let mut used = BTreeSet::new();
    for binding in bindings {
        let file = package
            .files
            .get(binding.file_index)
            .ok_or_else(|| invalid("文件描述索引无效"))?;
        let work = mapping
            .get(&file.work)
            .ok_or_else(|| invalid("请先选择该文件所属作品"))?;
        if !used.insert(binding.media_file_id.clone()) {
            return Err(invalid("同一本机文件不能重复关联"));
        }
        let existing:Option<(Option<String>,String,i64,String,String,bool)>=sqlx::query_as("SELECT work_id,file_name,size,media_type,extension,missing FROM media_files WHERE id=?").bind(&binding.media_file_id).fetch_optional(&mut *tx).await?;
        let Some((old, name, size, kind, extension, missing)) = existing else {
            return Err(invalid("本机文件已不存在，请重新预览"));
        };
        if missing
            || name.to_lowercase() != file.name.to_lowercase()
            || size != file.size
            || kind != file.kind
            || extension != file.extension
            || old.as_ref().is_some_and(|id| id != work)
        {
            return Err(invalid("文件匹配已变化或文件已属于另一作品，请重新核对"));
        }
        sqlx::query("UPDATE media_files SET work_id=?,updated_at=? WHERE id=?")
            .bind(work)
            .bind(&now)
            .bind(binding.media_file_id)
            .execute(&mut *tx)
            .await?;
        result.matched_files += 1;
    }
    if include_reading {
        for row in package.reading {
            let sql = if overwrite_reading {
                "INSERT INTO android_reading_progress VALUES(?,?,?,?,?,?) ON CONFLICT(kind,book_id,group_id,entry_id) DO UPDATE SET location_json=excluded.location_json,updated_at=excluded.updated_at"
            } else {
                "INSERT OR IGNORE INTO android_reading_progress VALUES(?,?,?,?,?,?)"
            };
            result.reading += sqlx::query(sql)
                .bind(row.kind)
                .bind(row.book)
                .bind(row.group)
                .bind(row.entry)
                .bind(row.location)
                .bind(row.updated_at)
                .execute(&mut *tx)
                .await?
                .rows_affected() as usize;
        }
        for row in package.bookmarks {
            let existing:Vec<String>=sqlx::query_scalar("SELECT location_json FROM android_reading_bookmarks WHERE kind=? AND book_id=? AND group_id=? AND entry_id=?")
                .bind(&row.kind).bind(&row.book).bind(&row.group).bind(&row.entry).fetch_all(&mut *tx).await?;
            let incoming: serde_json::Value = serde_json::from_str(&row.location)?;
            let already_saved = existing.into_iter().any(|location| {
                serde_json::from_str::<serde_json::Value>(&location).is_ok_and(|mut value| {
                    if let Some(fields) = value.as_object_mut() {
                        fields.remove("text");
                    }
                    value == incoming
                })
            });
            if already_saved {
                continue;
            }
            result.bookmarks+=sqlx::query("INSERT OR IGNORE INTO android_reading_bookmarks(id,kind,book_id,group_id,entry_id,location_json,label,created_at) VALUES(?,?,?,?,?,?,?,?)")
                .bind(uuid::Uuid::new_v4().to_string()).bind(row.kind).bind(row.book).bind(row.group).bind(row.entry).bind(row.location).bind(row.label).bind(&now).execute(&mut *tx).await?.rows_affected() as usize;
        }
    }
    tx.commit().await?;
    Ok(result)
}
pub async fn preview(pool: &SqlitePool, bytes: &[u8]) -> AppResult<Preview> {
    let package = parse(bytes)?;
    let mut works = Vec::new();
    let mut files = Vec::new();
    for work in &package.works {
        let matches = candidates(pool, work).await?;
        works.push(WorkPreview {
            portable_id: work.portable_id.clone(),
            title: work.title.clone(),
            existing: if matches.len() == 1 {
                matches.first().cloned()
            } else {
                None
            },
            ambiguous: matches.len() > 1,
        });
    }
    for file in package.files {
        let candidates=sqlx::query_as::<_,FileCandidate>("SELECT m.id,m.file_name,m.path,w.title work_title FROM media_files m LEFT JOIN works w ON w.id=m.work_id WHERE m.file_name=? COLLATE NOCASE AND m.size=? AND m.media_type=? AND m.extension=? AND m.missing=0").bind(&file.name).bind(file.size).bind(file.kind).bind(file.extension).fetch_all(pool).await?;
        files.push(FilePreview {
            work: file.work,
            name: file.name,
            candidates,
        });
    }
    Ok(Preview {
        works,
        files,
        reading: package.reading.len(),
        bookmarks: package.bookmarks.len(),
    })
}

#[tauri::command]
pub async fn export_personal_data(state: tauri::State<'_, AppState>) -> AppResult<String> {
    String::from_utf8(export(&state.pool).await?).map_err(|_| invalid("资料包编码失败"))
}
#[tauri::command]
pub async fn export_personal_data_file(
    state: tauri::State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let data =
        String::from_utf8(export(&state.pool).await?).map_err(|_| invalid("资料包编码失败"))?;
    crate::android_bridge::call("exportDataPackage", serde_json::json!({"data":data})).await
}
#[tauri::command]
pub async fn pick_personal_data_file() -> AppResult<serde_json::Value> {
    crate::android_bridge::call("importDataPackage", serde_json::json!({})).await
}
fn shared_package(bytes: &[u8], library_id: &str) -> AppResult<SharedPackage> {
    if bytes.len() > MAX_BYTES {
        return Err(invalid("资料包超过16MiB限制"));
    }
    let package: SharedPackage = serde_json::from_slice(bytes)?;
    if package.format != "genzo-shared-package"
        || package.version != 1
        || package.library_id != library_id
    {
        return Err(invalid("共享资料包版本或同步空间不一致"));
    }
    parse(&serde_json::to_vec(&package.data)?)?;
    Ok(package)
}
#[tauri::command]
pub async fn publish_personal_data(state: tauri::State<'_, AppState>) -> AppResult<()> {
    let library_id: String = sqlx::query_scalar(
        "SELECT library_id FROM sync_runtime WHERE id=1 AND library_id IS NOT NULL",
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| invalid("请先连接 WebDAV 同步空间"))?;
    let dav = crate::personal_sync::transport(&state.pool).await?;
    let remote = dav
        .read_package()
        .await
        .map_err(|e| invalid(&format!("共享资料包读取失败：{e}")))?;
    if let Some((bytes, _)) = &remote {
        shared_package(bytes, &library_id)?;
    }
    let data = parse(&export(&state.pool).await?)?;
    let bytes = serde_json::to_vec(&SharedPackage {
        format: "genzo-shared-package".into(),
        version: 1,
        library_id,
        data,
    })?;
    dav.write_package(bytes, remote.as_ref().map(|(_, etag)| etag.as_str()))
        .await
        .map_err(|e| invalid(&format!("共享资料包未完成保存，请重试：{e}")))
}
#[tauri::command]
pub async fn fetch_personal_data(state: tauri::State<'_, AppState>) -> AppResult<String> {
    let library_id: String = sqlx::query_scalar(
        "SELECT library_id FROM sync_runtime WHERE id=1 AND library_id IS NOT NULL",
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| invalid("请先连接 WebDAV 同步空间"))?;
    let dav = crate::personal_sync::transport(&state.pool).await?;
    let (bytes, _) = dav
        .read_package()
        .await
        .map_err(|e| invalid(&format!("共享资料包读取失败：{e}")))?
        .ok_or_else(|| invalid("此空间尚未保存共享资料包"))?;
    let package = shared_package(&bytes, &library_id)?;
    serde_json::to_string(&package.data).map_err(Into::into)
}
#[tauri::command]
pub async fn save_personal_data_file(
    path: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    if cfg!(target_os = "android") {
        return Err(invalid("请使用系统文件选择器保存资料包"));
    }
    let bytes = export(&state.pool).await?;
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        Ok(())
    })
    .await
    .map_err(|error| AppError::System(error.to_string()))?
}
#[tauri::command]
pub async fn read_personal_data_file(path: String) -> AppResult<String> {
    if cfg!(target_os = "android") {
        return Err(invalid("请使用系统文件选择器读取资料包"));
    }
    tokio::task::spawn_blocking(move || -> AppResult<String> {
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)?
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        parse(&bytes)?;
        String::from_utf8(bytes).map_err(|_| invalid("资料包必须为UTF-8"))
    })
    .await
    .map_err(|error| AppError::System(error.to_string()))?
}
#[tauri::command]
pub async fn preview_personal_data(
    data: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<Preview> {
    preview(&state.pool, data.as_bytes()).await
}
#[tauri::command]
pub async fn import_personal_data(
    data: String,
    choices: Vec<ImportChoice>,
    bindings: Vec<FileBinding>,
    include_reading: Option<bool>,
    overwrite_reading: Option<bool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<ImportResult> {
    let result = apply_with_reading(
        &state.pool,
        data.as_bytes(),
        choices,
        bindings,
        include_reading.unwrap_or(false),
        overwrite_reading.unwrap_or(false),
    )
    .await?;
    use tauri::Emitter;
    let _ = app.emit("sync-library-updated", ());
    crate::personal_sync::request();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn import_keeps_reading_times_so_latest_chapter_stays_latest() {
        let source = crate::db::test_pool().await.unwrap();
        let target = crate::db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO android_reading_progress VALUES('comic','book','default','one','{\"pageIndex\":3}','2026-10-07T09:00:00Z'),('comic','book','default','two','{\"pageIndex\":9}','2026-10-08T09:00:00Z')").execute(&source).await.unwrap();
        let bytes = export(&source).await.unwrap();
        apply_with_reading(&target, &bytes, vec![], vec![], true, false)
            .await
            .unwrap();
        assert_eq!(sqlx::query_as::<_,(String,String)>("SELECT entry_id,updated_at FROM android_reading_progress ORDER BY updated_at DESC LIMIT 1").fetch_one(&target).await.unwrap(),("two".into(),"2026-10-08T09:00:00Z".into()));
    }
    #[test]
    fn nested_locator_and_shared_library_identity_are_validated() {
        for location in [
            r#"{"href":"OEBPS/chapter.xhtml","locations":{"totalProgression":2}}"#,
            r#"{"href":"OEBPS/chapter.xhtml","locations":{"password":"secret"}}"#,
            r#"{"href":"OEBPS/chapter.xhtml","text":{"highlight":"body text"}}"#,
            r#"{"href":"../secret"}"#,
        ] {
            assert!(!reading_location(
                "novel", "book", "default", "one", location
            ));
        }
        assert!(reading_location(
            "novel",
            "book",
            "default",
            "one",
            r##"{"href":"OEBPS/chapter.xhtml","locations":{"cssSelector":"#p10","totalProgression":0.5,"fragments":[]}}"##
        ));
        let bytes=br#"{"format":"genzo-shared-package","version":1,"libraryId":"A","data":{"format":"genzo-personal-data","version":1,"works":[],"files":[]}}"#;
        assert!(shared_package(bytes, "A").is_ok());
        assert!(shared_package(bytes, "B").is_err());
    }
    #[tokio::test]
    async fn imported_alias_survives_receiver_export_and_public_id_changes() {
        let source = crate::db::test_pool().await.unwrap();
        let target = crate::db::test_pool().await.unwrap();
        for pool in [&source, &target] {
            sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('book','同一书','novel','t','t')").execute(pool).await.unwrap();
            sqlx::query("INSERT INTO work_external_ids VALUES('book','bangumi','42','t','t')")
                .execute(pool)
                .await
                .unwrap();
        }
        export(&target).await.unwrap();
        let bytes = export(&source).await.unwrap();
        let key = parse(&bytes).unwrap().works[0].portable_id.clone();
        let choices = || {
            vec![ImportChoice {
                portable_id: key.clone(),
                overwrite_existing: false,
            }]
        };
        assert_eq!(
            apply(&target, &bytes, choices(), vec![])
                .await
                .unwrap()
                .preserved,
            1
        );
        sqlx::query("DELETE FROM work_external_ids")
            .execute(&target)
            .await
            .unwrap();
        assert_eq!(
            apply(&target, &bytes, choices(), vec![])
                .await
                .unwrap()
                .preserved,
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM works")
                .fetch_one(&target)
                .await
                .unwrap(),
            1
        );
    }
    #[tokio::test]
    async fn reading_import_is_opt_in_and_existing_locations_are_preserved_by_default() {
        let source = crate::db::test_pool().await.unwrap();
        let target = crate::db::test_pool().await.unwrap();
        for (pool, location) in [
            (
                &source,
                r#"{"href":"OEBPS/chapter.xhtml","locations":{"totalProgression":0.5}}"#,
            ),
            (
                &target,
                r#"{"locations":{"totalProgression":0.5},"text":{"highlight":"excerpt"},"href":"OEBPS/chapter.xhtml"}"#,
            ),
        ] {
            sqlx::query("INSERT INTO android_reading_bookmarks VALUES('bookmark','novel','book','default','one',?,'saved','t')").bind(location).execute(pool).await.unwrap();
        }
        sqlx::query("INSERT INTO android_reading_progress VALUES('comic','book','default','one','{\"pageIndex\":3,\"offset\":0.5}','t')").execute(&source).await.unwrap();
        sqlx::query("INSERT INTO android_reading_progress VALUES('comic','book','default','one','{\"pageIndex\":1}','t')").execute(&target).await.unwrap();
        let bytes = export(&source).await.unwrap();
        let preview = preview(&target, &bytes).await.unwrap();
        assert_eq!(preview.reading, 1);
        apply_with_reading(&target, &bytes, vec![], vec![], true, false)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT location_json FROM android_reading_progress")
                .fetch_one(&target)
                .await
                .unwrap(),
            "{\"pageIndex\":1}"
        );
        apply_with_reading(&target, &bytes, vec![], vec![], true, true)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM android_reading_bookmarks")
                .fetch_one(&target)
                .await
                .unwrap(),
            1
        );
        assert!(sqlx::query_scalar::<_, String>(
            "SELECT location_json FROM android_reading_progress"
        )
        .fetch_one(&target)
        .await
        .unwrap()
        .contains("3"));
        assert!(!reading_location(
            "novel",
            "book",
            "",
            "one",
            "{\"href\":\"https://private.example\"}"
        ));
    }
    #[tokio::test]
    async fn roundtrip_preserves_receiver_records_and_requires_explicit_file_binding() {
        let source = crate::db::test_pool().await.unwrap();
        let target = crate::db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('source','导入书','novel','发送笔记','t','t')").execute(&source).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,media_type,extension,size,created_at,updated_at) VALUES('source-file','source','C:/book.epub','book.epub','novel','epub',12,'t','t')").execute(&source).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,path,file_name,media_type,extension,size,created_at,updated_at) VALUES('receiver-file','/own/book.epub','book.epub','novel','epub',12,'t','t')").execute(&target).await.unwrap();
        let bytes = export(&source).await.unwrap();
        let key = parse(&bytes).unwrap().works[0].portable_id.clone();
        let choice = || {
            vec![ImportChoice {
                portable_id: key.clone(),
                overwrite_existing: false,
            }]
        };
        assert_eq!(
            apply(&target, &bytes, choice(), vec![])
                .await
                .unwrap()
                .created,
            1
        );
        assert!(sqlx::query_scalar::<_, Option<String>>(
            "SELECT work_id FROM media_files WHERE id='receiver-file'"
        )
        .fetch_one(&target)
        .await
        .unwrap()
        .is_none());
        sqlx::query("UPDATE works SET notes='本机笔记'")
            .execute(&target)
            .await
            .unwrap();
        let result = apply(
            &target,
            &bytes,
            choice(),
            vec![FileBinding {
                file_index: 0,
                media_file_id: "receiver-file".into(),
            }],
        )
        .await
        .unwrap();
        assert_eq!(
            (result.created, result.preserved, result.matched_files),
            (0, 1, 1)
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT notes FROM works")
                .fetch_one(&target)
                .await
                .unwrap(),
            "本机笔记"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT path FROM media_files WHERE id='receiver-file'"
            )
            .fetch_one(&target)
            .await
            .unwrap(),
            "/own/book.epub"
        );
        let mut package = parse(&bytes).unwrap();
        package.files[0].size = 99;
        assert!(apply(
            &target,
            &serde_json::to_vec(&package).unwrap(),
            vec![ImportChoice {
                portable_id: key,
                overwrite_existing: true
            }],
            vec![FileBinding {
                file_index: 0,
                media_file_id: "receiver-file".into()
            }]
        )
        .await
        .is_err());
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT notes FROM works")
                .fetch_one(&target)
                .await
                .unwrap(),
            "本机笔记"
        );
    }
    #[tokio::test]
    async fn exports_all_work_kinds_without_device_paths_or_passwords_and_previews_ambiguity() {
        let pool = crate::db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('book','同名书','novel','个人笔记','t','t')").execute(&pool).await.unwrap();
        for kind in ["video", "comic", "game", "other"] {
            sqlx::query(
                "INSERT INTO works(id,title,type,created_at,updated_at) VALUES(?,?,?,'t','t')",
            )
            .bind(kind)
            .bind(kind)
            .bind(kind)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query("UPDATE works SET metadata_year=2024,cover_path='https://public.example/cover.jpg',banner_path='C:/private/banner.jpg' WHERE id='book'").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO android_reading_progress VALUES('novel','book','default','one','{\"href\":\"OEBPS/chapter.xhtml\",\"text\":{\"highlight\":\"private-body-excerpt\"}}','t')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,media_type,extension,size,created_at,updated_at) VALUES('file','book','C:/private/book.epub','book.epub','novel','epub',12,'t','t'),('other',NULL,'D:/other/book.epub','book.epub','novel','epub',12,'t','t')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO app_settings VALUES('secret','password-not-exported','t')")
            .execute(&pool)
            .await
            .unwrap();
        let bytes = export(&pool).await.unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(
            !text.contains("C:/private")
                && !text.contains("password-not-exported")
                && !text.contains("private-body-excerpt")
        );
        let parsed = parse(&bytes).unwrap();
        assert_eq!(parsed.works.len(), 5);
        let book = parsed
            .works
            .iter()
            .find(|work| work.kind == "novel")
            .unwrap();
        assert_eq!(book.year, Some(2024));
        assert_eq!(
            book.cover_url.as_deref(),
            Some("https://public.example/cover.jpg")
        );
        assert!(book.banner_url.is_none());
        assert_eq!(
            preview(&pool, &bytes).await.unwrap().files[0]
                .candidates
                .len(),
            2
        );
        let repeated = parse(&export(&pool).await.unwrap()).unwrap();
        assert_eq!(repeated.works[0].portable_id, parsed.works[0].portable_id);
        let invalid = text.replace("book.epub", "../secret");
        assert!(parse(invalid.as_bytes()).is_err());
    }
}
