//! Movie / television recognition. TMDB seasons are separate work anchors;
//! the original media paths and user records are never rewritten.
use crate::anime_parser::{parse_media_path, ParsedAnime};
use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::models::*;
use chrono::{Duration, Utc};
use regex::Regex;
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration as StdDuration;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Movie,
    Tv,
}
impl Kind {
    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "movie" => Ok(Self::Movie),
            "tv" => Ok(Self::Tv),
            _ => Err(AppError::Validation("识别类型必须是电影或电视剧".into())),
        }
    }
    fn key(self) -> &'static str {
        if self == Self::Movie {
            "movie"
        } else {
            "tv"
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Anchor {
    pub kind: Kind,
    pub id: u64,
    pub season: Option<i64>,
}
impl Anchor {
    pub fn parse(value: &str) -> AppResult<Self> {
        let p: Vec<_> = value.split('/').collect();
        let invalid = || AppError::Validation("影视条目 ID 无效".into());
        let id = p
            .get(1)
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .ok_or_else(invalid)?;
        match p.as_slice() {
            ["movie", _] => Ok(Self {
                kind: Kind::Movie,
                id,
                season: None,
            }),
            ["tv", _, "season", s] => Ok(Self {
                kind: Kind::Tv,
                id,
                season: Some(
                    s.parse::<i64>()
                        .ok()
                        .filter(|s| (0..=999).contains(s))
                        .ok_or_else(invalid)?,
                ),
            }),
            _ => Err(invalid()),
        }
    }
}

fn season_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(?:^|[ ._\-\[])(?:S(?P<s>\d{1,3})[ ._-]*E(?P<e>\d{1,4})(?P<tail>(?:E\d{1,4}|-E?\d{1,4}))?|(?P<xs>\d{1,2})x(?P<xe>\d{1,3})\b)").unwrap())
}

/// Explicit SxxEyy / 1x02 takes precedence over anime filename heuristics.
pub fn parse_video(file: &MediaFile, kind: Kind) -> ParsedAnime {
    let display = crate::remote_storage::display_path(&file.path);
    let mut parsed = parse_media_path(&file.file_name, Path::new(&display), None);
    if let Some(c) = season_regex().captures(&file.file_name) {
        parsed.season = c
            .name("s")
            .or_else(|| c.name("xs"))
            .and_then(|s| s.as_str().parse().ok());
        parsed.episode_start = c
            .name("e")
            .or_else(|| c.name("xe"))
            .and_then(|s| s.as_str().parse().ok());
        parsed.episode = parsed.episode_start.map(|n| n.to_string());
        // Combined episode files remain available for explicit manual association.
        parsed.episode_end = c.name("tail").and_then(|s| {
            s.as_str()
                .trim_matches(|v: char| !v.is_ascii_digit())
                .parse()
                .ok()
        });
        let prefix = file.file_name[..c.get(0).unwrap().start()].trim_matches(['.', ' ', '_', '-']);
        if !prefix.is_empty() {
            parsed.title = Some(prefix.replace(['.', '_'], " "));
        }
        parsed.special_type = None;
    }
    if kind == Kind::Movie {
        static YEAR: OnceLock<Regex> = OnceLock::new();
        let re = YEAR.get_or_init(|| Regex::new(r"((?:19|20)\d{2})").unwrap());
        if let Some(c) = re.captures_iter(&file.file_name).find(|c| {
            let m = c.get(0).unwrap();
            m.start() > 0
                && file.file_name[..m.start()].ends_with(['.', ' ', '_', '[', '('])
                && (m.end() == file.file_name.len()
                    || file.file_name[m.end()..].starts_with(['.', ' ', '_', ']', ')']))
        }) {
            let prefix = file.file_name[..c.get(0).unwrap().start()]
                .trim_matches(['.', ' ', '_', '-', '[', '(']);
            if !prefix.is_empty() {
                parsed.title = Some(prefix.replace(['.', '_'], " "));
            }
            parsed.year = c.get(1).and_then(|m| m.as_str().parse().ok());
        }
        parsed.season = None;
        parsed.episode = None;
        parsed.episode_start = None;
        parsed.episode_end = None;
    }
    parsed
}

pub(crate) struct Response {
    pub(crate) data: Value,
    pub(crate) warning: Option<String>,
}

pub(crate) async fn request(
    pool: &SqlitePool,
    path: &str,
    params: &[(&str, String)],
    fresh: bool,
) -> AppResult<Response> {
    let key = format!("film-tv:zh-CN:{path}:{}", serde_json::to_string(params)?);
    let cached: Option<(String, String)> = sqlx::query_as(
        "SELECT response_json,expires_at FROM metadata_cache WHERE provider='tmdb' AND cache_key=?",
    )
    .bind(&key)
    .fetch_optional(pool)
    .await?;
    let cached = cached.and_then(|(data, expiry)| {
        serde_json::from_str::<Value>(&data)
            .ok()
            .map(|data| (data, expiry))
    });
    if !fresh {
        if let Some((data, expiry)) = &cached {
            if expiry > &Utc::now().to_rfc3339() {
                return Ok(Response {
                    data: data.clone(),
                    warning: None,
                });
            }
        }
    }
    let token: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='metadata.tmdb_read_token'")
            .fetch_optional(pool)
            .await?;
    let result = match token.filter(|s| !s.trim().is_empty()) {
        Some(token) => fetch("https://api.themoviedb.org/3", &token, path, params).await,
        None => Err(AppError::Validation(
            "请先在设置 → 元数据来源中配置 TMDB API Read Access Token，再识别电影或电视剧".into(),
        )),
    }
    .and_then(|data| {
        let valid = if path.starts_with("search/") {
            data["results"].is_array()
        } else if path.ends_with("/images") {
            data["posters"].is_array() || data["backdrops"].is_array()
        } else if path.contains("/season/") {
            data["episodes"].is_array()
        } else {
            data["id"]
                .as_u64()
                .is_some_and(|id| path.ends_with(&format!("/{id}")))
        };
        if valid {
            Ok(data)
        } else {
            Err(AppError::Network(
                "TMDB 返回的资料不完整，已有资料已保留".into(),
            ))
        }
    });
    match result {
        Ok(data) => {
            if path.contains("/season/") && data["episodes"].as_array().is_some_and(Vec::is_empty) {
                if let Some((old, _)) = &cached {
                    if old["episodes"].as_array().is_some_and(|v| !v.is_empty()) {
                        return Ok(Response {
                            data: old.clone(),
                            warning: Some("TMDB 返回空分集，正在使用已有分集缓存".into()),
                        });
                    }
                }
            }
            let now = Utc::now();
            sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
                .bind(&key).bind(serde_json::to_string(&data)?).bind(now.to_rfc3339()).bind((now + Duration::days(7)).to_rfc3339()).execute(pool).await?;
            Ok(Response {
                data,
                warning: None,
            })
        }
        Err(error) => match cached {
            Some((data, _)) => Ok(Response {
                data,
                warning: Some(format!("{error}；正在使用已有 TMDB 缓存")),
            }),
            None => Err(error),
        },
    }
}

async fn fetch(base: &str, token: &str, path: &str, params: &[(&str, String)]) -> AppResult<Value> {
    static LIMITER: OnceLock<crate::metadata_provider::ProviderRateLimiter> = OnceLock::new();
    let client = reqwest::Client::builder()
        .connect_timeout(StdDuration::from_secs(5))
        .timeout(StdDuration::from_secs(15))
        .user_agent("Genzo (local media library)")
        .build()
        .map_err(|_| AppError::Network("无法初始化 TMDB 连接".into()))?;
    for attempt in 0..3 {
        LIMITER
            .get_or_init(|| {
                crate::metadata_provider::ProviderRateLimiter::new(StdDuration::from_millis(250))
            })
            .wait()
            .await;
        let response = client
            .get(format!("{base}/{path}"))
            .bearer_auth(token.trim())
            .query(&[("language", "zh-CN"), ("include_adult", "false")])
            .query(params)
            .send()
            .await;
        let mut delay = 250 * (1 << attempt);
        match response {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    return response
                        .json()
                        .await
                        .map_err(|_| AppError::Network("TMDB 返回了无效资料".into()));
                }
                if status.as_u16() == 401 || status.as_u16() == 403 {
                    return Err(AppError::Validation(
                        "TMDB 凭据无效或没有访问权限，请检查设置中的 API Read Access Token".into(),
                    ));
                }
                let retry = status.is_server_error() || matches!(status.as_u16(), 408 | 425 | 429);
                if !retry || attempt == 2 {
                    return Err(AppError::Network(format!(
                        "TMDB 请求失败（HTTP {}）",
                        status.as_u16()
                    )));
                }
                if let Some(value) = response
                    .headers()
                    .get("retry-after")
                    .and_then(|h| h.to_str().ok())
                {
                    let seconds = value.parse::<u64>().ok().or_else(|| {
                        chrono::DateTime::parse_from_rfc2822(value).ok().map(|d| {
                            (d.with_timezone(&Utc) - Utc::now()).num_seconds().max(0) as u64
                        })
                    });
                    if let Some(seconds) = seconds {
                        if seconds > 10 {
                            return Err(AppError::Network(
                                "TMDB 要求稍后重试，请稍后刷新；已有资料仍会保留".into(),
                            ));
                        }
                        delay = delay.max(seconds * 1000);
                    }
                }
            }
            Err(_) if attempt < 2 => {}
            Err(_) => {
                return Err(AppError::Network(
                    "TMDB 连接失败或超时，请检查网络后重试".into(),
                ))
            }
        }
        tokio::time::sleep(StdDuration::from_millis(delay)).await;
    }
    unreachable!()
}

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}
fn nonempty(v: String) -> Option<String> {
    (!v.trim().is_empty()).then_some(v)
}
fn artwork(v: &Value, key: &str) -> Option<String> {
    v[key]
        .as_str()
        .filter(|s| s.starts_with('/') && !s.contains(".."))
        .map(|s| {
            let size = "original";
            format!("https://image.tmdb.org/t/p/{size}{s}")
        })
}
pub(crate) fn metadata(item: &Value, kind: Kind, season: Option<i64>) -> AppResult<WorkMetadata> {
    let id = item["id"]
        .as_u64()
        .filter(|id| *id > 0)
        .ok_or_else(|| AppError::Network("TMDB 缺少条目 ID".into()))?;
    let title = text(item, if kind == Kind::Movie { "title" } else { "name" });
    if title.trim().is_empty() {
        return Err(AppError::Network("TMDB 缺少作品名称".into()));
    }
    let date = nonempty(text(
        item,
        if kind == Kind::Movie {
            "release_date"
        } else {
            "first_air_date"
        },
    ));
    let title = if let Some(s) = season {
        format!("{title} · 第 {s} 季")
    } else {
        title
    };
    let external_id = if let Some(s) = season {
        format!("tv/{id}/season/{s}")
    } else {
        format!("movie/{id}")
    };
    let cover = artwork(item, "poster_path");
    let banner = artwork(item, "backdrop_path");
    Ok(WorkMetadata {
        provider: "tmdb".into(),
        external_id,
        title,
        original_title: nonempty(text(
            item,
            if kind == Kind::Movie {
                "original_title"
            } else {
                "original_name"
            },
        )),
        aliases: vec![text(
            item,
            if kind == Kind::Movie { "title" } else { "name" },
        )],
        description: text(item, "overview"),
        cover_url: cover.clone(),
        banner_url: banner.clone(),
        year: date
            .as_ref()
            .and_then(|s| s.get(..4))
            .and_then(|s| s.parse().ok()),
        season,
        subject_type: kind.key().into(),
        genres: item["genres"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|g| nonempty(text(g, "name")))
            .collect(),
        score: item["vote_average"]
            .as_f64()
            .filter(|_| item["vote_count"].as_i64().unwrap_or(0) > 0),
        rank: None,
        rating_count: item["vote_count"].as_i64().unwrap_or(0),
        rating_distribution: None,
        collection_count: 0,
        air_date: date,
        broadcast: None,
        source_keys: vec!["tmdb".into()],
        cover_provider: cover.map(|_| "tmdb".into()),
        banner_provider: banner.map(|_| "tmdb".into()),
        score_provider: Some("tmdb".into()),
        fetched_at: Utc::now().to_rfc3339(),
    })
}

