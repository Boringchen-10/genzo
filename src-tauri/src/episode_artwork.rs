//! Independently selected stills. Never write anime_episodes, media links or progress.
use crate::{
    db::{self, AppState},
    error::{AppError, AppResult},
    film_tv,
    models::AnimeEpisodeMetadata,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, SqlitePool};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    sync::OnceLock,
};
use tauri::{AppHandle, State};

#[derive(Clone, Debug, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub anchor: String,
    pub series_id: i64,
    pub season_number: i64,
    pub method: String,
    pub episode_offset: i64,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub anchor: String,
    pub source: Option<Source>,
    pub images: BTreeMap<String, String>,
    pub cached_images: BTreeMap<String, String>,
    pub warnings: Vec<String>,
    pub source_title: Option<String>,
    pub correspondence: Vec<Correspondence>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Correspondence {
    pub(crate) episode_key: String,
    local_number: u32,
    pub(crate) tmdb_number: i64,
    has_still: bool,
}
fn correspondence(
    episodes: &[AnimeEpisodeMetadata],
    data: &Value,
    source: &Source,
) -> Vec<Correspondence> {
    episodes
        .iter()
        .filter(|e| {
            e.provider
                == if source.anchor.starts_with("tmdb:") {
                    "tmdb"
                } else {
                    "bangumi"
                }
                && e.episode_type.unwrap_or(0) == 0
        })
        .filter_map(|e| {
            let n = e.episode_number?;
            if episodes
                .iter()
                .filter(|other| {
                    other.provider == e.provider
                        && other.episode_type.unwrap_or(0) == 0
                        && other.episode_number == Some(n)
                })
                .count()
                != 1
            {
                return None;
            }
            let target = i64::from(n) + source.episode_offset;
            let rows = data["episodes"].as_array()?;
            let matching: Vec<_> = rows
                .iter()
                .filter(|r| {
                    r["season_number"].as_i64() == Some(source.season_number)
                        && r["episode_number"].as_i64() == Some(target)
                })
                .collect();
            (matching.len() == 1).then(|| Correspondence {
                episode_key: format!("{}:{}", e.provider, e.external_id),
                local_number: n,
                tmdb_number: target,
                has_still: still(matching[0]).is_some(),
            })
        })
        .collect()
}

