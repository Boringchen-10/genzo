//! Explicit confirmations teach recommendations. Never changes files on disk.
use crate::{
    db::{self, AppState},
    error::{AppError, AppResult},
    models::MediaFile,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};
use tauri::State;

fn key(file: &MediaFile, root: Option<&str>) -> Option<(String, String, String)> {
    let parsed = crate::anime_parser::parse_media_path(
        &file.file_name,
        Path::new(&crate::remote_storage::display_path(&file.path)),
        root.map(Path::new),
    );
    let title = crate::anime_parser::normalize_title(parsed.title.as_deref()?);
    if title.chars().count() < 2 || title.chars().all(|c| c.is_numeric()) {
        return None;
    }
    Some((
        title,
        parsed
            .season
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown".into()),
        parsed.special_type.unwrap_or_default(),
    ))
}

pub async fn learn(tx: &mut Transaction<'_, Sqlite>, work: &str, ids: &[String]) -> AppResult<()> {
    let anchors: Vec<(String, String)> =
        sqlx::query_as("SELECT provider,external_id FROM work_external_ids WHERE work_id=?")
            .bind(work)
            .fetch_all(&mut **tx)
            .await?;
    let kind = if anchors.iter().any(|(p, _)| p == "bangumi") {
        "anime"
    } else if let Some((_, id)) = anchors.iter().find(|(p, _)| p == "tmdb") {
        if id.starts_with("movie/") {
            "movie"
        } else if id.starts_with("tv/") {
            "tv"
        } else {
            return Ok(());
        }
    } else {
        return Ok(());
    };
    let files: Vec<MediaFile> = sqlx::query_as("SELECT * FROM media_files WHERE id IN (SELECT value FROM json_each(?)) AND work_id=? AND media_type='video'")
        .bind(serde_json::to_string(ids)?).bind(work).fetch_all(&mut **tx).await?;
    let mut roots = HashMap::new();
    let mut learned = HashSet::new();
    for file in files {
        let Some(root_id) = &file.library_root_id else {
            continue;
        };
        if !roots.contains_key(root_id) {
            let path: Option<String> =
                sqlx::query_scalar("SELECT path FROM library_roots WHERE id=?")
                    .bind(root_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            roots.insert(root_id.clone(), path);
        }
        let root = roots.get(root_id).and_then(|r| r.as_deref());
        let Some((title, season, special)) = key(&file, root) else {
            continue;
        };
        if !learned.insert((
            root_id.clone(),
            title.clone(),
            season.clone(),
            special.clone(),
        )) {
            continue;
        }
        sqlx::query("INSERT INTO recognition_preferences(id,root_id,title_key,season_key,special_key,kind,work_id,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(root_id,title_key,season_key,special_key,kind,work_id) DO UPDATE SET updated_at=excluded.updated_at")
            .bind(uuid::Uuid::new_v4().to_string()).bind(root_id).bind(title).bind(season).bind(special).bind(kind).bind(work).bind(chrono::Utc::now().to_rfc3339()).execute(&mut **tx).await?;
    }
    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    id: String,
    work_id: String,
    title: String,
    kind: String,
    updated_at: String,
}

async fn suggestions(pool: &SqlitePool, media: &str, kind: &str) -> AppResult<Vec<Suggestion>> {
    let file: MediaFile = sqlx::query_as("SELECT * FROM media_files WHERE id=?")
        .bind(media)
        .fetch_one(pool)
        .await?;
    let Some(root_id) = &file.library_root_id else {
        return Ok(vec![]);
    };
    let root: Option<String> = sqlx::query_scalar("SELECT path FROM library_roots WHERE id=?")
        .bind(root_id)
        .fetch_optional(pool)
        .await?;
    let Some((title, season, special)) = key(&file, root.as_deref()) else {
        return Ok(vec![]);
    };
    Ok(sqlx::query_as("SELECT p.id,p.work_id,w.title,p.kind,p.updated_at FROM recognition_preferences p JOIN works w ON w.id=p.work_id WHERE p.root_id=? AND p.title_key=? AND p.season_key=? AND p.special_key=? AND p.kind=? ORDER BY p.updated_at DESC,p.id LIMIT 20")
        .bind(root_id).bind(title).bind(season).bind(special).bind(kind).fetch_all(pool).await?)
}

#[tauri::command]
pub async fn list_recognition_preferences(
    media_file_id: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<Suggestion>> {
    suggestions(&state.pool, &media_file_id, &kind).await
}
#[tauri::command]
pub async fn forget_recognition_preference(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(&state.pool).await?;
    sqlx::query("DELETE FROM recognition_preferences WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionInput {
    pub source_work_id: Option<String>,
    pub target_work_id: String,
    pub media_file_ids: Vec<String>,
    pub mode: String,
    pub start_episode: i64,
    pub season: Option<i64>,
    pub episode_type: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionRow {
    pub id: String,
    pub file_name: String,
    pub from_title: Option<String>,
    pub episode: Option<i64>,
    pub season: Option<i64>,
    pub episode_type: i64,
    pub old_episode: Option<String>,
    pub official_title: Option<String>,
    pub parsed_season: Option<i64>,
    pub parsed_episode: Option<String>,
    pub primary_provider: String,
    pub official_episode_id: Option<String>,
    pub eligible: bool,
    pub reliable: bool,
    pub issues: Vec<CorrectionIssue>,
    pub artwork_season: Option<i64>,
    pub artwork_episode: Option<i64>,
    pub artwork_available: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionIssue {
    pub code: String,
    pub message: String,
    pub action: String,
}
fn issue(code: &str, message: &str, action: &str) -> CorrectionIssue {
    CorrectionIssue {
        code: code.into(),
        message: message.into(),
        action: action.into(),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionPreview {
    pub token: String,
    pub title: String,
    pub rows: Vec<CorrectionRow>,
    pub warnings: Vec<String>,
}

// Hash all state used by the preview, not timestamps alone. No network/real-file probing.
async fn prepare(
    tx: &mut Transaction<'_, Sqlite>,
    input: &CorrectionInput,
) -> AppResult<(CorrectionPreview, Vec<MediaFile>)> {
    prepare_inner(tx, input, true).await
}
async fn prepare_inner(
    tx: &mut Transaction<'_, Sqlite>,
    input: &CorrectionInput,
    strict: bool,
) -> AppResult<(CorrectionPreview, Vec<MediaFile>)> {
    if input.media_file_ids.is_empty()
        || input.media_file_ids.len() > 500
        || input.media_file_ids.iter().collect::<HashSet<_>>().len() != input.media_file_ids.len()
        || !["keep", "sequence", "parsed", "unlink"].contains(&input.mode.as_str())
        || !(0..=9999).contains(&input.start_episode)
        || !(0..=6).contains(&input.episode_type)
        || input.season.is_some_and(|s| !(0..=999).contains(&s))
    {
        return Err(AppError::Validation(
            "请选择 1–500 个不重复的视频，并检查季度与集号".into(),
        ));
    }
    let title: Option<String> =
        sqlx::query_scalar("SELECT title FROM works WHERE id=? AND type='video'")
            .bind(&input.target_work_id)
            .fetch_optional(&mut **tx)
            .await?;
    let title = title.ok_or_else(|| AppError::Validation("目标视频作品不存在".into()))?;
    let mut files: Vec<MediaFile> =
        sqlx::query_as("SELECT * FROM media_files WHERE id IN (SELECT value FROM json_each(?))")
            .bind(serde_json::to_string(&input.media_file_ids)?)
            .fetch_all(&mut **tx)
            .await?;
    if files.len() != input.media_file_ids.len()
        || files
            .iter()
            .any(|f| f.media_type != "video" || f.work_id != input.source_work_id)
    {
        return Err(AppError::Validation(
            "文件归属已变化或包含非视频，请刷新后重新选择".into(),
        ));
    }
    files.sort_by(|a, b| {
        natord::compare_ignore_case(&a.file_name, &b.file_name)
            .then(a.path.cmp(&b.path))
            .then(a.id.cmp(&b.id))
    });
    let anchors: Vec<(String, String)> = sqlx::query_as(
        "SELECT provider,external_id FROM work_external_ids WHERE work_id=? ORDER BY provider",
    )
    .bind(&input.target_work_id)
    .fetch_all(&mut **tx)
    .await?;
    let provider = if anchors.iter().any(|(p, _)| p == "bangumi") {
        "bangumi"
    } else {
        "tmdb"
    };
    let metadata: Option<String> = sqlx::query_scalar(
        "SELECT response_json FROM metadata_provider_records WHERE work_id=? AND provider=?",
    )
    .bind(&input.target_work_id)
    .bind(provider)
    .fetch_optional(&mut **tx)
    .await?;
    let mut context_issue = None;
    if !anchors.iter().any(|(p, _)| p == provider) {
        context_issue = Some("作品尚未关联主源条目；请先识别作品，或明确保存人工编号");
    }
    let mut expected_season = None;
    if provider == "bangumi" {
        let expected = metadata
            .as_deref()
            .and_then(|s| serde_json::from_str::<crate::models::WorkMetadata>(s).ok())
            .and_then(|m| crate::anime_details::metadata_season(&m));
        expected_season = expected;
        if strict && input.season.is_some() && expected.is_some() && input.season != expected {
            return Err(AppError::Validation(
                "目标动漫条目的季度与填写的季度不一致，请选择正确作品".into(),
            ));
        }
    }
    let official: Vec<(String,Option<i64>,Option<i64>,String)> = sqlx::query_as("SELECT external_id,episode_number,episode_type,title FROM anime_episodes WHERE work_id=? AND provider=? ORDER BY external_id")
        .bind(&input.target_work_id).bind(provider).fetch_all(&mut **tx).await?;
    if let Some((_, id)) = anchors
        .iter()
        // A Bangumi work may have a series-only TMDB supplement or a different
        // TMDB season layout. Only a TMDB primary can constrain its season.
        .find(|(p, id)| provider == "tmdb" && p == "tmdb" && id.starts_with("tv/"))
    {
        match crate::film_tv::Anchor::parse(id) {
            Ok(anchor) => expected_season = anchor.season,
            Err(error) if strict => return Err(error),
            Err(_) => context_issue = Some("TMDB 主源缺少有效季度；请重新识别并选择实际季度"),
        }
        if strict && input.season.is_some() && input.season != expected_season {
            return Err(AppError::Validation(
                "目标作品季度与填写的季度不一致，请选择正确季度的作品".into(),
            ));
        }
    }
    let old_links: Vec<(String,String,String,String)> = sqlx::query_as("SELECT media_file_id,provider,episode_external_id,match_method FROM media_episode_links WHERE media_file_id IN (SELECT value FROM json_each(?)) ORDER BY media_file_id")
        .bind(serde_json::to_string(&input.media_file_ids)?).fetch_all(&mut **tx).await?;
    let old_numbers: Vec<(String,Option<i64>,Option<i64>)> = sqlx::query_as("SELECT l.media_file_id,e.episode_number,e.episode_type FROM media_episode_links l JOIN anime_episodes e ON e.work_id=l.work_id AND e.provider=l.provider AND e.external_id=l.episode_external_id WHERE l.media_file_id IN (SELECT value FROM json_each(?)) ORDER BY l.media_file_id")
        .bind(serde_json::to_string(&input.media_file_ids)?).fetch_all(&mut **tx).await?;
    let overrides: Vec<(String,Option<i64>,Option<i64>,i64)> = sqlx::query_as("SELECT media_file_id,season,episode,episode_type FROM media_episode_overrides WHERE media_file_id IN (SELECT value FROM json_each(?)) ORDER BY media_file_id")
        .bind(serde_json::to_string(&input.media_file_ids)?).fetch_all(&mut **tx).await?;
    let owners: Vec<(String, String)> =
        sqlx::query_as("SELECT id,title FROM works WHERE id=? OR id=? ORDER BY id")
            .bind(&input.target_work_id)
            .bind(&input.source_work_id)
            .fetch_all(&mut **tx)
            .await?;
    let mut rows = Vec::new();
    let mut unmatched = 0;
    let mut parsed_seasons = HashSet::new();
    for (index, file) in files.iter().enumerate() {
        let parsed = crate::anime_parser::parse_media_path(
            &file.file_name,
            Path::new(&crate::remote_storage::display_path(&file.path)),
            None,
        );
        let mut issues = Vec::new();
        let mut eligible = true;
        if let Some(message) = context_issue {
            issues.push(issue("primary_missing", message, "recognize"));
        }
        if input.mode == "parsed" {
            let target_season = input.season.or(expected_season);
            if target_season.is_none() && parsed.season.is_some() {
                issues.push(issue("season_unknown", "主源季度尚未明确，请核对目标作品并填写季度", "choose_season"));
            }
            let conflict = (target_season.is_some()
                && parsed.season.is_some()
                && target_season != parsed.season)
                || (input.season.is_some()
                    && expected_season.is_some()
                    && input.season != expected_season);
            if conflict {
                if strict {
                    return Err(AppError::Validation(format!(
                        "{} 的季度与目标作品不一致，请取消勾选并分季处理",
                        file.file_name
                    )));
                }
                eligible = false;
                issues.push(issue(
                    "season_conflict",
                    "文件季度与目标作品不一致",
                    "choose_season",
                ));
            }
            if let Some(season) = parsed.season {
                parsed_seasons.insert(season);
            }
            if parsed.episode_start.is_none()
                || parsed.invalid_episode_range
                || parsed
                    .episode_end
                    .is_some_and(|end| Some(end) != parsed.episode_start)
                || parsed
                    .episode
                    .as_deref()
                    .is_some_and(|number| number.parse::<i64>().is_err())
            {
                if strict {
                    return Err(AppError::Validation(format!(
                        "{} 没有明确的单集编号，请取消勾选后单独处理",
                        file.file_name
                    )));
                }
                eligible = false;
                issues.push(issue(
                    "episode_unknown",
                    "缺少明确的单集编号，或一个文件包含多集",
                    "sequence",
                ));
            }
        }
        let episode = match input.mode.as_str() {
            "parsed" => parsed.episode_start.map(i64::from),
            "sequence" => Some(input.start_episode + index as i64),
            "unlink" => None,
            _ => {
                if let Some(override_row) = overrides.iter().find(|r| r.0 == file.id) {
                    override_row.2
                } else {
                    old_numbers
                        .iter()
                        .find(|r| r.0 == file.id)
                        .and_then(|r| r.1)
                        .or_else(|| {
                            if file.parsed_episode_end.is_some()
                                && file.parsed_episode_end != file.parsed_episode_start
                            {
                                return None;
                            }
                            file.parsed_episode_start
                                .or_else(|| file.parsed_episode.as_deref()?.parse().ok())
                        })
                }
            }
        };
        let episode_type = if input.mode == "parsed" {
            match parsed.special_type.as_deref() {
                Some("NCOP" | "OP") => 2,
                Some("NCED" | "ED") => 3,
                Some(_) => 1,
                None => 0,
            }
        } else if input.mode == "keep" {
            old_numbers
                .iter()
                .find(|r| r.0 == file.id)
                .and_then(|r| r.2)
                .or_else(|| overrides.iter().find(|r| r.0 == file.id).map(|r| r.3))
                .unwrap_or_else(|| match file.parsed_special_type.as_deref() {
                    Some("NCOP" | "OP") => 2,
                    Some("NCED" | "ED") => 3,
                    Some(_) => 1,
                    None => 0,
                })
        } else {
            input.episode_type
        };
        if episode.is_some_and(|e| !(0..=9999).contains(&e)) {
            return Err(AppError::Validation("连续集号超出范围".into()));
        }
        let matches: Vec<_> = official
            .iter()
            .filter(|e| e.1 == episode && episode.is_some() && e.2.unwrap_or(0) == episode_type)
            .collect();
        let official_title = if matches.len() == 1 {
            Some(matches[0].3.clone())
        } else {
            if episode.is_some() {
                unmatched += 1;
            }
            None
        };
        if file.missing {
            issues.push(issue(
                "path_unavailable",
                "扫描索引显示路径暂不可用；关联不会使文件恢复在线",
                "source",
            ));
        }
        if episode_type != 0 && input.mode != "unlink" {
            issues.push(issue(
                "special",
                "特别篇、片头或片尾，需要单独核对类型",
                "review",
            ));
        }
        if episode.is_some() && matches.len() != 1 {
            issues.push(issue(
                if matches.is_empty() {
                    "episodes_missing"
                } else {
                    "episode_ambiguous"
                },
                if matches.is_empty() {
                    "当前缓存没有对应官方分集；可人工确认编号，资料恢复后关联"
                } else {
                    "官方集号重复，不能自动选择"
                },
                "refresh",
            ));
        }
        if old_links.iter().any(|l| l.0 == file.id && l.3 == "manual")
            || overrides.iter().any(|o| o.0 == file.id)
        {
            issues.push(issue(
                "manual_existing",
                "已有人工关联；仅在明确勾选确认后调整",
                "review",
            ));
        }
        let reliable = eligible && issues.is_empty() && episode.is_some() && matches.len() == 1;
        rows.push(CorrectionRow {
            id: file.id.clone(),
            file_name: file.file_name.clone(),
            from_title: owners
                .iter()
                .find(|o| Some(&o.0) == file.work_id.as_ref())
                .map(|o| o.1.clone()),
            episode,
            season: if input.mode == "parsed" {
                input.season.or(parsed.season).or(expected_season)
            } else {
                input.season
            },
            episode_type,
            old_episode: file.parsed_episode.clone(),
            official_title,
            parsed_season: parsed.season,
            parsed_episode: parsed.episode.clone(),
            primary_provider: provider.into(),
            official_episode_id: (matches.len() == 1).then(|| matches[0].0.clone()),
            eligible,
            reliable,
            issues,
            artwork_season: None,
            artwork_episode: None,
            artwork_available: false,
        });
    }
    let mut warnings = vec![];
    if input.mode == "parsed" {
        if strict && parsed_seasons.len() > 1 {
            return Err(AppError::Validation(
                "勾选的视频包含不同季度，请分季选择目标作品，不会把整组归为同一季".into(),
            ));
        }
        warnings.push(
            "重新读取文件名与所在目录的季集标记；只修改勾选文件，请核对季度、集号及特别篇类型。"
                .into(),
        );
    }
    if input.mode == "parsed"
        && parsed_seasons.len() > 1
        && input.season.or(expected_season).is_none()
    {
        for row in &mut rows {
            row.reliable = false;
            row.issues.push(issue(
                "mixed_seasons",
                "目标季度未知且目录混季，请先选择季度，再核对目标作品",
                "choose_season",
            ));
        }
    }
    if unmatched > 0 {
        warnings.push(format!("{unmatched} 个文件没有唯一的官方分集，将保存人工集号，元数据恢复后再关联；不会创建占位分集。"));
    }
    if input.mode == "sequence" {
        warnings.push("按文件名自然排序连续编号；请逐行核对，多个压制版本应分批处理。".into());
    }
    let token = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(
            input,
            &files,
            &official,
            &anchors,
            &metadata,
            &old_links,
            &old_numbers,
            &overrides,
            &owners
        ))?)
    );
    Ok((
        CorrectionPreview {
            token,
            title,
            rows,
            warnings,
        },
        files,
    ))
}

pub async fn restore_overrides(
    tx: &mut Transaction<'_, Sqlite>,
    work: &str,
) -> AppResult<HashSet<String>> {
    let rows: Vec<(String,Option<i64>,i64)> = sqlx::query_as("SELECT o.media_file_id,o.episode,o.episode_type FROM media_episode_overrides o JOIN media_files m ON m.id=o.media_file_id WHERE o.work_id=? AND m.work_id=o.work_id")
        .bind(work).fetch_all(&mut **tx).await?;
    let provider: &str = if sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM work_external_ids WHERE work_id=? AND provider='bangumi')",
    )
    .bind(work)
    .fetch_one(&mut **tx)
    .await?
    {
        "bangumi"
    } else {
        "tmdb"
    };
    for (media, episode, kind) in &rows {
        sqlx::query("DELETE FROM media_episode_links WHERE media_file_id=?")
            .bind(media)
            .execute(&mut **tx)
            .await?;
        let Some(episode) = episode else {
            continue;
        };
        let matches: Vec<String> = sqlx::query_scalar("SELECT external_id FROM anime_episodes WHERE work_id=? AND provider=? AND episode_number=? AND COALESCE(episode_type,0)=?")
            .bind(work).bind(provider).bind(episode).bind(kind).fetch_all(&mut **tx).await?;
        if matches.len() == 1 {
            sqlx::query("INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES(?,?,?,?,'manual',1,?)")
                .bind(media).bind(work).bind(provider).bind(&matches[0]).bind(chrono::Utc::now().to_rfc3339()).execute(&mut **tx).await?;
        }
    }
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn apply(pool: &SqlitePool, input: &CorrectionInput, token: &str) -> AppResult<String> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    let (preview, _) = prepare(&mut tx, input).await?;
    if preview.token != token {
        return Err(AppError::Validation(
            "预览已过期，文件或官方分集已变化，请重新预览".into(),
        ));
    }
    let undo =
        crate::recognition_history::begin(&mut tx, &input.target_work_id, &input.media_file_ids)
            .await?;
    let now = chrono::Utc::now().to_rfc3339();
    for row in &preview.rows {
        if input.mode == "keep" && input.source_work_id.as_deref() == Some(&input.target_work_id) {
            continue;
        }
        sqlx::query("DELETE FROM media_episode_links WHERE media_file_id=?")
            .bind(&row.id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM subtitle_links WHERE video_media_file_id=?")
            .bind(&row.id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE media_files SET work_id=?,recognition_status='matched',recognition_error=NULL,last_recognized_at=?,updated_at=? WHERE id=?")
            .bind(&input.target_work_id).bind(&now).bind(&now).bind(&row.id).execute(&mut *tx).await?;
        // Freeze precisely the reviewed mapping, including an explicitly unmapped result.
        sqlx::query("INSERT INTO media_episode_overrides(media_file_id,work_id,season,episode,episode_type,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(media_file_id) DO UPDATE SET work_id=excluded.work_id,season=excluded.season,episode=excluded.episode,episode_type=excluded.episode_type,updated_at=excluded.updated_at")
            .bind(&row.id).bind(&input.target_work_id).bind(row.season).bind(row.episode).bind(row.episode_type).bind(&now).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM match_candidates WHERE media_file_id=?")
            .bind(&row.id)
            .execute(&mut *tx)
            .await?;
    }
    let mut affected = vec![input.target_work_id.clone()];
    if let Some(source) = &input.source_work_id {
        if source != &input.target_work_id {
            affected.push(source.clone());
        }
    }
    for work in affected {
        crate::media_mapping::rebuild_subtitle_links(&mut tx, &work).await?;
        crate::anime_details::rebuild_episode_links(&mut tx, &work).await?;
    }
    learn(&mut tx, &input.target_work_id, &input.media_file_ids).await?;
    crate::recognition_history::finish(&mut tx, undo, &input.target_work_id, &preview.title)
        .await?;
    tx.commit().await?;
    let mut affected = vec![input.target_work_id.clone()];
    affected.extend(input.source_work_id.clone());
    crate::android_events::recognition(input.media_file_ids.clone(), affected);
    Ok(input.target_work_id.clone())
}
#[tauri::command]
pub async fn preview_media_correction(
    input: CorrectionInput,
    state: State<'_, AppState>,
) -> AppResult<CorrectionPreview> {
    diagnostic_preview(&state.pool, &input, true).await
}
// A single batched database read diagnoses the whole selection, without network or media access.
async fn diagnostic_preview(
    pool: &SqlitePool,
    input: &CorrectionInput,
    strict: bool,
) -> AppResult<CorrectionPreview> {
    let mut tx = pool.begin().await?;
    let mut preview = prepare_inner(&mut tx, input, strict).await?.0;
    tx.rollback().await?;
    // Release the read transaction first: test and desktop pools may have one connection.
    match crate::episode_artwork::cached(pool, &input.target_work_id).await {
        Ok(artwork) => {
            for row in &mut preview.rows {
                let key = row
                    .official_episode_id
                    .as_ref()
                    .map(|id| format!("{}:{id}", row.primary_provider));
                if let Some(correspondence) = artwork
                    .correspondence
                    .iter()
                    .find(|c| Some(&c.episode_key) == key.as_ref())
                {
                    row.artwork_season = artwork.source.as_ref().map(|s| s.season_number);
                    row.artwork_episode = Some(correspondence.tmdb_number);
                    // The checked image map, not just a nominal still path, determines availability.
                    row.artwork_available =
                        key.as_ref().is_some_and(|k| artwork.images.contains_key(k));
                }
                if row.episode.is_some() && !row.artwork_available {
                    row.issues.push(issue(
                        "still_missing",
                        "没有已核实的缓存剧照，使用文件缩略图；不影响分集关联",
                        "artwork",
                    ));
                }
            }
        }
        Err(error) => preview.warnings.push(format!(
            "剧照缓存暂不可用：{error}。仍可核对文件与主源分集，不影响人工编号。"
        )),
    }
    Ok(preview)
}
#[tauri::command]
pub async fn inspect_media_correction(
    input: CorrectionInput,
    state: State<'_, AppState>,
) -> AppResult<CorrectionPreview> {
    diagnostic_preview(&state.pool, &input, false).await
}
#[tauri::command]
pub async fn apply_media_correction(
    input: CorrectionInput,
    token: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    apply(&state.pool, &input, &token).await
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture() -> SqlitePool {
        let pool = db::test_pool().await.unwrap();
        for (id, title) in [("s1", "第一季"), ("s2", "第二季")] {
            sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES(?,?,'video','私人笔记','now','now')").bind(id).bind(title).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,'bangumi',?,'now','now')").bind(id).bind(id).execute(&pool).await.unwrap();
        }
        for root in ["r1", "r2"] {
            sqlx::query(
                "INSERT INTO library_roots(id,path,created_at,updated_at) VALUES(?,?,'now','now')",
            )
            .bind(root)
            .bind(format!("C:\\{root}"))
            .execute(&pool)
            .await
            .unwrap();
        }
        for (id, root, name) in [
            ("a", "r1", "Show S01 [01].mkv"),
            ("b", "r1", "Show S01 [02].mkv"),
            ("c", "r2", "Show S01 [03].mkv"),
            ("d", "r1", "Show S02 [01].mkv"),
            ("e", "r1", "Show S01 [NCED01].mkv"),
        ] {
            sqlx::query("INSERT INTO media_files(id,work_id,library_root_id,path,file_name,extension,media_type,parsed_episode_start,created_at,updated_at) VALUES(?,'s1',?, ?,?,'mkv','video',1,'now','now')").bind(id).bind(root).bind(format!("C:\\{root}\\{name}")).bind(name).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('a',12345,99999,'later')").execute(&pool).await.unwrap();
        pool
    }
    fn input() -> CorrectionInput {
        CorrectionInput {
            source_work_id: Some("s1".into()),
            target_work_id: "s2".into(),
            media_file_ids: vec!["b".into(), "a".into()],
            mode: "sequence".into(),
            start_episode: 1,
            season: Some(2),
            episode_type: 0,
        }
    }
    async fn preview(pool: &SqlitePool, i: &CorrectionInput) -> CorrectionPreview {
        let mut tx = pool.begin().await.unwrap();
        prepare(&mut tx, i).await.unwrap().0
    }
    #[tokio::test]
    async fn diagnostics_isolate_mixed_special_unknown_and_manual_without_writes() {
        let pool = fixture().await;
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,episode_type,sort_number,title,fetched_at) VALUES('s1','bangumi','ep1',1,0,1,'第一集','now'),('s1','bangumi','ep2',2,0,2,'第二集','now')").execute(&pool).await.unwrap();
        crate::anime_details::set_episode_link(&pool, "b", Some("ep1"))
            .await
            .unwrap();
        sqlx::query("UPDATE media_files SET file_name='Show [01-02].mkv' WHERE id='c'")
            .execute(&pool)
            .await
            .unwrap();
        let mut i = input();
        i.target_work_id = "s1".into();
        i.mode = "parsed".into();
        i.season = Some(1);
        i.media_file_ids = ["a", "b", "c", "d", "e"].map(str::to_owned).to_vec();
        let p = diagnostic_preview(&pool, &i, false).await.unwrap();
        let row = |id: &str| p.rows.iter().find(|r| r.id == id).unwrap();
        assert!(row("a").reliable);
        assert!(row("a").issues.iter().any(|i| i.code == "still_missing"));
        assert!(
            !row("b").reliable && row("b").eligible,
            "manual links require explicit selection"
        );
        assert!(!row("c").eligible && row("c").issues.iter().any(|i| i.code == "episode_unknown"));
        assert!(!row("d").eligible && row("d").issues.iter().any(|i| i.code == "season_conflict"));
        assert!(!row("e").reliable && row("e").eligible && row("e").episode_type == 3);
        let links: Vec<(String, String)> =
            sqlx::query_as("SELECT media_file_id,episode_external_id FROM media_episode_links")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(links, vec![("b".into(), "ep1".into())]);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_overrides")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        // The tolerant diagnostic cannot be used to bypass strict saving.
        assert!(apply(&pool, &i, &p.token).await.is_err());
        i.media_file_ids = vec!["a".into()];
        let p = diagnostic_preview(&pool, &i, true).await.unwrap();
        apply(&pool, &i, &p.token).await.unwrap();
        let link: String = sqlx::query_scalar(
            "SELECT episode_external_id FROM media_episode_links WHERE media_file_id='b'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(link, "ep1");
    }
    #[tokio::test]
    async fn diagnostics_offline_and_unknown_primary_retain_explicit_manual_option() {
        let pool = fixture().await;
        sqlx::query("UPDATE media_files SET missing=1 WHERE id='a'")
            .execute(&pool)
            .await
            .unwrap();
        let mut i = input();
        i.target_work_id = "s1".into();
        i.mode = "parsed".into();
        i.season = Some(1);
        i.media_file_ids = vec!["a".into()];
        let p = diagnostic_preview(&pool, &i, false).await.unwrap();
        assert!(p.rows[0].eligible && !p.rows[0].reliable);
        assert!(p.rows[0]
            .issues
            .iter()
            .any(|i| i.code == "path_unavailable"));
        assert!(p.rows[0]
            .issues
            .iter()
            .any(|i| i.code == "episodes_missing"));
        let p = diagnostic_preview(&pool, &i, true).await.unwrap();
        apply(&pool, &i, &p.token).await.unwrap();
        assert_eq!(
            crate::playback::resume_position(&pool, "a", false)
                .await
                .unwrap(),
            Some(12345)
        );
        sqlx::query("DELETE FROM work_external_ids WHERE work_id='s1'")
            .execute(&pool)
            .await
            .unwrap();
        let p = diagnostic_preview(&pool, &i, false).await.unwrap();
        assert!(p.rows[0].issues.iter().any(|i| i.code == "primary_missing"));
        assert!(p.rows[0].eligible && !p.rows[0].reliable);
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('s1','tmdb','tv/42','now','now')").execute(&pool).await.unwrap();
        let p = diagnostic_preview(&pool, &i, false).await.unwrap();
        assert!(p.rows[0].issues.iter().any(|i| i.code == "primary_missing"));
        assert!(diagnostic_preview(&pool, &i, true).await.is_err());
    }
    #[tokio::test]
    async fn workflow_split_batch_cached_combined_stills_and_resume_keep_media_identity() {
        let pool = fixture().await;
        let path = r"\\?\UNC\server\share\Show\Season 2\Show S02E01.mkv";
        sqlx::query(
            "UPDATE media_files SET file_name='Show S02E01.mkv',path=?,missing=1 WHERE id='d'",
        )
        .bind(path)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('d',654321,1440000,'latest')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,episode_type,sort_number,title,air_date,fetched_at) VALUES('s2','bangumi','ep1',1,0,1,'第二季第一集','2024-01-01','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO episode_artwork_sources(work_id,anchor,series_id,season_number,method,episode_offset,updated_at) VALUES('s2','bangumi:s2',42,1,'manual',12,'now')").execute(&pool).await.unwrap();
        let cache=serde_json::json!({"episodes":[{"season_number":1,"episode_number":13,"air_date":"2024-01-01","still_path":"/s13.jpg"}]}).to_string();
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb','film-tv:zh-CN:tv/42/season/1:[]',?,'old','expired')").bind(cache).execute(&pool).await.unwrap();
        // Exercise the real local recognition confirmation before the explicit mapping step.
        let directory = tempfile::tempdir().unwrap();
        let state = AppState { pool: pool.clone(), database_path: directory.path().join("test.db"), data_directory: directory.path().into(), cover_cache_path: directory.path().into(), thumbnail_cache_path: directory.path().into() };
        let mut metadata = crate::explore::lookup_title("葬送的芙莉莲").unwrap().remove(0);
        metadata.title = "第二季".into(); metadata.external_id = "s2".into(); metadata.season = Some(2);
        sqlx::query("INSERT INTO match_candidates(id,media_file_id,provider,external_id,title,aliases_json,subject_type,confidence,match_reasons_json,metadata_json,created_at) VALUES('workflow-candidate','d','bangumi','s2','第二季','[]','tv',0.9,'[]',?,'now')").bind(serde_json::to_string(&metadata).unwrap()).execute(&pool).await.unwrap();
        let target = crate::metadata::confirm_candidate_local_selected(&state,"d","workflow-candidate",&["d".into()],crate::grouping::GroupScope::Season).await.unwrap();
        assert_eq!(target,"s2");
        let mut i = input();
        i.source_work_id = Some("s2".into());
        i.mode = "parsed".into();
        i.media_file_ids = vec!["d".into()];
        let p = diagnostic_preview(&pool, &i, true).await.unwrap();
        let r = &p.rows[0];
        assert_eq!(
            (
                r.parsed_season,
                r.episode,
                r.artwork_season,
                r.artwork_episode
            ),
            (Some(2), Some(1), Some(1), Some(13))
        );
        assert!(r.artwork_available);
        apply(&pool, &i, &p.token).await.unwrap();
        let identity:(String,String,String)=sqlx::query_as("SELECT m.work_id,m.path,l.episode_external_id FROM media_files m JOIN media_episode_links l ON l.media_file_id=m.id WHERE m.id='d'").fetch_one(&pool).await.unwrap();
        assert_eq!(identity, ("s2".into(), path.into(), "ep1".into()));
        let first: String = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='a'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(first, "s1");
        let artwork = crate::episode_artwork::cached(&pool, "s2").await.unwrap();
        assert!(artwork.images["bangumi:ep1"].ends_with("/s13.jpg"));
        assert_eq!(
            crate::playback::resume_position(&pool, "d", false)
                .await
                .unwrap(),
            Some(654321)
        );
        let shell = crate::launcher::shell_compatible_path(path);
        assert_eq!(shell, r"\\server\share\Show\Season 2\Show S02E01.mkv");
        let args = crate::launcher::expand_arguments(
            "{file}",
            &crate::launcher::TemplateContext {
                file: &shell,
                folder: r"\\server\share\Show\Season 2",
                title: "第二季",
            },
        )
        .unwrap();
        assert_eq!(args, vec![shell]);
        let history: String = sqlx::query_scalar(
            "SELECT id FROM recognition_history ORDER BY created_at DESC LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        crate::recognition_history::undo(&pool, &history)
            .await
            .unwrap();
        let work: String = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='d'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(work, "s2", "undo batch preserves the preceding recognition confirmation");
        assert_eq!(
            crate::playback::resume_position(&pool, "d", false)
                .await
                .unwrap(),
            Some(654321)
        );
    }
    #[tokio::test]
    async fn bangumi_batch_ignores_tmdb_series_supplement_and_different_supplement_season() {
        for supplement in ["tv/42", "tv/42/season/2"] {
            let pool = fixture().await;
            sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('s1','tmdb',?,'now','now')").bind(supplement).execute(&pool).await.unwrap();
            sqlx::query("UPDATE media_files SET file_name='想要成为影之实力者！ - S01E05 - 吾为.mkv' WHERE id='a'").execute(&pool).await.unwrap();
            sqlx::query("UPDATE media_files SET file_name='想要成为影之实力者！ - S01E06 - 假冒者.mkv' WHERE id='b'").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,episode_type,sort_number,title,fetched_at) VALUES('s1','bangumi','ep5',5,0,5,'第五集','now'),('s1','bangumi','ep6',6,0,6,'第六集','now'),('s1','tmdb','other5',5,0,5,'补源第五集','now')").execute(&pool).await.unwrap();
            let mut i=input(); i.target_work_id="s1".into(); i.mode="parsed".into(); i.season=Some(1);
            let p=preview(&pool,&i).await;
            assert_eq!(p.rows.iter().map(|r| r.episode).collect::<Vec<_>>(),vec![Some(5),Some(6)]);
            assert!(p.rows.iter().all(|r| r.official_title.as_deref().is_some_and(|s| !s.starts_with("补源"))));
            let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_links").fetch_one(&pool).await.unwrap(); assert_eq!(count,0,"preview must not write links");
            apply(&pool,&i,&p.token).await.unwrap();
            let links:Vec<(String,String)>=sqlx::query_as("SELECT provider,episode_external_id FROM media_episode_links ORDER BY media_file_id").fetch_all(&pool).await.unwrap();
            assert_eq!(links,vec![("bangumi".into(),"ep5".into()),("bangumi".into(),"ep6".into())]);
            let position:i64=sqlx::query_scalar("SELECT position_ms FROM playback_progress WHERE media_file_id='a'").fetch_one(&pool).await.unwrap(); assert_eq!(position,12345);
            let id:String=sqlx::query_scalar("SELECT external_id FROM work_external_ids WHERE work_id='s1' AND provider='tmdb'").fetch_one(&pool).await.unwrap(); assert_eq!(id,supplement);
        }
    }
    #[tokio::test]
    async fn tmdb_primary_batch_still_validates_anchor_and_season() {
        let pool=fixture().await;
        sqlx::query("UPDATE work_external_ids SET provider='tmdb',external_id='tv/42/season/2' WHERE work_id='s1'").execute(&pool).await.unwrap();
        let mut i=input(); i.target_work_id="s1".into(); i.mode="parsed".into(); i.season=Some(1);
        let mut tx=pool.begin().await.unwrap();
        assert!(prepare(&mut tx,&i).await.err().unwrap().to_string().contains("季度")); tx.rollback().await.unwrap();
        sqlx::query("UPDATE work_external_ids SET external_id='tv/42' WHERE work_id='s1'").execute(&pool).await.unwrap();
        let mut tx=pool.begin().await.unwrap();
        assert!(prepare(&mut tx,&i).await.err().unwrap().to_string().contains("影视条目 ID 无效"));
    }
    #[tokio::test]
    async fn filename_batch_reparses_stale_columns_and_keeps_unselected_progress() {
        let pool = fixture().await;
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,episode_type,sort_number,title,fetched_at) VALUES('s1','bangumi','ep1',1,0,1,'第一集','now'),('s1','bangumi','ep2',2,0,2,'第二集','now'),('s1','bangumi','ed1',1,3,3,'片尾','now')")
            .execute(&pool).await.unwrap();
        let mut i = input();
        i.target_work_id = "s1".into();
        i.mode = "parsed".into();
        i.season = Some(1);
        i.media_file_ids.push("e".into());
        let p = preview(&pool, &i).await;
        let rows: Vec<_> = p.rows.iter().map(|r| (r.id.as_str(),r.episode,r.episode_type)).collect();
        assert!(rows.contains(&("b",Some(2),0)));
        assert!(rows.contains(&("e",Some(1),3)));
        assert!(p.rows.iter().all(|r| r.official_title.is_some()));
        apply(&pool, &i, &p.token).await.unwrap();
        let links: Vec<(String,String)> = sqlx::query_as("SELECT media_file_id,episode_external_id FROM media_episode_links ORDER BY media_file_id")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(links, vec![("a".into(),"ep1".into()),("b".into(),"ep2".into()),("e".into(),"ed1".into())]);
        let position: i64 = sqlx::query_scalar("SELECT position_ms FROM playback_progress WHERE media_file_id='a'").fetch_one(&pool).await.unwrap();
        assert_eq!(position,12345);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_overrides WHERE media_file_id IN ('c','d')").fetch_one(&pool).await.unwrap();
        assert_eq!(count,0);
    }

    #[tokio::test]
    async fn filename_batch_rejects_mixed_seasons_and_ambiguous_ranges() {
        let pool = fixture().await;
        let mut i = input();
        i.mode = "parsed".into();
        i.target_work_id = "s1".into();
        i.season = None;
        i.media_file_ids = vec!["a".into(),"d".into()];
        let mut tx = pool.begin().await.unwrap();
        assert!(prepare(&mut tx,&i).await.is_err());
        tx.rollback().await.unwrap();
        i.media_file_ids = vec!["d".into()];
        i.season = Some(1);
        let mut tx = pool.begin().await.unwrap();
        assert!(prepare(&mut tx,&i).await.is_err());
        tx.rollback().await.unwrap();
        sqlx::query("UPDATE media_files SET file_name='Show [01-02].mkv' WHERE id='a'").execute(&pool).await.unwrap();
        i.media_file_ids = vec!["a".into()];
        let mut tx = pool.begin().await.unwrap();
        assert!(prepare(&mut tx,&i).await.is_err());
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn filename_batch_retains_offline_numbers_until_unique_episodes_return() {
        let pool = fixture().await;
        let mut i = input();
        i.mode = "parsed".into();
        i.target_work_id = "s1".into();
        i.season = Some(1);
        let p = preview(&pool,&i).await;
        assert!(p.rows.iter().all(|r| r.official_title.is_none()));
        apply(&pool,&i,&p.token).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anime_episodes").fetch_one(&pool).await.unwrap();
        assert_eq!(count,0);
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,episode_type,sort_number,title,fetched_at) VALUES('s1','bangumi','ep1',1,0,1,'第一集','now'),('s1','bangumi','ep2',2,0,2,'第二集','now')").execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        crate::anime_details::rebuild_episode_links(&mut tx,"s1").await.unwrap();
        tx.commit().await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_links").fetch_one(&pool).await.unwrap();
        assert_eq!(count,2);
    }
    #[tokio::test]
    async fn offline_correction_preserves_progress_restores_official_links_and_can_undo() {
        let pool = fixture().await;
        let i = input();
        let p = preview(&pool, &i).await;
        assert_eq!(
            p.rows
                .iter()
                .map(|r| (r.id.as_str(), r.episode))
                .collect::<Vec<_>>(),
            vec![("a", Some(1)), ("b", Some(2))]
        );
        assert!(!p.warnings.is_empty());
        apply(&pool, &i, &p.token).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anime_episodes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        let progress: i64 =
            sqlx::query_scalar("SELECT position_ms FROM playback_progress WHERE media_file_id='a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(progress, 12345);
        let owner: String = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='d'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(owner, "s1");
        for (id, number) in [("ep1", 1), ("ep2", 2)] {
            sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,fetched_at) VALUES('s2','bangumi',?,?,?,0,'官方','now')").bind(id).bind(number).bind(number).execute(&pool).await.unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        crate::anime_details::rebuild_episode_links(&mut tx, "s2")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let links:Vec<(String,String,String)>=sqlx::query_as("SELECT media_file_id,episode_external_id,match_method FROM media_episode_links ORDER BY media_file_id").fetch_all(&pool).await.unwrap();
        assert_eq!(
            links,
            vec![
                ("a".into(), "ep1".into(), "manual".into()),
                ("b".into(), "ep2".into(), "manual".into())
            ]
        );
        // Metadata changed after confirmation: undo must not erase that newer state.
        let history: String = sqlx::query_scalar("SELECT id FROM recognition_history LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(crate::recognition_history::undo(&pool, &history)
            .await
            .is_err());
        let pool = fixture().await;
        let p = preview(&pool, &i).await;
        apply(&pool, &i, &p.token).await.unwrap();
        let history: String = sqlx::query_scalar("SELECT id FROM recognition_history LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        crate::recognition_history::undo(&pool, &history)
            .await
            .unwrap();
        let owner: String = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='a'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(owner, "s1");
        let overrides: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_overrides")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(overrides, 0);
        let learned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recognition_preferences")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(learned, 0);
    }
    #[tokio::test]
    async fn recommendations_are_source_season_and_special_scoped_and_conflicts_are_kept() {
        let pool = fixture().await;
        let mut tx = pool.begin().await.unwrap();
        learn(&mut tx, "s1", &["a".into()]).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(suggestions(&pool, "b", "anime").await.unwrap().len(), 1);
        for id in ["c", "d", "e"] {
            assert!(suggestions(&pool, id, "anime").await.unwrap().is_empty());
        }
        assert!(suggestions(&pool, "b", "tv").await.unwrap().is_empty());
        sqlx::query("UPDATE media_files SET work_id='s2' WHERE id='a'")
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        learn(&mut tx, "s2", &["a".into()]).await.unwrap();
        tx.commit().await.unwrap();
        let matches = suggestions(&pool, "b", "anime").await.unwrap();
        assert_eq!(matches.len(), 2);
        sqlx::query("DELETE FROM recognition_preferences WHERE id=?")
            .bind(&matches[0].id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(suggestions(&pool, "b", "anime").await.unwrap().len(), 1);
    }
    #[tokio::test]
    async fn stale_preview_is_atomic_and_rejects_invalid_selection() {
        let pool = fixture().await;
        let i = input();
        let p = preview(&pool, &i).await;
        sqlx::query("UPDATE media_files SET path='C:\\moved.mkv' WHERE id='b'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(apply(&pool, &i, &p.token).await.is_err());
        let owners: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_files WHERE work_id='s2'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(owners, 0);
        for mode in ["duplicate", "overflow", "foreign"] {
            let mut bad = input();
            match mode {
                "duplicate" => bad.media_file_ids.push("a".into()),
                "overflow" => bad.start_episode = 9999,
                _ => bad.source_work_id = None,
            };
            let mut tx = pool.begin().await.unwrap();
            assert!(prepare(&mut tx, &bad).await.is_err());
        }
    }
    #[tokio::test]
    async fn keep_does_not_turn_an_episode_range_or_unknown_file_into_a_single_episode() {
        let pool = fixture().await;
        sqlx::query("UPDATE media_files SET parsed_episode_start=1,parsed_episode_end=2,parsed_episode='1-2' WHERE id='a'").execute(&pool).await.unwrap();
        sqlx::query("UPDATE media_files SET parsed_episode_start=NULL,parsed_episode_end=NULL,parsed_episode=NULL WHERE id='b'").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,fetched_at) VALUES('s2','bangumi','ep1',1,1,0,'第一集','now')").execute(&pool).await.unwrap();
        let mut i = input();
        i.mode = "keep".into();
        let p = preview(&pool, &i).await;
        assert!(p.rows.iter().all(|r| r.episode.is_none()));
        apply(&pool, &i, &p.token).await.unwrap();
        let links: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_links WHERE work_id='s2'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(links, 0);
        let overrides: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM media_episode_overrides WHERE episode IS NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(overrides, 2);
    }
    #[tokio::test]
    async fn keep_preserves_manual_mapping_and_old_history_snapshots_still_undo() {
        let pool = fixture().await;
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,fetched_at) VALUES('s1','bangumi','manual2',2,2,0,'第二集','now')").execute(&pool).await.unwrap();
        crate::anime_details::set_episode_link(&pool, "a", Some("manual2"))
            .await
            .unwrap();
        let mut i = input();
        i.mode = "keep".into();
        i.target_work_id = "s1".into();
        let p = preview(&pool, &i).await;
        assert_eq!(p.rows[0].episode, Some(2));
        apply(&pool, &i, &p.token).await.unwrap();
        let link: String = sqlx::query_scalar(
            "SELECT episode_external_id FROM media_episode_links WHERE media_file_id='a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(link, "manual2");
        // Simulate a pre-migration history record with no new-table keys.
        let pool = fixture().await;
        let mut tx = pool.begin().await.unwrap();
        let pending = crate::recognition_history::begin(&mut tx, "s1", &["a".into()])
            .await
            .unwrap();
        sqlx::query("UPDATE works SET title='新标题' WHERE id='s1'")
            .execute(&mut *tx)
            .await
            .unwrap();
        crate::recognition_history::finish(&mut tx, pending, "s1", "新标题")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let (id, before, after): (String, String, String) =
            sqlx::query_as("SELECT id,before_json,after_json FROM recognition_history LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        let strip = |json: String| {
            let mut value: serde_json::Value = serde_json::from_str(&json).unwrap();
            for key in ["recognition_preferences", "media_episode_overrides"] {
                value.as_object_mut().unwrap().remove(key);
            }
            value.to_string()
        };
        sqlx::query("UPDATE recognition_history SET before_json=?,after_json=? WHERE id=?")
            .bind(strip(before))
            .bind(strip(after))
            .bind(&id)
            .execute(&pool)
            .await
            .unwrap();
        crate::recognition_history::undo(&pool, &id).await.unwrap();
        let title: String = sqlx::query_scalar("SELECT title FROM works WHERE id='s1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(title, "第一季");
    }
    #[tokio::test]
    async fn official_change_invalidates_preview_and_multiple_matches_stay_unlinked() {
        let pool = fixture().await;
        let i = input();
        let p = preview(&pool, &i).await;
        for id in ["dup1", "dup2"] {
            sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,fetched_at) VALUES('s2','bangumi',?,1,1,0,'同号分集','now')").bind(id).execute(&pool).await.unwrap();
        }
        assert!(apply(&pool, &i, &p.token).await.is_err());
        let p = preview(&pool, &i).await;
        assert!(p.rows[0].official_title.is_none());
        apply(&pool, &i, &p.token).await.unwrap();
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_links WHERE media_file_id='a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
        let overrides: i64 = sqlx::query_scalar(
            "SELECT episode FROM media_episode_overrides WHERE media_file_id='a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(overrides, 1);
    }
    #[tokio::test]
    async fn unlink_is_persistent_but_new_single_file_manual_mapping_wins() {
        let pool = fixture().await;
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,fetched_at) VALUES('s1','bangumi','ep1',1,1,0,'第一集','now')").execute(&pool).await.unwrap();
        let mut i = input();
        i.target_work_id = "s1".into();
        i.mode = "unlink".into();
        let p = preview(&pool, &i).await;
        apply(&pool, &i, &p.token).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        crate::anime_details::rebuild_episode_links(&mut tx, "s1")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM media_episode_links WHERE media_file_id='a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
        crate::anime_details::set_episode_link(&pool, "a", Some("ep1"))
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        crate::anime_details::rebuild_episode_links(&mut tx, "s1")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let link: String = sqlx::query_scalar(
            "SELECT episode_external_id FROM media_episode_links WHERE media_file_id='a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(link, "ep1");
    }
}