pub async fn recognize(
    state: &AppState,
    media_id: &str,
    query: Option<String>,
    kind: Kind,
    season: Option<i64>,
) -> AppResult<RecognitionResult> {
    let file = sqlx::query_as::<_, MediaFile>("SELECT * FROM media_files WHERE id=?")
        .bind(media_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("媒体文件不存在".into()))?;
    if file.media_type != "video" || file.missing {
        return Err(AppError::Validation("请选择可用的视频文件".into()));
    }
    let parsed = parse_video(&file, kind);
    let title = query
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or(parsed.title.clone())
        .ok_or_else(|| AppError::Validation("无法提取作品名称，请输入标题搜索".into()))?;
    let season = if kind == Kind::Tv {
        Some(season.or(parsed.season).unwrap_or(1))
    } else {
        None
    };
    if season.is_some_and(|s| !(0..=999).contains(&s)) {
        return Err(AppError::Validation(
            "季度必须介于 0 至 999，0 表示特别篇".into(),
        ));
    }
    // A season's release year is not necessarily the series' premiere year.
    let mut params = vec![("query", title.clone())];
    if kind == Kind::Movie && query.is_none() {
        if let Some(year) = parsed.year {
            params.push(("primary_release_year", year.to_string()));
        }
    }
    let response = request(
        &state.pool,
        &format!("search/{}", kind.key()),
        &params,
        false,
    )
    .await?;
    let items = response.data["results"]
        .as_array()
        .ok_or_else(|| AppError::Network("TMDB 搜索响应缺少结果列表".into()))?;
    let (_guard, mut tx) = db::begin_write(&state.pool).await?;
    sqlx::query("DELETE FROM match_candidates WHERE media_file_id=?")
        .bind(media_id)
        .execute(&mut *tx)
        .await?;
    for item in items.iter().take(12) {
        let m = metadata(item, kind, season)?;
        let q = crate::metadata_provider::MetadataSearchQuery {
            title: title.clone(),
            aliases: vec![],
            year: if kind == Kind::Movie {
                parsed.year
            } else {
                None
            },
            subject_type: kind.key().into(),
        };
        let confidence = crate::metadata_provider::supplemental_match_confidence(&q, &m);
        let mut reasons = vec![format!(
            "TMDB {}候选，请核对标题与年份",
            if kind == Kind::Movie {
                "电影"
            } else {
                "电视剧"
            }
        )];
        if let Some(s) = season {
            reasons.push(format!("将关联第 {s} 季；确认时校验文件季号"));
        }
        sqlx::query("INSERT INTO match_candidates(id,media_file_id,provider,external_id,title,original_title,aliases_json,subject_type,year,season,cover_url,confidence,match_reasons_json,metadata_json,created_at) VALUES(?,?,'tmdb',?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(media_id).bind(&m.external_id).bind(&m.title).bind(&m.original_title).bind(serde_json::to_string(&m.aliases)?).bind(&m.subject_type).bind(m.year).bind(m.season).bind(&m.cover_url).bind(confidence).bind(serde_json::to_string(&reasons)?).bind(serde_json::to_string(&m)?).bind(&m.fetched_at).execute(&mut *tx).await?;
    }
    let status = if items.is_empty() {
        "unmatched"
    } else {
        "candidate_pending"
    };
    sqlx::query("UPDATE media_files SET recognition_status=?,recognition_error=?,last_recognized_at=? WHERE id=?")
        .bind(status).bind(&response.warning).bind(Utc::now().to_rfc3339()).bind(media_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(RecognitionResult {
        media_file_id: media_id.into(),
        status: status.into(),
        parsed_title: Some(title),
        candidates: crate::metadata::candidates_for_media(&state.pool, media_id).await?,
        error: response.warning,
    })
}

/// Only an explicit TMDB primary anchor qualifies; animation's TMDB supplement does not.
pub async fn anchor(pool: &SqlitePool, work: &str) -> AppResult<Option<String>> {
    Ok(sqlx::query_scalar("SELECT external_id FROM work_external_ids WHERE work_id=? AND provider='tmdb' AND NOT EXISTS(SELECT 1 FROM work_external_ids WHERE work_id=? AND provider='bangumi')")
        .bind(work).bind(work).fetch_optional(pool).await?)
}

pub async fn confirm(
    state: &AppState,
    candidate: &MatchCandidateRow,
    ids: &[String],
) -> AppResult<String> {
    let m: WorkMetadata = serde_json::from_str(&candidate.metadata_json)?;
    let anchor = Anchor::parse(&m.external_id)?;
    let (_guard, mut tx) = db::begin_write(&state.pool).await?;
    let valid: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM match_candidates WHERE id=? AND media_file_id=?)",
    )
    .bind(&candidate.id)
    .bind(&candidate.media_file_id)
    .fetch_one(&mut *tx)
    .await?;
    if !valid {
        return Err(AppError::Validation("候选已过期，请重新搜索".into()));
    }
    let files = sqlx::query_as::<_, MediaFile>(
        "SELECT * FROM media_files WHERE id IN (SELECT value FROM json_each(?))",
    )
    .bind(serde_json::to_string(ids)?)
    .fetch_all(&mut *tx)
    .await?;
    for file in files.iter().filter(|f| f.media_type == "video") {
        if anchor.kind == Kind::Tv {
            let parsed = parse_video(file, Kind::Tv);
            if parsed.season.is_some_and(|s| Some(s) != anchor.season) {
                return Err(AppError::Validation(format!(
                    "{} 属于其他季度，请取消勾选后单独识别",
                    file.file_name
                )));
            }
        }
    }
    let existing: Option<String> = sqlx::query_scalar("SELECT work_id FROM work_external_ids WHERE provider='tmdb' AND external_id=? AND NOT EXISTS(SELECT 1 FROM work_external_ids b WHERE b.work_id=work_external_ids.work_id AND b.provider='bangumi')")
        .bind(&m.external_id).fetch_optional(&mut *tx).await?;
    let occupied: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM work_external_ids WHERE provider='tmdb' AND external_id=?)",
    )
    .bind(&m.external_id)
    .fetch_one(&mut *tx)
    .await?;
    if existing.is_none() && occupied {
        return Err(AppError::Validation(
            "该 TMDB 条目已关联到动漫作品，请在已有作品中管理文件，避免重复建库".into(),
        ));
    }
    let is_existing = existing.is_some();
    let target = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
    let undo = crate::recognition_history::begin(&mut tx, &target, ids).await?;
    // Do not reuse or rename the original work when only some files are selected.
    sqlx::query(
        "INSERT OR IGNORE INTO works(id,title,type,created_at,updated_at) VALUES (?,?,'video',?,?)",
    )
    .bind(&target)
    .bind(&m.title)
    .bind(&m.fetched_at)
    .bind(&m.fetched_at)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,'tmdb',?,?,?) ON CONFLICT(work_id,provider) DO NOTHING")
        .bind(&target).bind(&m.external_id).bind(&m.fetched_at).bind(&m.fetched_at).execute(&mut *tx).await?;
    if !is_existing {
        crate::metadata::apply_metadata(&mut tx, &target, &m, None, None, &m.fetched_at).await?;
        persist_metadata(&mut tx, &target, &m).await?;
    }
    for id in ids {
        sqlx::query("DELETE FROM media_episode_links WHERE media_file_id=? AND work_id!=?")
            .bind(id)
            .bind(&target)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM subtitle_links WHERE (subtitle_media_file_id=? OR video_media_file_id=?) AND work_id!=?").bind(id).bind(id).bind(&target).execute(&mut *tx).await?;
        sqlx::query("UPDATE media_files SET work_id=?,recognition_status='matched',recognition_error=NULL,last_recognized_at=?,updated_at=? WHERE id=?")
            .bind(&target).bind(&m.fetched_at).bind(&m.fetched_at).bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM match_candidates WHERE media_file_id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    crate::media_mapping::rebuild_subtitle_links(&mut tx, &target).await?;
    rebuild_links(&mut tx, &target).await?;
    crate::recognition_preferences::learn(&mut tx, &target, ids).await?;
    crate::recognition_history::finish(&mut tx, undo, &target, &m.title).await?;
    tx.commit().await?;
    Ok(target)
}

