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
        || !p.ends_with(".jpg")
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
                v["episode_number"].as_u64() == Some(u64::from(n))
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
fn verifies(episodes: &[AnimeEpisodeMetadata], data: &Value, season: i64) -> bool {
    let main: Vec<_> = episodes
        .iter()
        .filter(|e| e.provider == "bangumi" && e.episode_type.unwrap_or(0) == 0)
        .collect();
    let Some(rows) = data["episodes"].as_array() else {
        return false;
    };
    if main.is_empty() || rows.len() != main.len() {
        return false;
    }
    let mut numbers = HashSet::new();
    main.iter().all(|e| {
        let Some(n) = e.episode_number.filter(|n| *n > 0) else {
            return false;
        };
        if !numbers.insert(n) {
            return false;
        }
        let matching: Vec<_> = rows
            .iter()
            .filter(|r| {
                r["episode_number"].as_u64() == Some(u64::from(n))
                    && r["season_number"].as_i64() == Some(season)
            })
            .collect();
        matching.len() == 1 && close_dates(e.air_date.as_deref(), matching[0]["air_date"].as_str())
    })
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
                }));
            }
        }
        return Ok(None);
    }
    Ok(sqlx::query_as::<_, Source>("SELECT anchor,series_id,season_number,method FROM episode_artwork_sources WHERE work_id=? AND anchor=?")
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
    sqlx::query("INSERT INTO episode_artwork_sources(work_id,anchor,series_id,season_number,method,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET anchor=excluded.anchor,series_id=excluded.series_id,season_number=excluded.season_number,method=excluded.method,updated_at=excluded.updated_at WHERE episode_artwork_sources.anchor != excluded.anchor OR episode_artwork_sources.method != 'manual' OR excluded.method = 'manual'")
        .bind(work).bind(&s.anchor).bind(s.series_id).bind(s.season_number).bind(&s.method).bind(Utc::now().to_rfc3339()).execute(&mut *tx).await?;
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
pub async fn refresh(pool: &SqlitePool, work: &str, fresh: bool) -> AppResult<Artwork> {
    let mut result = cached(pool, work).await?;
    if let Some(s) = &result.source {
        match film_tv::request(pool, &path(s), &[], fresh).await {
            Ok(response) => {
                if let Some(w) = response.warning {
                    result.warnings.push(w);
                }
            }
            Err(_) => result
                .warnings
                .push("TMDB 剧照更新失败，保留已有剧照与文件缩略图".into()),
        }
        let warnings = result.warnings;
        result = cached(pool, work).await?;
        result.warnings = warnings;
        return Ok(result);
    }
    if !result.anchor.starts_with("bangumi:") {
        return Ok(result);
    }
    let token: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='metadata.tmdb_read_token'")
            .fetch_optional(pool)
            .await?;
    if !token.is_some_and(|s| !s.trim().is_empty()) {
        return Ok(result);
    }
    let episodes = crate::metadata_aggregator::episodes_for_work(pool, work).await?;
    let first = episodes
        .iter()
        .filter(|e| {
            e.provider == "bangumi"
                && e.episode_type.unwrap_or(0) == 0
                && e.episode_number == Some(1)
        })
        .collect::<Vec<_>>();
    if first.len() != 1 || date(first[0].air_date.as_deref()).is_none() {
        return Ok(result);
    }
    let accepted = accepted_series(pool, work, &result.anchor).await?;
    let indexed =
        crate::explore::linked_ids_for_bangumi(result.anchor.trim_start_matches("bangumi:"))?.tmdb;
    let Some(series) = accepted
        .or(indexed)
        .and_then(|s| {
            s.strip_prefix("tv/")
                .and_then(|s| s.split('/').next())
                .and_then(|s| s.parse::<i64>().ok())
        })
        .filter(|n| *n > 0)
    else {
        return Ok(result);
    };
    let tv = match film_tv::request(pool, &format!("tv/{series}"), &[], fresh).await {
        Ok(r) => r,
        Err(_) => {
            result
                .warnings
                .push("TMDB 剧照来源暂不可用，仍可使用文件缩略图".into());
            return Ok(result);
        }
    };
    if let Some(w) = tv.warning {
        result.warnings.push(w);
    }
    let candidates: Vec<_> = tv.data["seasons"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| {
            let n = v["season_number"].as_i64()?;
            ((1..=999).contains(&n)
                && close_dates(first[0].air_date.as_deref(), v["air_date"].as_str()))
            .then_some(n)
        })
        .collect();
    let mut verified = Vec::new();
    for n in candidates.into_iter().take(5) {
        let s = Source {
            anchor: result.anchor.clone(),
            series_id: series,
            season_number: n,
            method: "verified".into(),
        };
        match film_tv::request(pool, &path(&s), &[], fresh).await {
            Ok(r) => {
                if let Some(w) = r.warning {
                    result.warnings.push(w);
                }
                if verifies(&episodes, &r.data, n) {
                    verified.push(s);
                }
            }
            Err(_) => result
                .warnings
                .push("TMDB 分集剧照更新失败，已有文件与关联保留".into()),
        }
    }
    if verified.len() == 1 {
        save_source(pool, work, &verified[0]).await?;
        let warnings = result.warnings;
        result = cached(pool, work).await?;
        result.warnings = warnings;
    } else {
        result
            .warnings
            .push("未找到可核实的 TMDB 季度，可手动选择分集剧照来源".into());
    }
    Ok(result)
}
async fn preview(pool: &SqlitePool, work: &str, series: i64, season: i64) -> AppResult<Artwork> {
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
    let s = Source {
        anchor: current.clone(),
        series_id: series,
        season_number: season,
        method: "manual".into(),
    };
    let data = film_tv::request(pool, &path(&s), &[], false).await?;
    let episodes = crate::metadata_aggregator::episodes_for_work(pool, work).await?;
    let images = mapped(&episodes, &data.data, &s);
    if images.is_empty() {
        return Err(AppError::Validation(
            "该季度没有能按唯一集号对应的剧照，未修改来源".into(),
        ));
    }
    Ok(Artwork {
        anchor: current,
        source: Some(s),
        images,
        warnings: tv.warning.into_iter().chain(data.warning).collect(),
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
    state: State<'_, AppState>,
) -> AppResult<Artwork> {
    preview(&state.pool, &work_id, series_id, season_number).await
}
#[tauri::command]
pub async fn set_episode_artwork_source(
    work_id: String,
    series_id: i64,
    season_number: i64,
    expected_anchor: String,
    state: State<'_, AppState>,
) -> AppResult<Artwork> {
    let r = preview(&state.pool, &work_id, series_id, season_number).await?;
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
        let r = preview(&pool, "w", 42, 2).await.unwrap();
        assert_eq!(r.images.len(), 1);
        assert!(cached(&pool, "w").await.unwrap().source.is_none());
        assert!(preview(&pool, "w", 42, 0).await.is_err());
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