async fn anchor(pool: &SqlitePool, work: &str) -> AppResult<String> {
    let row: Option<(String, String)> = sqlx::query_as("SELECT provider,external_id FROM work_external_ids WHERE work_id=? AND provider IN ('bangumi','tmdb') ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1")
        .bind(work).fetch_optional(pool).await?;
    row.map(|(p, id)| format!("{p}:{id}"))
        .ok_or_else(|| AppError::Validation("作品尚未关联 Bangumi 或 TMDB 条目".into()))
}
fn path(source: &Source) -> String {
    format!("tv/{}/season/{}", source.series_id, source.season_number)
}
async fn season_cache(pool: &SqlitePool, path: &str) -> AppResult<Value> {
    let data: Option<String> = sqlx::query_scalar(
        "SELECT response_json FROM metadata_cache WHERE provider='tmdb' AND cache_key=?",
    )
    .bind(format!("film-tv:zh-CN:{path}:[]"))
    .fetch_optional(pool)
    .await?;
    Ok(data
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null))
}
fn date(value: Option<&str>) -> Option<NaiveDate> {
    value.and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
}
fn close_dates(left: Option<&str>, right: Option<&str>) -> bool {
    match (date(left), date(right)) {
        (Some(a), Some(b)) => (a - b).num_days().abs() <= 7,
        _ => false,
    }
}
fn still(value: &Value) -> Option<String> {
    let p = value["still_path"].as_str()?;
    // Only TMDB file names, not URLs or arbitrary paths supplied by a caller.
    if !p.starts_with('/')
        || p[1..].contains('/')
        || ![".jpg", ".png", ".webp"]
            .iter()
            .any(|extension| p.ends_with(extension))
        || !p[1..]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_- .".contains(&c))
        || p.contains("..")
    {
        return None;
    }
    Some(format!("https://image.tmdb.org/t/p/w780{p}"))
}
fn mapped(
    episodes: &[AnimeEpisodeMetadata],
    data: &Value,
    source: &Source,
) -> BTreeMap<String, String> {
    let rows = data["episodes"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let primary = source.anchor.starts_with("tmdb:");
    let mut images = BTreeMap::new();
    for ep in episodes.iter().filter(|e| {
        e.provider == if primary { "tmdb" } else { "bangumi" }
            && (primary || e.episode_type.unwrap_or(0) == 0)
    }) {
        let Some(n) = ep.episode_number.filter(|n| primary || *n > 0) else {
            continue;
        };
        if episodes
            .iter()
            .filter(|e| {
                e.provider == ep.provider
                    && e.episode_type.unwrap_or(0) == ep.episode_type.unwrap_or(0)
                    && e.episode_number == Some(n)
            })
            .count()
            != 1
        {
            continue;
        }
        let matches: Vec<_> = rows
            .iter()
            .filter(|v| {
                v["episode_number"].as_i64() == Some(i64::from(n) + source.episode_offset)
                    && v["season_number"].as_i64() == Some(source.season_number)
            })
            .collect();
        if matches.len() != 1 {
            continue;
        }
        let row = matches[0];
        if source.method == "verified"
            && !close_dates(ep.air_date.as_deref(), row["air_date"].as_str())
        {
            continue;
        }
        if let Some(url) = still(row) {
            images.insert(format!("{}:{}", ep.provider, ep.external_id), url);
        }
    }
    images
}

/// A provider may split a cour into a separate work while TMDB keeps one season.
/// Verify every dated main episode; undated episodes cannot supply automatic images.
fn alignment(episodes: &[AnimeEpisodeMetadata], data: &Value, season: i64) -> Option<i64> {
    let main: Vec<_> = episodes
        .iter()
        .filter(|e| e.provider == "bangumi" && e.episode_type.unwrap_or(0) == 0)
        .collect();
    let rows = data["episodes"].as_array()?;
    if main.len() < 2 {
        return None;
    }
    let mut numbers = HashSet::new();
    if main.iter().any(|e| {
        e.episode_number
            .filter(|n| *n > 0)
            .is_none_or(|n| !numbers.insert(n))
    }) {
        return None;
    }
    let main: Vec<_> = main
        .into_iter()
        .filter(|e| date(e.air_date.as_deref()).is_some())
        .collect();
    if main.len() < 2 {
        return None;
    }
    let first = main.iter().min_by_key(|e| e.episode_number)?;
    let mut offsets = HashSet::new();
    let mut scores = Vec::new();
    for row in rows.iter().filter(|r| {
        r["season_number"].as_i64() == Some(season)
            && close_dates(first.air_date.as_deref(), r["air_date"].as_str())
    }) {
        let offset = row["episode_number"].as_i64()? - i64::from(first.episode_number?);
        if !(-9999..=9999).contains(&offset) {
            continue;
        }
        if !offsets.insert(offset) {
            continue;
        }
        let score = main.iter().try_fold(0i64, |score, e| {
            let n = i64::from(e.episode_number?) + offset;
            let matched: Vec<_> = rows
                .iter()
                .filter(|r| {
                    r["episode_number"].as_i64() == Some(n)
                        && r["season_number"].as_i64() == Some(season)
                })
                .collect();
            if matched.len() != 1
                || !close_dates(e.air_date.as_deref(), matched[0]["air_date"].as_str())
            {
                return None;
            }
            Some(
                score
                    + (date(e.air_date.as_deref())? - date(matched[0]["air_date"].as_str())?)
                        .num_days()
                        .abs(),
            )
        });
        if let Some(score) = score {
            scores.push((score, offset));
        }
    }
    scores.sort_unstable();
    let best = scores.first()?;
    if scores.get(1).is_some_and(|next| next.0 == best.0) {
        return None;
    }
    Some(best.1)
}
#[cfg(test)]
fn verifies(episodes: &[AnimeEpisodeMetadata], data: &Value, season: i64) -> bool {
    alignment(episodes, data, season).is_some()
}
async fn source(pool: &SqlitePool, work: &str, current: &str) -> AppResult<Option<Source>> {
    if let Some(id) = current.strip_prefix("tmdb:") {
        if let Ok(a) = film_tv::Anchor::parse(id) {
            if let Some(season) = a.season {
                return Ok(Some(Source {
                    anchor: current.into(),
                    series_id: a.id as i64,
                    season_number: season,
                    method: "primary".into(),
                    episode_offset: 0,
                }));
            }
        }
        return Ok(None);
    }
    Ok(sqlx::query_as::<_, Source>("SELECT anchor,series_id,season_number,method,episode_offset FROM episode_artwork_sources WHERE work_id=? AND anchor=?")
        .bind(work).bind(current).fetch_optional(pool).await?)
}
pub async fn cached(pool: &SqlitePool, work: &str) -> AppResult<Artwork> {
    let current = anchor(pool, work).await?;
    let source = source(pool, work, &current).await?;
    let mut result = Artwork {
        anchor: current,
        source: source.clone(),
        ..Artwork::default()
    };
    if let Some(s) = source {
        let episodes = crate::metadata_aggregator::episodes_for_work(pool, work).await?;
        let data = season_cache(pool, &path(&s)).await?;
        result.images = mapped(&episodes, &data, &s);
        result.correspondence = correspondence(&episodes, &data, &s);
        result.source_title = data["name"].as_str().map(str::to_owned);
    }
    Ok(result)
}
async fn save_source(pool: &SqlitePool, work: &str, s: &Source) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    let current: Option<(String, String)> = sqlx::query_as("SELECT provider,external_id FROM work_external_ids WHERE work_id=? AND provider IN ('bangumi','tmdb') ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1").bind(work).fetch_optional(&mut *tx).await?;
    if current.map(|(p, id)| format!("{p}:{id}")) != Some(s.anchor.clone()) {
        return Err(AppError::Validation(
            "作品已重新识别，请重新选择剧照来源".into(),
        ));
    }
    sqlx::query("INSERT INTO episode_artwork_sources(work_id,anchor,series_id,season_number,method,episode_offset,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET anchor=excluded.anchor,series_id=excluded.series_id,season_number=excluded.season_number,method=excluded.method,episode_offset=excluded.episode_offset,updated_at=excluded.updated_at WHERE episode_artwork_sources.anchor != excluded.anchor OR episode_artwork_sources.method != 'manual' OR excluded.method = 'manual'")
        .bind(work).bind(&s.anchor).bind(s.series_id).bind(s.season_number).bind(&s.method).bind(s.episode_offset).bind(Utc::now().to_rfc3339()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
async fn accepted_series(
    pool: &SqlitePool,
    work: &str,
    current: &str,
) -> AppResult<Option<String>> {
    let pair: Option<(String, String, String)> = sqlx::query_as("SELECT p.response_json,t.response_json,t.external_id FROM metadata_provider_records p JOIN metadata_provider_records t ON p.work_id=t.work_id WHERE p.work_id=? AND p.provider='bangumi' AND p.external_id=? AND t.provider='tmdb' AND t.confidence>=0.85")
        .bind(work).bind(current.trim_start_matches("bangumi:")).fetch_optional(pool).await?;
    let Some((p, t, external)) = pair else {
        return Ok(None);
    };
    let (Ok(primary), Ok(candidate)) = (
        serde_json::from_str::<crate::models::WorkMetadata>(&p),
        serde_json::from_str::<crate::models::WorkMetadata>(&t),
    ) else {
        return Ok(None);
    };
    // Supplement records can outlive a re-identification. Revalidate against the
    // current primary rather than trusting an old confidence number alone.
    if primary.provider != "bangumi"
        || format!("bangumi:{}", primary.external_id) != current
        || candidate.provider != "tmdb"
        || candidate.external_id != external
    {
        return Ok(None);
    }
    let query = crate::metadata_provider::MetadataSearchQuery::from_primary(&primary);
    Ok(
        (crate::metadata_provider::supplemental_match_confidence(&query, &candidate) >= 0.85)
            .then_some(external),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesCandidate {
    series_id: i64,
    title: String,
    original_title: String,
    air_date: Option<String>,
    confidence: f64,
}
#[derive(Serialize)]
pub struct SearchResult {
    candidates: Vec<SeriesCandidate>,
    warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonChoice {
    season_number: i64,
    name: String,
    episode_count: i64,
    air_date: Option<String>,
}
#[derive(Serialize)]
pub struct SeasonsResult {
    title: String,
    seasons: Vec<SeasonChoice>,
    warnings: Vec<String>,
}
fn base_title(title: &str) -> String {
    static SUFFIX: OnceLock<regex::Regex> = OnceLock::new();
    SUFFIX.get_or_init(|| regex::Regex::new(r"(?i)\s*(?:第\s*[一二三四五六七八九十百零〇两\d]+\s*[季期]|(?:\d+(?:st|nd|rd|th)\s+)?season\s*\d*|s\d{1,2})\s*$").unwrap()).replace(title.trim(), "").trim().to_owned()
}
async fn titles(pool: &SqlitePool, work: &str) -> AppResult<Vec<String>> {
    let current = anchor(pool, work).await?;
    let json: Option<String> = sqlx::query_scalar("SELECT response_json FROM metadata_provider_records WHERE work_id=? AND provider='bangumi' AND external_id=?").bind(work).bind(current.trim_start_matches("bangumi:")).fetch_optional(pool).await?;
    let mut result = Vec::new();
    if let Some(m) = json.and_then(|s| serde_json::from_str::<crate::models::WorkMetadata>(&s).ok())
    {
        result.extend(m.original_title);
        result.push(m.title);
        result.extend(m.aliases);
    }
    let title: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT title,original_title FROM works WHERE id=?")
            .bind(work)
            .fetch_optional(pool)
            .await?;
    if let Some((title, original)) = title {
        result.extend(original);
        result.push(title);
    }
    let mut seen = HashSet::new();
    Ok(result
        .into_iter()
        .map(|s| base_title(&s))
        .filter(|s| !s.is_empty() && seen.insert(s.clone()))
        .take(4)
        .collect())
}
async fn search_sources(
    pool: &SqlitePool,
    work: &str,
    query: Option<String>,
    fresh: bool,
) -> AppResult<SearchResult> {
    let names = titles(pool, work).await?;
    let automatic = query.is_none();
    let queries = match query {
        Some(q) if !q.trim().is_empty() && q.len() <= 300 => vec![q.trim().to_owned()],
        Some(_) => return Err(AppError::Validation("请输入 1–300 字符的作品名称".into())),
        None => names.clone(),
    };
    let mut result = SearchResult {
        candidates: Vec::new(),
        warnings: Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut succeeded = false;
    for query in queries.into_iter().take(3) {
        let r = match film_tv::request(pool, "search/tv", &[("query", query)], fresh).await {
            Ok(r) => {
                succeeded = true;
                r
            }
            Err(e) => {
                result.warnings.push(format!("TMDB 搜索失败：{e}"));
                continue;
            }
        };
        result.warnings.extend(r.warning);
        for row in r.data["results"].as_array().into_iter().flatten().take(10) {
            let Some(id) = row["id"].as_i64().filter(|id| *id > 0) else {
                continue;
            };
            if !seen.insert(id) {
                continue;
            }
            let title = row["name"].as_str().unwrap_or("");
            let original = row["original_name"].as_str().unwrap_or("");
            let confidence = names
                .iter()
                .flat_map(|a| {
                    [title, original].map(move |b| {
                        let a = crate::anime_parser::normalize_title(&base_title(a));
                        let b = crate::anime_parser::normalize_title(&base_title(b));
                        if a.is_empty() || b.is_empty() {
                            0.0
                        } else {
                            strsim::jaro_winkler(&a, &b)
                        }
                    })
                })
                .fold(0.0f64, f64::max);
            result.candidates.push(SeriesCandidate {
                series_id: id,
                title: title.into(),
                original_title: original.into(),
                air_date: row["first_air_date"].as_str().map(str::to_owned),
                confidence,
            });
        }
        if automatic && result.candidates.iter().any(|c| c.confidence >= 0.90) {
            break;
        }
    }
    if !succeeded && !result.warnings.is_empty() {
        return Err(AppError::Network(result.warnings.join("；")));
    }
    result
        .candidates
        .sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    result.candidates.truncate(20);
    Ok(result)
}
#[tauri::command]
pub async fn search_episode_artwork_sources(
    work_id: String,
    query: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<SearchResult> {
    search_sources(&state.pool, &work_id, query, false).await
}
#[tauri::command]
pub async fn list_episode_artwork_seasons(
    series_id: i64,
    state: State<'_, AppState>,
) -> AppResult<SeasonsResult> {
    if series_id <= 0 {
        return Err(AppError::Validation("请选择有效的 TMDB 作品".into()));
    }
    let r = film_tv::request(&state.pool, &format!("tv/{series_id}"), &[], false).await?;
    Ok(SeasonsResult {
        title: r.data["name"].as_str().unwrap_or("").into(),
        seasons: r.data["seasons"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| {
                let n = s["season_number"].as_i64()?;
                (1..=999).contains(&n).then(|| SeasonChoice {
                    season_number: n,
                    name: s["name"].as_str().unwrap_or("").into(),
                    episode_count: s["episode_count"].as_i64().unwrap_or(0),
                    air_date: s["air_date"].as_str().map(str::to_owned),
                })
            })
            .collect(),
        warnings: r.warning.into_iter().collect(),
    })
}
pub async fn refresh(pool: &SqlitePool, work: &str, fresh: bool) -> AppResult<Artwork> {
    let mut result = cached(pool, work).await?;
    let episodes = crate::metadata_aggregator::episodes_for_work(pool, work).await?;
    if let Some(mut s) = result.source.clone() {
        let mut usable = s.method != "verified";
        match film_tv::request(pool, &path(&s), &[], fresh).await {
            Ok(response) => {
                if let Some(w) = response.warning {
                    result.warnings.push(w);
                }
                if s.method == "verified" {
                    if let Some(offset) = alignment(&episodes, &response.data, s.season_number) {
                        s.episode_offset = offset;
                        save_source(pool, work, &s).await?;
                        usable = true;
                    } else {
                        result
                            .warnings
                            .push("原剧照对应无法核实，请重新选择来源或核对集号范围".into());
                    }
                } else if s.method == "manual"
                    && alignment(&episodes, &response.data, s.season_number)
                        .is_some_and(|offset| offset != s.episode_offset)
                {
                    result.warnings.push(
                        "现有手动集号对应与播出日期不一致，请重新预览核对；未自动改写人工选择"
                            .into(),
                    );
                }
            }
            Err(_) => {
                usable = true;
                result
                    .warnings
                    .push("TMDB 剧照更新失败，保留已有剧照与文件缩略图".into());
            }
        }
        if usable {
            let warnings = result.warnings;
            result = cached(pool, work).await?;
            result.warnings = warnings;
            if result.images.is_empty() && s.method == "verified" {
                result
                    .warnings
                    .push("已核实分集对应，但 TMDB 暂无可用剧照，使用文件缩略图".into());
            }
            return Ok(result);
        }
    }
    if !result.anchor.starts_with("bangumi:") {
        return Ok(result);
    }
    let token: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='metadata.tmdb_read_token'")
            .fetch_optional(pool)
            .await?;
    if !token.is_some_and(|s| !s.trim().is_empty()) {
        result
            .warnings
            .push("请配置 TMDB Read Access Token 后更新剧照".into());
        return Ok(result);
    }
    let accepted = accepted_series(pool, work, &result.anchor).await?;
    let indexed =
        crate::explore::linked_ids_for_bangumi(result.anchor.trim_start_matches("bangumi:"))?.tmdb;
    let linked = accepted
        .or(indexed)
        .and_then(|s| {
            s.strip_prefix("tv/")
                .and_then(|s| s.split('/').next())
                .and_then(|s| s.parse::<i64>().ok())
        })
        .filter(|n| *n > 0);
    let series = if let Some(id) = linked {
        vec![id]
    } else {
        match search_sources(pool, work, None, fresh).await {
            Ok(r) => {
                result.warnings.extend(r.warnings);
                r.candidates
                    .into_iter()
                    .filter(|c| c.confidence >= 0.90)
                    .take(3)
                    .map(|c| c.series_id)
                    .collect()
            }
            Err(_) => {
                result
                    .warnings
                    .push("TMDB 搜索暂不可用，可稍后重试或手动选择来源".into());
                return Ok(result);
            }
        }
    };
    let first_date = episodes
        .iter()
        .filter(|e| e.provider == "bangumi" && e.episode_type.unwrap_or(0) == 0)
        .filter_map(|e| date(e.air_date.as_deref()))
        .min();
    let mut verified = verify_series(
        pool,
        &series,
        &episodes,
        &result.anchor,
        first_date,
        fresh,
        &mut result.warnings,
    )
    .await?;
    if verified.is_empty() && linked.is_some() {
        match search_sources(pool, work, None, fresh).await {
            Ok(r) => {
                result.warnings.extend(r.warnings);
                let fallback: Vec<_> = r
                    .candidates
                    .into_iter()
                    .filter(|c| c.confidence >= 0.90 && Some(c.series_id) != linked)
                    .take(3)
                    .map(|c| c.series_id)
                    .collect();
                verified = verify_series(
                    pool,
                    &fallback,
                    &episodes,
                    &result.anchor,
                    first_date,
                    fresh,
                    &mut result.warnings,
                )
                .await?;
            }
            Err(_) => result
                .warnings
                .push("已关联来源无法对应，TMDB 搜索暂不可用，可手动选择来源".into()),
        }
    }
    if verified.len() == 1 {
        save_source(pool, work, &verified[0]).await?;
        let warnings = result.warnings;
        result = cached(pool, work).await?;
        result.warnings = warnings;
        if result.images.is_empty() {
            result
                .warnings
                .push("已核实分集对应，但 TMDB 暂无可用剧照，使用文件缩略图".into());
        }
    } else {
        result
            .warnings
            .push("未找到唯一且可核实的 TMDB 分集对应，请搜索来源并预览对应范围".into());
    }
    Ok(result)
}
async fn verify_series(
    pool: &SqlitePool,
    series: &[i64],
    episodes: &[AnimeEpisodeMetadata],
    current: &str,
    first_date: Option<NaiveDate>,
    fresh: bool,
    warnings: &mut Vec<String>,
) -> AppResult<Vec<Source>> {
    let mut verified = Vec::new();
    for &series_id in series {
        let tv = match film_tv::request(pool, &format!("tv/{series_id}"), &[], fresh).await {
            Ok(r) => r,
            Err(_) => {
                warnings.push("TMDB 剧照来源暂不可用，仍可使用文件缩略图".into());
                continue;
            }
        };
        warnings.extend(tv.warning);
        for n in relevant_seasons(&tv.data, first_date).into_iter().take(4) {
            let mut s = Source {
                anchor: current.to_owned(),
                series_id,
                season_number: n,
                method: "verified".into(),
                episode_offset: 0,
            };
            match film_tv::request(pool, &path(&s), &[], fresh).await {
                Ok(r) => {
                    warnings.extend(r.warning);
                    if let Some(offset) = alignment(&episodes, &r.data, n) {
                        s.episode_offset = offset;
                        verified.push(s);
                    }
                }
                Err(_) => warnings.push("TMDB 分集剧照更新失败，已有文件与关联保留".into()),
            }
        }
    }
    Ok(verified)
}
fn relevant_seasons(tv: &Value, first: Option<NaiveDate>) -> Vec<i64> {
    let mut seasons: Vec<_> = tv["seasons"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let n = s["season_number"].as_i64()?;
            (1..=999)
                .contains(&n)
                .then_some((n, date(s["air_date"].as_str())))
        })
        .collect();
    // Keep the nearest preceding premiere, including equally dated/undated
    // candidates so uncertain metadata cannot silently pick an arbitrary season.
    let latest = first.and_then(|first| {
        seasons
            .iter()
            .filter_map(|(_, d)| *d)
            .filter(|d| *d <= first + chrono::Duration::days(7))
            .max()
    });
    seasons.sort_by_key(|(_, d)| *d);
    seasons
        .iter()
        .filter(|(_, start)| {
            first.is_none_or(|first| {
                start.is_none_or(|start| {
                    start <= first + chrono::Duration::days(7)
                        && latest.is_none_or(|latest| start == latest)
                })
            })
        })
        .map(|(n, _)| *n)
        .collect()
}
async fn preview(
    pool: &SqlitePool,
    work: &str,
    series: i64,
    season: i64,
    offset: Option<i64>,
) -> AppResult<Artwork> {
    if series <= 0 || !(1..=999).contains(&season) {
        return Err(AppError::Validation(
            "请输入有效的 TMDB 电视剧 ID 和正片季数".into(),
        ));
    }
    let current = anchor(pool, work).await?;
    if !current.starts_with("bangumi:") {
        return Err(AppError::Validation(
            "只有 Bangumi 作品需要选择补充剧照来源".into(),
        ));
    }
    let tv = film_tv::request(pool, &format!("tv/{series}"), &[], false).await?;
    if tv.data["seasons"].as_array().is_some_and(|rows| {
        !rows
            .iter()
            .any(|r| r["season_number"].as_i64() == Some(season))
    }) {
        return Err(AppError::Validation(
            "该作品在 TMDB 没有此季度，请选择实际季度".into(),
        ));
    }
    let mut s = Source {
        anchor: current.clone(),
        series_id: series,
        season_number: season,
        method: "manual".into(),
        episode_offset: 0,
    };
    let data = film_tv::request(pool, &path(&s), &[], false).await?;
    let episodes = crate::metadata_aggregator::episodes_for_work(pool, work).await?;
    s.episode_offset = match offset {
        Some(n) if (-9999..=9999).contains(&n) => n,
        Some(_) => return Err(AppError::Validation("集号偏移超出范围".into())),
        None => alignment(&episodes, &data.data, season).ok_or_else(|| {
            AppError::Validation(
                "日期无法唯一对应，请填写集号偏移并核对逐集预览；0 表示同号对应".into(),
            )
        })?,
    };
    let images = mapped(&episodes, &data.data, &s);
    let correspondence = correspondence(&episodes, &data.data, &s);
    if correspondence.is_empty() {
        return Err(AppError::Validation(
            "该范围没有能对应的分集，请核对季度与偏移，未修改来源".into(),
        ));
    }
    let mut warnings: Vec<_> = tv.warning.into_iter().chain(data.warning).collect();
    if images.is_empty() {
        warnings.push("此范围暂无 TMDB 剧照，继续使用文件缩略图".into());
    }
    Ok(Artwork {
        anchor: current,
        source: Some(s),
        images,
        correspondence,
        warnings,
        source_title: tv.data["name"]
            .as_str()
            .map(|s| format!("{s} · 第 {season} 季")),
        ..Artwork::default()
    })
}
fn with_cache(
    mut artwork: Artwork,
    work: &str,
    state: &AppState,
    app: &AppHandle,
) -> AppResult<Artwork> {
    for (key, url) in &artwork.images {
        let p = crate::metadata_aggregator::artwork_cache_path(
            &state.cover_cache_path,
            work,
            "episode",
            url,
        );
        if p.is_file() {
            db::allow_cover_file(app, &p)?;
            artwork
                .cached_images
                .insert(key.clone(), p.to_string_lossy().into_owned());
        }
    }
    Ok(artwork)
}
#[tauri::command]
pub async fn get_episode_artwork(
    work_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Artwork> {
    with_cache(cached(&state.pool, &work_id).await?, &work_id, &state, &app)
}
#[tauri::command]
pub async fn refresh_episode_artwork(
    work_id: String,
    fresh: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Artwork> {
    with_cache(
        refresh(&state.pool, &work_id, fresh.unwrap_or(false)).await?,
        &work_id,
        &state,
        &app,
    )
}
#[tauri::command]
pub async fn preview_episode_artwork_source(
    work_id: String,
    series_id: i64,
    season_number: i64,
    episode_offset: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Artwork> {
    preview(
        &state.pool,
        &work_id,
        series_id,
        season_number,
        episode_offset,
    )
    .await
}
#[tauri::command]
pub async fn set_episode_artwork_source(
    work_id: String,
    series_id: i64,
    season_number: i64,
    expected_anchor: String,
    episode_offset: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Artwork> {
    let r = preview(
        &state.pool,
        &work_id,
        series_id,
        season_number,
        episode_offset,
    )
    .await?;
    if r.anchor != expected_anchor {
        return Err(AppError::Validation(
            "作品已重新识别，请重新核对预览".into(),
        ));
    }
    save_source(&state.pool, &work_id, r.source.as_ref().unwrap()).await?;
    Ok(r)
}
#[tauri::command]
pub async fn cache_episode_artwork(
    work_id: String,
    episode_key: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    let r = cached(&state.pool, &work_id).await?;
    let Some(url) = r.images.get(&episode_key) else {
        return Ok(None);
    };
    let destination = crate::metadata_aggregator::artwork_cache_path(
        &state.cover_cache_path,
        &work_id,
        "episode",
        url,
    );
    static LIMIT: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    if !destination.is_file() {
        let Ok(_permit) = tokio::time::timeout(
            std::time::Duration::from_secs(25),
            LIMIT
                .get_or_init(|| tokio::sync::Semaphore::new(2))
                .acquire(),
        )
        .await
        else {
            return Ok(None);
        };
        if !destination.is_file()
            && crate::metadata_aggregator::cache_banner(url, &destination)
                .await
                .is_err()
        {
            return Ok(None);
        }
    }
    db::allow_cover_file(&app, Path::new(&destination))?;
    Ok(Some(destination.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn ep(id: &str, n: u32, day: &str, kind: u32) -> AnimeEpisodeMetadata {
        AnimeEpisodeMetadata {
            provider: "bangumi".into(),
            external_id: id.into(),
            episode_number: Some(n),
            sort_number: n,
            episode_type: Some(kind),
            title: "官方名称".into(),
            original_title: None,
            description: String::new(),
            air_date: Some(day.into()),
            duration: None,
            fetched_at: "t".into(),
        }
    }
    fn data(season: i64, day: &str) -> Value {
        json!({"name":"季度", "episodes":[{"episode_number":1,"season_number":season,"air_date":day,"still_path":"/frame.jpg"},{"episode_number":2,"season_number":season,"air_date":"2024-01-08","still_path":null}]})
    }
    fn binding(season: i64, method: &str) -> Source {
        Source {
            anchor: "bangumi:987654321".into(),
            series_id: 42,
            season_number: season,
            method: method.into(),
            episode_offset: 0,
        }
    }
    fn meta(provider: &str, id: &str, title: &str) -> Value {
        json!({"provider":provider,"externalId":id,"title":title,"originalTitle":null,"aliases":[],"description":"","coverUrl":null,"bannerUrl":null,"year":2024,"season":1,"subjectType":"tv","genres":[],"fetchedAt":"t"})
    }
    async fn put_cache(pool: &SqlitePool, endpoint: &str, data: &Value, expiry: &str) {
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?, 't',?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,expires_at=excluded.expires_at")
            .bind(format!("film-tv:zh-CN:{endpoint}:[]")).bind(data.to_string()).bind(expiry).execute(pool).await.unwrap();
    }
    async fn fixture() -> SqlitePool {
        let pool = db::test_pool().await.unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','官方作品','video','t','t');
            INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('w','bangumi','987654321','t','t');
            INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,air_date,fetched_at) VALUES('w','bangumi','ep1',1,1,0,'官方名称','2024-01-01','t'),('w','bangumi','ep2',2,2,0,'第二集','2024-01-08','t');
            INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES('art-f','w','X:/fixture/01.mkv','01.mkv','mkv','video','t','t');
            INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES('art-f','w','bangumi','ep1','manual',1,'t');
            INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('art-f',12345,200000,'t');").execute(&pool).await.unwrap();
        pool
    }
    fn combined() -> Value {
        json!({"id":100,"episodes":[
            {"id":1,"season_number":1,"episode_number":1,"air_date":"2023-04-01","still_path":"/s1.jpg"},
            {"id":2,"season_number":1,"episode_number":2,"air_date":"2023-04-08","still_path":"/s2.jpg"},
            {"id":13,"season_number":1,"episode_number":13,"air_date":"2024-01-01","still_path":"/s13.jpg"},
            {"id":14,"season_number":1,"episode_number":14,"air_date":"2024-01-08","still_path":"/s14.jpg"},
            {"id":15,"season_number":1,"episode_number":15,"air_date":"2024-01-15","still_path":"/s15.jpg"}
        ]})
    }
    #[test]
    fn split_cours_and_absolute_numbers_match_by_dates_without_fixed_lengths() {
        let local = vec![ep("a", 1, "2024-01-01", 0), ep("b", 2, "2024-01-08", 0)];
        assert_eq!(alignment(&local, &combined(), 1), Some(12));
        let mut s = binding(1, "verified");
        s.episode_offset = 12;
        assert!(mapped(&local, &combined(), &s)["bangumi:a"].ends_with("/s13.jpg"));
        let first = vec![ep("a", 1, "2023-04-01", 0), ep("b", 2, "2023-04-08", 0)];
        assert_eq!(alignment(&first, &combined(), 1), Some(0));
        let absolute = vec![ep("a", 13, "2024-01-01", 0), ep("b", 14, "2024-01-08", 0)];
        assert_eq!(alignment(&absolute, &data(2, "2024-01-01"), 2), Some(-12));
        let tv = json!({"seasons":[{"season_number":1,"air_date":"2023-04-01"}]});
        assert_eq!(relevant_seasons(&tv, date(Some("2024-01-01"))), vec![1]);
    }
    #[test]
    fn ambiguous_dates_missing_dates_and_duplicate_numbers_require_confirmation() {
        let local = vec![ep("a", 1, "2024-01-01", 0), ep("b", 2, "2024-01-08", 0)];
        let mut d = combined();
        let mut a = d["episodes"][2].clone();
        a["episode_number"] = json!(30);
        let mut b = d["episodes"][3].clone();
        b["episode_number"] = json!(31);
        d["episodes"].as_array_mut().unwrap().extend([a, b]);
        assert_eq!(alignment(&local, &d, 1), None);
        let mut missing = local.clone();
        missing[1].air_date = None;
        assert_eq!(alignment(&missing, &combined(), 1), None);
        missing[1].episode_number = Some(1);
        assert_eq!(alignment(&missing, &combined(), 1), None);
        assert_eq!(base_title("我心里危险的东西 第二季"), "我心里危险的东西");
        assert_eq!(
            base_title("The Dangers in My Heart 2nd Season"),
            "The Dangers in My Heart"
        );
        assert_eq!(base_title("86"), "86");
        assert_eq!(base_title("僕の心のヤバイやつ 第2期"), "僕の心のヤバイやつ");
    }
    #[test]
    fn undated_future_episode_does_not_block_verified_aired_stills() {
        let mut local = vec![
            ep("a", 1, "2024-01-01", 0),
            ep("b", 2, "2024-01-08", 0),
            ep("future", 3, "", 0),
        ];
        local[2].air_date = None;
        assert_eq!(alignment(&local, &combined(), 1), Some(12));
        let mut s = binding(1, "verified");
        s.episode_offset = 12;
        let images = mapped(&local, &combined(), &s);
        assert_eq!(images.len(), 2);
        assert!(!images.contains_key("bangumi:future"));
    }
    #[tokio::test]
    async fn search_without_existing_tmdb_link_finds_combined_season_and_keeps_user_data() {
        let pool = fixture().await;
        sqlx::query("UPDATE works SET title='测试作品 第二季' WHERE id='w'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('metadata.tmdb_read_token','fixture-only','t')").execute(&pool).await.unwrap();
        let key = format!(
            "film-tv:zh-CN:search/tv:{}",
            serde_json::to_string(&[("query", "测试作品")]).unwrap()
        );
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?, 't','2099')").bind(key).bind(json!({"results":[{"id":42,"name":"测试作品","original_name":"Test","first_air_date":"2023-04-01"}]}).to_string()).execute(&pool).await.unwrap();
        put_cache(&pool,"tv/42",&json!({"id":42,"name":"测试作品","seasons":[{"season_number":1,"air_date":"2023-04-01","episode_count":25}]}),"2099").await;
        put_cache(&pool, "tv/42/season/1", &combined(), "2099").await;
        let result = refresh(&pool, "w", false).await.unwrap();
        assert_eq!(result.source.unwrap().episode_offset, 12);
        assert!(result.images["bangumi:ep1"].ends_with("/s13.jpg"));
        let link: String = sqlx::query_scalar(
            "SELECT episode_external_id FROM media_episode_links WHERE media_file_id='art-f'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(link, "ep1");
        let position: i64 = sqlx::query_scalar(
            "SELECT position_ms FROM playback_progress WHERE media_file_id='art-f'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(position, 12345);
        assert_eq!(anchor(&pool, "w").await.unwrap(), "bangumi:987654321");
    }
    #[tokio::test]
    async fn old_verified_binding_repairs_offset_and_manual_preview_shows_correspondence() {
        let pool = fixture().await;
        put_cache(
            &pool,
            "tv/42",
            &json!({"id":42,"name":"测试作品","seasons":[{"season_number":1}]}),
            "2099",
        )
        .await;
        put_cache(&pool, "tv/42/season/1", &combined(), "2099").await;
        save_source(&pool, "w", &binding(1, "verified"))
            .await
            .unwrap();
        let r = refresh(&pool, "w", false).await.unwrap();
        assert_eq!(r.source.unwrap().episode_offset, 12);
        let r = preview(&pool, "w", 42, 1, None).await.unwrap();
        assert_eq!(r.correspondence[0].tmdb_number, 13);
        assert!(preview(&pool, "w", 42, 2, Some(0)).await.is_err());
        sqlx::query("UPDATE anime_episodes SET air_date=NULL WHERE work_id='w'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(preview(&pool, "w", 42, 1, None).await.is_err());
        let r = preview(&pool, "w", 42, 1, Some(12)).await.unwrap();
        assert_eq!(r.correspondence[1].tmdb_number, 14);
        save_source(&pool, "w", r.source.as_ref().unwrap())
            .await
            .unwrap();
        assert_eq!(
            cached(&pool, "w")
                .await
                .unwrap()
                .source
                .unwrap()
                .episode_offset,
            12
        );
    }
    #[tokio::test]
    async fn invalid_linked_source_falls_back_to_search_and_manual_choice_is_not_overwritten() {
        let pool = fixture().await;
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('metadata.tmdb_read_token','fixture-only','t')").execute(&pool).await.unwrap();
        for (provider, id) in [("bangumi", "987654321"), ("tmdb", "tv/42")] {
            sqlx::query("INSERT INTO metadata_provider_records(work_id,provider,external_id,title,confidence,response_json,fetched_at) VALUES('w',?,?,'官方作品',0.9,?,'t')").bind(provider).bind(id).bind(meta(provider,id,"官方作品").to_string()).execute(&pool).await.unwrap();
        }
        put_cache(
            &pool,
            "tv/42",
            &json!({"id":42,"seasons":[{"season_number":1,"air_date":"2023-01-01"}]}),
            "2099",
        )
        .await;
        put_cache(&pool, "tv/42/season/1", &data(1, "2023-01-01"), "2099").await;
        let key = format!(
            "film-tv:zh-CN:search/tv:{}",
            serde_json::to_string(&[("query", "官方作品")]).unwrap()
        );
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?, 't','2099')").bind(key).bind(json!({"results":[{"id":43,"name":"官方作品"}]}).to_string()).execute(&pool).await.unwrap();
        put_cache(
            &pool,
            "tv/43",
            &json!({"id":43,"seasons":[{"season_number":1,"air_date":"2023-04-01"}]}),
            "2099",
        )
        .await;
        put_cache(&pool, "tv/43/season/1", &combined(), "2099").await;
        let r = refresh(&pool, "w", false).await.unwrap();
        assert_eq!(r.source.unwrap().series_id, 43);
        let mut manual = binding(1, "manual");
        manual.series_id = 43;
        save_source(&pool, "w", &manual).await.unwrap();
        let r = refresh(&pool, "w", false).await.unwrap();
        assert_eq!(r.source.unwrap().episode_offset, 0);
        assert!(r.warnings.iter().any(|w| w.contains("人工选择")));
    }
    #[tokio::test]
    async fn upgrade_from_18_keeps_manual_binding_and_adds_zero_offset() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut migrator = sqlx::migrate!("./migrations");
        migrator.migrations.to_mut().retain(|m| m.version <= 18);
        migrator.run(&pool).await.unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','保留','video','t','t'); INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('w','bangumi','987654321','t','t'); INSERT INTO episode_artwork_sources(work_id,anchor,series_id,season_number,method,updated_at) VALUES('w','bangumi:987654321',42,1,'manual','t');").execute(&pool).await.unwrap();
        let before: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let after: Vec<(i64, Vec<u8>)> = sqlx::query_as(
            "SELECT version,checksum FROM _sqlx_migrations WHERE version<=18 ORDER BY version",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(before, after);
        let s = source(&pool, "w", "bangumi:987654321")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(s.method, "manual");
        assert_eq!(s.episode_offset, 0);
        assert_eq!(s.series_id, 42);
    }
    #[test]
    fn verified_dates_numbers_and_missing_stills() {
        let episodes = vec![
            ep("ep1", 1, "2024-01-01", 0),
            ep("ep2", 2, "2024-01-08", 0),
            ep("op", 1, "2024-01-01", 2),
        ];
        assert!(verifies(&episodes, &data(2, "2024-01-01"), 2));
        let images = mapped(&episodes, &data(2, "2024-01-01"), &binding(2, "verified"));
        assert_eq!(images.len(), 1);
        assert!(images.contains_key("bangumi:ep1"));
        assert!(mapped(&episodes, &data(2, "2023-01-01"), &binding(2, "verified")).is_empty());
        assert!(!verifies(&episodes, &data(1, "2024-01-01"), 2));
        assert!(!verifies(&episodes, &data(2, "2023-01-01"), 2));
    }
    #[test]
    fn ambiguous_specials_duplicates_and_absolute_numbers_are_not_guessed() {
        let mut eps = vec![ep("a", 1, "2024-01-01", 0), ep("b", 2, "2024-01-08", 0)];
        eps.push(ep("dupe", 1, "2024-01-01", 0));
        assert!(!verifies(&eps, &data(2, "2024-01-01"), 2));
        assert!(mapped(&eps, &data(2, "2024-01-01"), &binding(2, "manual")).is_empty());
        let mut d = data(2, "2024-01-01");
        let duplicate = d["episodes"][0].clone();
        d["episodes"].as_array_mut().unwrap().push(duplicate);
        assert!(mapped(&eps[..2], &d, &binding(2, "manual")).is_empty());
        assert!(mapped(
            &[
                ep("oad", 1, "2024-01-01", 1),
                ep("absolute", 13, "2024-01-01", 0)
            ],
            &data(2, "2024-01-01"),
            &binding(2, "manual")
        )
        .is_empty());
        assert!(still(&json!({"still_path":"//evil/a.jpg"})).is_none());
        assert!(still(&json!({"still_path":"/../a.jpg"})).is_none());
    }
    #[tokio::test]
    async fn automatic_season_is_chosen_by_dates_not_bangumi_season_ordinal() {
        let pool = fixture().await;
        sqlx::raw_sql("INSERT INTO app_settings(key,value,updated_at) VALUES('metadata.tmdb_read_token','fixture-only','t');").execute(&pool).await.unwrap();
        for (provider, id) in [("bangumi", "987654321"), ("tmdb", "tv/42")] {
            sqlx::query("INSERT INTO metadata_provider_records(work_id,provider,external_id,title,confidence,response_json,fetched_at) VALUES('w',?,?,'官方作品',0.9,?,'t')").bind(provider).bind(id).bind(meta(provider,id,"官方作品").to_string()).execute(&pool).await.unwrap();
        }
        put_cache(&pool,"tv/42",&json!({"id":42,"seasons":[{"season_number":1,"air_date":"2023-01-01"},{"season_number":4,"air_date":"2024-01-01"}]}),"2099").await;
        put_cache(&pool, "tv/42/season/4", &data(4, "2024-01-01"), "2099").await;
        let r = refresh(&pool, "w", false).await.unwrap();
        assert_eq!(r.source.unwrap().season_number, 4);
        assert_eq!(r.images.len(), 1);
        let title: String = sqlx::query_scalar("SELECT title FROM works WHERE id='w'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(title, "官方作品");
        let link: String = sqlx::query_scalar(
            "SELECT episode_external_id FROM media_episode_links WHERE media_file_id='art-f'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(link, "ep1");
        let position: i64 = sqlx::query_scalar(
            "SELECT position_ms FROM playback_progress WHERE media_file_id='art-f'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(position, 12345);
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM anime_episodes WHERE work_id='w'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 2);
    }
    #[tokio::test]
    async fn offline_cache_and_manual_choice_survive_refresh_and_rematching() {
        let pool = fixture().await;
        let manual = binding(2, "manual");
        save_source(&pool, "w", &manual).await.unwrap();
        put_cache(&pool, &path(&manual), &data(2, "2023-01-01"), "2000").await;
        let r = refresh(&pool, "w", true).await.unwrap(); // No credential => stale cache, no network.
        assert_eq!(r.images.len(), 1);
        assert!(!r.warnings.is_empty());
        save_source(&pool, "w", &binding(4, "verified"))
            .await
            .unwrap();
        assert_eq!(
            cached(&pool, "w")
                .await
                .unwrap()
                .source
                .unwrap()
                .season_number,
            2
        );
        sqlx::query("UPDATE work_external_ids SET external_id='new' WHERE work_id='w'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(cached(&pool, "w").await.unwrap().images.is_empty());
        assert!(save_source(&pool, "w", &manual).await.is_err());
    }

    #[tokio::test]
    async fn stale_supplement_record_does_not_validate_a_different_primary() {
        let pool = fixture().await;
        for (provider, id) in [("bangumi", "987654321"), ("tmdb", "tv/42")] {
            sqlx::query("INSERT INTO metadata_provider_records(work_id,provider,external_id,title,confidence,response_json,fetched_at) VALUES('w',?,?,'Title',0.9,?,'t')").bind(provider).bind(id).bind(meta(provider,id,"Title").to_string()).execute(&pool).await.unwrap();
        }
        assert_eq!(
            accepted_series(&pool, "w", "bangumi:987654321")
                .await
                .unwrap(),
            Some("tv/42".into())
        );
        sqlx::query("UPDATE metadata_provider_records SET response_json=? WHERE work_id='w' AND provider='bangumi'").bind(meta("bangumi","987654321","Completely unrelated").to_string()).execute(&pool).await.unwrap();
        assert!(accepted_series(&pool, "w", "bangumi:987654321")
            .await
            .unwrap()
            .is_none());
        assert!(accepted_series(&pool, "w", "bangumi:new")
            .await
            .unwrap()
            .is_none());
    }
    #[tokio::test]
    async fn preview_is_read_only_and_keeps_primary_provider() {
        let pool = fixture().await;
        put_cache(&pool, "tv/42", &json!({"id":42,"name":"补源作品"}), "2099").await;
        put_cache(&pool, "tv/42/season/2", &data(2, "2023-01-01"), "2099").await;
        let r = preview(&pool, "w", 42, 2, Some(0)).await.unwrap();
        assert_eq!(r.images.len(), 1);
        assert!(cached(&pool, "w").await.unwrap().source.is_none());
        assert!(preview(&pool, "w", 42, 0, None).await.is_err());
        save_source(&pool, "w", r.source.as_ref().unwrap())
            .await
            .unwrap();
        assert_eq!(anchor(&pool, "w").await.unwrap(), "bangumi:987654321");
    }
    #[tokio::test]
    async fn primary_tmdb_episode_artwork_needs_no_supplement_binding() {
        let pool = fixture().await;
        sqlx::query("DELETE FROM media_episode_links")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE work_external_ids SET provider='tmdb',external_id='tv/42/season/2' WHERE work_id='w'").execute(&pool).await.unwrap();
        sqlx::query("UPDATE anime_episodes SET provider='tmdb' WHERE work_id='w'")
            .execute(&pool)
            .await
            .unwrap();
        put_cache(&pool, "tv/42/season/2", &data(2, "2023-01-01"), "2099").await;
        let r = cached(&pool, "w").await.unwrap();
        assert_eq!(r.images.len(), 1);
        assert!(r.images.contains_key("tmdb:ep1"));
    }
    #[tokio::test]
    async fn upgrade_from_17_keeps_user_data_and_historical_checksums() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut migrator = sqlx::migrate!("./migrations");
        migrator.migrations.to_mut().retain(|m| m.version <= 17);
        migrator.run(&pool).await.unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','保留','video','t','t'); INSERT INTO app_settings(key,value,updated_at) VALUES('fixture','keep','t');").execute(&pool).await.unwrap();
        let before: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let after: Vec<(i64, Vec<u8>)> = sqlx::query_as(
            "SELECT version,checksum FROM _sqlx_migrations WHERE version<=17 ORDER BY version",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(before, after);
        let title: String = sqlx::query_scalar("SELECT title FROM works WHERE id='w'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(title, "保留");
        save_source(&pool, "missing", &binding(2, "manual"))
            .await
            .unwrap_err();
    }
}