async fn persist_metadata(
    tx: &mut Transaction<'_, Sqlite>,
    work: &str,
    m: &WorkMetadata,
) -> AppResult<()> {
    sqlx::query("INSERT INTO metadata_provider_records(work_id,provider,external_id,title,year,confidence,response_json,fetched_at) VALUES(?,'tmdb',?,?,?,1,?,?) ON CONFLICT(work_id,provider) DO UPDATE SET external_id=excluded.external_id,title=excluded.title,year=excluded.year,response_json=excluded.response_json,fetched_at=excluded.fetched_at")
        .bind(work).bind(&m.external_id).bind(&m.title).bind(m.year).bind(serde_json::to_string(m)?).bind(&m.fetched_at).execute(&mut **tx).await?;
    Ok(())
}

pub async fn rebuild_links(tx: &mut Transaction<'_, Sqlite>, work: &str) -> AppResult<()> {
    let id: Option<String> = sqlx::query_scalar(
        "SELECT external_id FROM work_external_ids WHERE work_id=? AND provider='tmdb'",
    )
    .bind(work)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(id) = id else {
        return Ok(());
    };
    let anchor = Anchor::parse(&id)?;
    if anchor.kind != Kind::Tv {
        return Ok(());
    }
    let overrides = crate::recognition_preferences::restore_overrides(tx, work).await?;
    let files = sqlx::query_as::<_, MediaFile>(
        "SELECT * FROM media_files WHERE work_id=? AND media_type='video'",
    )
    .bind(work)
    .fetch_all(&mut **tx)
    .await?;
    let episodes: Vec<(String, i64)> = sqlx::query_as("SELECT external_id,episode_number FROM anime_episodes WHERE work_id=? AND provider='tmdb' AND episode_number IS NOT NULL").bind(work).fetch_all(&mut **tx).await?;
    if episodes.is_empty() {
        return Ok(());
    }
    sqlx::query("DELETE FROM media_episode_links WHERE work_id=? AND match_method='parsed'")
        .bind(work)
        .execute(&mut **tx)
        .await?;
    for file in files {
        if overrides.contains(&file.id) { continue; }
        let p = parse_video(&file, Kind::Tv);
        if p.season.is_some_and(|s| Some(s) != anchor.season)
            || p.special_type.is_some()
            || p.episode_end.is_some_and(|n| Some(n) != p.episode_start)
        {
            continue;
        }
        let Some(number) = p.episode_start else {
            continue;
        };
        let matches: Vec<_> = episodes
            .iter()
            .filter(|(_, n)| *n == i64::from(number))
            .collect();
        if matches.len() != 1 {
            continue;
        }
        sqlx::query("INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES(?,?,'tmdb',?,'parsed',1,?) ON CONFLICT(media_file_id) DO NOTHING")
            .bind(&file.id).bind(work).bind(&matches[0].0).bind(Utc::now().to_rfc3339()).execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn enrich(
    state: &AppState,
    work: &str,
    expected: &str,
    fresh: bool,
) -> AppResult<Vec<String>> {
    let result = enrich_inner(state, work, expected, fresh).await;
    if let Err(error) = &result {
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at")
            .bind(format!("warnings:{work}")).bind(serde_json::to_string(&vec![format!("{error}；已确认的文件关联仍然保留，请稍后刷新元数据")])?).bind(&now).bind(&now).execute(&state.pool).await?;
    }
    result
}

async fn enrich_inner(
    state: &AppState,
    work: &str,
    expected: &str,
    fresh: bool,
) -> AppResult<Vec<String>> {
    let operation = crate::recognition_history::background_operation(&state.pool, work, fresh).await?;
    let a = Anchor::parse(expected)?;
    let response = request(
        &state.pool,
        &format!("{}/{}", a.kind.key(), a.id),
        &[],
        fresh,
    )
    .await?;
    let mut warnings: Vec<String> = response.warning.into_iter().collect();
    let mut m = metadata(&response.data, a.kind, a.season)?;
    let mut episodes = Vec::new();
    if let Some(season) = a.season {
        match request(
            &state.pool,
            &format!("tv/{}/season/{season}", a.id),
            &[],
            fresh,
        )
        .await
        {
            Ok(result) => {
                warnings.extend(result.warning);
                episodes = parse_episodes(&result.data, expected);
                if episodes.is_empty() {
                    warnings.push("TMDB 暂无本季分集，已有分集与手动关联已保留".into());
                }
                if let Some(cover) = artwork(&result.data, "poster_path") {
                    m.cover_url = Some(cover);
                }
                if !text(&result.data, "overview").is_empty() {
                    m.description = text(&result.data, "overview");
                }
            }
            Err(error) => warnings.push(format!("{error}；已有分集与手动关联已保留")),
        }
    }
    warnings.extend(crate::tmdb_artwork::enrich(&state.pool, &mut m, fresh).await);
    let cover = cache_art(
        &state.cover_cache_path,
        expected,
        "cover",
        m.cover_url.as_deref(),
    )
    .await;
    let banner = cache_art(
        &state.cover_cache_path,
        expected,
        "banner",
        m.banner_url.as_deref(),
    )
    .await;
    if m.banner_url.is_some() && banner.is_none() {
        warnings.push("高清背景下载失败，已有背景图已保留，可稍后刷新元数据重试".into());
    }
    if m.cover_url.is_some() && cover.is_none() {
        warnings.push("封面下载失败，已有封面已保留，可稍后刷新元数据重试".into());
    }
    let (_guard, mut tx) = db::begin_write(&state.pool).await?;
    let current: Option<String> = sqlx::query_scalar(
        "SELECT external_id FROM work_external_ids WHERE work_id=? AND provider='tmdb'",
    )
    .bind(work)
    .fetch_optional(&mut *tx)
    .await?;
    if current.as_deref() != Some(expected) {
        return Ok(Vec::new());
    }
    if let Some(operation) = operation {
        let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM recognition_history WHERE id=? AND undone_at IS NULL)")
            .bind(operation).fetch_one(&mut *tx).await?;
        if !active { return Ok(Vec::new()); }
    }
    let undo = crate::recognition_history::before_enrichment(&mut tx, work).await?;
    // A missing translation or partial detail response must not erase saved text.
    let previous: Option<String> = sqlx::query_scalar(
        "SELECT response_json FROM metadata_provider_records WHERE work_id=? AND provider='tmdb'",
    )
    .bind(work)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(previous) =
        previous.and_then(|json| serde_json::from_str::<WorkMetadata>(&json).ok())
    {
        if m.genres.is_empty() {
            m.genres = previous.genres;
        }
    }
    let (description, original, year): (String, Option<String>, Option<i64>) =
        sqlx::query_as("SELECT description,original_title,metadata_year FROM works WHERE id=?")
            .bind(work)
            .fetch_one(&mut *tx)
            .await?;
    if m.description.trim().is_empty() {
        m.description = description;
    }
    if m.original_title.is_none() {
        m.original_title = original;
    }
    if m.year.is_none() {
        m.year = year;
    }
    crate::metadata::apply_metadata(
        &mut tx,
        work,
        &m,
        cover.clone(),
        banner.clone(),
        &m.fetched_at,
    )
    .await?;
    persist_metadata(&mut tx, work, &m).await?;
    persist_episodes(&mut tx, work, &episodes).await?;
    rebuild_links(&mut tx, work).await?;
    crate::recognition_history::after_enrichment(&mut tx, undo).await?;
    // Warnings are local metadata, never mixed with user notes.
    sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
        .bind(format!("warnings:{work}")).bind(serde_json::to_string(&warnings)?).bind(&m.fetched_at).bind(&m.fetched_at).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok([cover, banner].into_iter().flatten().collect())
}

fn parse_episodes(data: &Value, anchor: &str) -> Vec<AnimeEpisodeMetadata> {
    data["episodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| {
            let n = u32::try_from(v["episode_number"].as_u64()?).ok()?;
            Some(AnimeEpisodeMetadata {
                provider: "tmdb".into(),
                external_id: format!("{anchor}/episode/{n}"),
                episode_number: Some(n),
                sort_number: n,
                episode_type: Some(0),
                title: text(v, "name"),
                original_title: None,
                description: text(v, "overview"),
                air_date: nonempty(text(v, "air_date")),
                duration: v["runtime"].as_u64().map(|n| format!("{n} 分钟")),
                fetched_at: Utc::now().to_rfc3339(),
            })
        })
        .collect()
}

async fn persist_episodes(
    tx: &mut Transaction<'_, Sqlite>,
    work: &str,
    episodes: &[AnimeEpisodeMetadata],
) -> AppResult<()> {
    // Upsert only. An incomplete response must never cascade-delete manual links.
    for ep in episodes {
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,description,air_date,duration,fetched_at) VALUES(?,'tmdb',?,?,?,0,?,?,?,?,?) ON CONFLICT(work_id,provider,external_id) DO UPDATE SET title=excluded.title,description=excluded.description,air_date=excluded.air_date,duration=excluded.duration,fetched_at=excluded.fetched_at")
            .bind(work).bind(&ep.external_id).bind(ep.episode_number.map(i64::from)).bind(i64::from(ep.sort_number)).bind(&ep.title).bind(&ep.description).bind(&ep.air_date).bind(&ep.duration).bind(&ep.fetched_at).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn cache_art(directory: &Path, id: &str, kind: &str, url: Option<&str>) -> Option<String> {
    let url = url?;
    let path = crate::metadata_aggregator::artwork_cache_path(directory, id, kind, url);
    let cached = if path.is_file() { true } else if kind == "banner" {
        crate::metadata_aggregator::cache_banner(url, &path).await.is_ok()
    } else { crate::metadata_aggregator::cache_cover(url, &path).await.is_ok() };
    if cached
    {
        Some(path.to_string_lossy().into())
    } else {
        None
    }
}

pub async fn structure(pool: &SqlitePool, work: &str, id: &str) -> AppResult<AnimeWorkStructure> {
    let a = Anchor::parse(id)?;
    let media = sqlx::query_as::<_, MediaFile>(
        "SELECT * FROM media_files WHERE work_id=? ORDER BY file_name COLLATE NOCASE",
    )
    .bind(work)
    .fetch_all(pool)
    .await?;
    let links: Vec<(String, String)> = sqlx::query_as("SELECT media_file_id,episode_external_id FROM media_episode_links WHERE work_id=? AND provider='tmdb'").bind(work).fetch_all(pool).await?;
    let linked: HashMap<_, _> = links.into_iter().collect();
    let mut files: HashMap<String, Vec<MediaFile>> = HashMap::new();
    let mut unmatched = Vec::new();
    for file in media {
        if let Some(ep) = linked.get(&file.id) {
            files.entry(ep.clone()).or_default().push(file);
        } else if file.media_type == "video" {
            unmatched.push(file);
        }
    }
    let warnings: Option<String> = sqlx::query_scalar(
        "SELECT response_json FROM metadata_cache WHERE provider='tmdb' AND cache_key=?",
    )
    .bind(format!("warnings:{work}"))
    .fetch_optional(pool)
    .await?;
    let mut warnings: Vec<String> = warnings
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let key = format!("film-tv:zh-CN:{id}:[]");
    let season_json: Option<String> = sqlx::query_scalar(
        "SELECT response_json FROM metadata_cache WHERE provider='tmdb' AND cache_key=?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?;
    let season_data: Value = season_json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let episodes = crate::metadata_aggregator::episodes_for_work(pool, work)
        .await?
        .into_iter()
        .filter(|ep| ep.provider == "tmdb")
        .map(|ep| {
            let image_url = season_data["episodes"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|v| v["episode_number"].as_u64() == ep.episode_number.map(u64::from))
                .and_then(|v| artwork(v, "still_path"));
            AnimeEpisodeEntry {
                image_url,
                local_files: files.remove(&ep.external_id).unwrap_or_default(),
                episode: ep,
            }
        })
        .collect::<Vec<_>>();
    if a.kind == Kind::Tv && episodes.is_empty() {
        warnings.push("尚无官方分集，请刷新元数据；视频仍可从下方打开".into());
    }
    let prefix = format!("tv/{}/season/%", a.id);
    let local: Vec<(String, String, String, Option<String>)> = if a.kind == Kind::Tv {
        sqlx::query_as("SELECT w.id,e.external_id,w.title,w.cover_path FROM works w JOIN work_external_ids e ON w.id=e.work_id WHERE e.provider='tmdb' AND e.external_id LIKE ? ORDER BY e.external_id")
        .bind(prefix).fetch_all(pool).await?
    } else {
        Vec::new()
    };
    let mut seasons: Vec<_> = local
        .into_iter()
        .map(
            |(work_id, external_id, title, cover_url)| AnimeSeasonOption {
                season_number: Anchor::parse(&external_id)
                    .ok()
                    .and_then(|a| a.season)
                    .and_then(|n| u32::try_from(n).ok()),
                current: work_id == work,
                local_work_id: Some(work_id),
                external_id,
                title,
                original_title: None,
                relation: "已入库季度".into(),
                cover_url,
            },
        )
        .collect();
    seasons.sort_by_key(|s| s.season_number);
    Ok(AnimeWorkStructure {
        work_id: work.into(),
        bangumi_id: String::new(),
        seasons,
        episodes,
        unmatched_files: unmatched,
        staff: vec![],
        characters: vec![],
        warnings,
    })
}

pub async fn batch(state: &AppState, kind: Kind, ids: &[String]) -> AppResult<RecognitionSummary> {
    let mut summary = RecognitionSummary {
        scanned: 0,
        matched: 0,
        pending: 0,
        unmatched: 0,
        errors: 0,
    };
    let mut seen = std::collections::HashSet::new();
    let mut targets = Vec::new();
    for id in ids {
        if let Some(group) = crate::grouping::recognition_group_context(&state.pool, id).await? {
            for file in group
                .members
                .into_iter()
                .filter(|f| f.media_type == "video" && f.work_id.is_none() && !f.missing)
            {
                if seen.insert(file.id.clone()) {
                    targets.push(file.id);
                }
            }
        } else if seen.insert(id.clone()) {
            targets.push(id.clone());
        }
    }
    for id in targets {
        summary.scanned += 1;
        match recognize(state, &id, None, kind, None).await {
            Ok(result) if result.status == "candidate_pending" => summary.pending += 1,
            Ok(_) => summary.unmatched += 1,
            Err(error) => {
                summary.errors += 1;
                sqlx::query("UPDATE media_files SET recognition_status='error',recognition_error=? WHERE id=? AND work_id IS NULL").bind(error.to_string()).bind(&id).execute(&state.pool).await?;
            }
        }
    }
    Ok(summary)
}

#[cfg(test)]
#[path = "film_tv_tests.rs"]
mod tests;
