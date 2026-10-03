// Catalog request conventions researched from caolib/kira (MIT), see THIRD_PARTY_NOTICES.md.
// Only public work metadata is consumed here; chapter contents are not requested.
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::models::WorkMetadata;
use chrono::{Duration as ChronoDuration, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

const PROVIDER: &str = "copymanga";
const CATALOG_HOST: &str = "https://api.copy202601.com";
const DETAIL_HOST: &str = "https://mapi.hotmangasg.com";
const PAGE_SIZE: u32 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicItem {
    path_word: String,
    title: String,
    cover_url: Option<String>,
    #[serde(default)]
    cached_cover_path: Option<String>,
    #[serde(default)]
    cached_cover_thumbnail_path: Option<String>,
    authors: Vec<String>,
    tags: Vec<String>,
    summary: String,
    status: String,
    updated_at: String,
    latest_chapter: String,
    local_work_id: Option<String>,
    favorite: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicPage {
    items: Vec<ComicItem>,
    total: u64,
    page: u32,
    stale: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicDetail {
    item: ComicItem,
    aliases: Vec<String>,
    chapter_count: Option<u64>,
    stale: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicTheme {
    name: String,
    path_word: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicQuery {
    query: String,
    theme: String,
    top: String,
    sort: String,
    page: u32,
}

pub(super) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200
        && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn invalid_data() -> AppError {
    AppError::Network("漫画来源没有返回有效作品资料，请稍后重试".into())
}

fn names(value: &Value, key: &str) -> Vec<String> {
    value[key].as_array().into_iter().flatten()
        .filter_map(|item| item["name"].as_str().filter(|name| !name.trim().is_empty()).map(str::to_string))
        .collect()
}

fn parse_item(value: &Value) -> AppResult<ComicItem> {
    let path_word = value["path_word"].as_str().filter(|id| valid_id(id)).ok_or_else(invalid_data)?;
    let title = value["name"].as_str().filter(|title| !title.trim().is_empty()).ok_or_else(invalid_data)?;
    let cover_url = value["cover"].as_str().filter(|url| {
        reqwest::Url::parse(url).is_ok_and(|url| url.scheme() == "https"
            && url.host_str().is_some_and(|host| host.ends_with(".mangafunb.fun")))
    }).map(str::to_string);
    Ok(ComicItem {
        path_word: path_word.into(), title: title.into(), cover_url,
        cached_cover_path: None, cached_cover_thumbnail_path: None,
        authors: names(value, "author"), tags: names(value, "theme"),
        summary: value["brief"].as_str().unwrap_or_default().into(),
        status: value["status"]["display"].as_str().unwrap_or_default().into(),
        updated_at: value["datetime_updated"].as_str().unwrap_or_default().into(),
        latest_chapter: value["last_chapter"]["name"].as_str()
            .or_else(|| value["last_chapter_name"].as_str()).unwrap_or_default().into(),
        local_work_id: None, favorite: false,
    })
}

fn parse_list(value: Value) -> AppResult<ComicPage> {
    let list = value["list"].as_array().ok_or_else(invalid_data)?;
    let items = list.iter().map(parse_item).collect::<AppResult<Vec<_>>>()?;
    let total = value["total"].as_u64().ok_or_else(invalid_data)?;
    Ok(ComicPage { items, total, page: 1, stale: false })
}

fn parse_detail(value: Value) -> AppResult<ComicDetail> {
    let item = parse_item(&value["comic"])?;
    let aliases = value["comic"]["alias"].as_str().unwrap_or_default()
        .split(',').map(str::trim).filter(|alias| !alias.is_empty()).map(str::to_string).collect();
    // Groups contain counts only. Do not fetch chapters or image URLs.
    let chapter_count = value["groups"].as_object().and_then(|groups| {
        groups.values().map(|group| group["count"].as_u64()).collect::<Option<Vec<_>>>()
            .and_then(|counts| counts.into_iter().try_fold(0u64, |sum, count| sum.checked_add(count)))
    });
    Ok(ComicDetail { item, aliases, chapter_count, stale: false })
}

fn parse_themes(value: Value) -> AppResult<Vec<ComicTheme>> {
    value["theme"].as_array().ok_or_else(invalid_data)?.iter().map(|tag| {
        Ok(ComicTheme {
            name: tag["name"].as_str().filter(|name| !name.is_empty()).ok_or_else(invalid_data)?.into(),
            path_word: tag["path_word"].as_str().filter(|id| valid_id(id)).ok_or_else(invalid_data)?.into(),
        })
    }).collect()
}

fn query_params(input: &ComicQuery) -> AppResult<(&'static str, Vec<(String, String)>)> {
    if !(1..=10_000).contains(&input.page) || input.query.chars().count() > 200
        || !matches!(input.sort.as_str(), "popular" | "updated")
        || !matches!(input.top.as_str(), "" | "finish" | "korea" | "west")
        || (!input.theme.is_empty() && !valid_id(&input.theme)) {
        return Err(AppError::Validation("漫画搜索或筛选参数无效".into()));
    }
    let mut params = vec![
        ("platform".into(), "3".into()), ("free_type".into(), "1".into()),
        ("limit".into(), PAGE_SIZE.to_string()), ("offset".into(), ((input.page - 1) * PAGE_SIZE).to_string()),
    ];
    if !input.query.trim().is_empty() {
        if !input.theme.is_empty() || !input.top.is_empty() {
            return Err(AppError::Validation("搜索时请先清除目录筛选".into()));
        }
        params.push(("q".into(), input.query.trim().into()));
        Ok(("/api/v3/search/comic", params))
    } else {
        params.push(("ordering".into(), if input.sort == "updated" { "-datetime_updated" } else { "-popular" }.into()));
        if !input.theme.is_empty() { params.push(("theme".into(), input.theme.clone())); }
        if !input.top.is_empty() { params.push(("top".into(), input.top.clone())); }
        Ok(("/api/v3/comics", params))
    }
}

async fn request(host: &str, path: &str, params: &[(String, String)]) -> AppResult<Value> {
    let detail = host == DETAIL_HOST;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15))
        .build().map_err(|error| AppError::Network(error.to_string()))?;
    let response = client.get(format!("{host}{path}")).query(params)
        .header("Accept", "application/json").header("platform", "3")
        .header("source", "copyApp")
        .header("version", if detail { "2024.04.28" } else { "3.0.9" })
        .header("User-Agent", if detail { "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.6778.200 Mobile Safari/537.36" } else { "COPY/3.0.9" })
        .header("webp", "1").header("X-Requested-With", "com.manga2020.app")
        .send().await.map_err(|error| AppError::Network(format!("漫画来源连接失败：{error}")))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!("漫画来源暂时不可用（HTTP {}）", response.status().as_u16())));
    }
    let value: Value = response.json().await.map_err(|_| invalid_data())?;
    if value["code"].as_i64() != Some(200) || !value["results"].is_object() { return Err(invalid_data()); }
    Ok(value["results"].clone())
}

async fn cached_request<T: Serialize + DeserializeOwned>(
    pool: &SqlitePool, host: &str, path: &str, params: &[(String, String)],
    hours: i64, refresh: bool, parse: impl FnOnce(Value) -> AppResult<T>,
) -> AppResult<(T, bool)> {
    let key = format!("v1:{host}{path}:{}", serde_json::to_string(params)?);
    let cached: Option<(String, String)> = sqlx::query_as(
        "SELECT response_json, expires_at FROM metadata_cache WHERE provider = ? AND cache_key = ?")
        .bind(PROVIDER).bind(&key).fetch_optional(pool).await?;
    let cached = cached.and_then(|(json, expiry)| serde_json::from_str::<T>(&json).ok().map(|data| (data, expiry)));
    let now = Utc::now();
    if !refresh && cached.as_ref().is_some_and(|(_, expiry)| chrono::DateTime::parse_from_rfc3339(expiry).is_ok_and(|expiry| expiry > now)) {
        return Ok((cached.unwrap().0, false));
    }
    match request(host, path, params).await.and_then(parse) {
        Ok(data) => {
            sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
                .bind(PROVIDER).bind(&key).bind(serde_json::to_string(&data)?).bind(now.to_rfc3339())
                .bind((now + ChronoDuration::hours(hours)).to_rfc3339()).execute(pool).await?;
            Ok((data, false))
        }
        Err(error) => cached.map(|(data, _)| (data, true)).ok_or(error),
    }
}

async fn local_states(pool: &SqlitePool, items: &mut [ComicItem]) -> AppResult<()> {
    let rows: Vec<(String, String, bool)> = sqlx::query_as("SELECT e.external_id,w.id,w.favorite FROM work_external_ids e JOIN works w ON w.id=e.work_id WHERE e.provider=? AND w.type='comic'")
        .bind(PROVIDER).fetch_all(pool).await?;
    let states = rows.into_iter().map(|(id, work, favorite)| (id, (work, favorite))).collect::<HashMap<_, _>>();
    for item in items {
        if let Some((work, favorite)) = states.get(&item.path_word) {
            item.local_work_id = Some(work.clone()); item.favorite = *favorite;
        }
    }
    Ok(())
}

fn cached_covers(app: &tauri::AppHandle, directory: &std::path::Path, items: &mut [ComicItem]) {
    for item in items {
        if let Some(cached) = item.cover_url.as_deref().and_then(|url| crate::comic_cover_cache::peek(directory, &item.path_word, url)) {
            if crate::db::allow_cover_file(app, std::path::Path::new(&cached.cover_path)).is_ok() {
                item.cached_cover_path = Some(cached.cover_path);
                item.cached_cover_thumbnail_path = cached.thumbnail_path;
            }
        }
    }
}

async fn detail_in_pool(pool: &SqlitePool, id: &str, refresh: bool) -> AppResult<ComicDetail> {
    if !valid_id(id) { return Err(AppError::Validation("漫画来源 ID 无效".into())); }
    let (mut detail, stale) = cached_request(pool, DETAIL_HOST, &format!("/api/v3/comic2/{id}"),
        &[("platform".into(), "3".into())], 24, refresh, |value| {
            let detail = parse_detail(value)?;
            if detail.item.path_word != id { return Err(invalid_data()); }
            Ok(detail)
        }).await?;
    detail.stale = stale;
    local_states(pool, std::slice::from_mut(&mut detail.item)).await?;
    Ok(detail)
}

#[tauri::command]
pub async fn list_comic_explore(input: ComicQuery, refresh: bool, state: State<'_, AppState>, app: tauri::AppHandle) -> AppResult<ComicPage> {
    let (path, params) = query_params(&input)?;
    let (mut page, stale) = cached_request(&state.pool, CATALOG_HOST, path, &params, 1, refresh, parse_list).await?;
    page.page = input.page; page.stale = stale;
    local_states(&state.pool, &mut page.items).await?;
    cached_covers(&app, &state.cover_cache_path, &mut page.items);
    Ok(page)
}

#[tauri::command]
pub async fn get_comic_explore_themes(state: State<'_, AppState>) -> AppResult<Vec<ComicTheme>> {
    cached_request(&state.pool, CATALOG_HOST, "/api/v3/h5/filter/comic/tags",
        &[("type".into(), "1".into()), ("platform".into(), "3".into())], 24, false, parse_themes).await.map(|(data, _)| data)
}

#[tauri::command]
pub async fn get_comic_explore_detail(path_word: String, refresh: bool, state: State<'_, AppState>, app: tauri::AppHandle) -> AppResult<ComicDetail> {
    let mut detail = detail_in_pool(&state.pool, &path_word, refresh).await?;
    cached_covers(&app, &state.cover_cache_path, std::slice::from_mut(&mut detail.item));
    Ok(detail)
}

async fn persist_work(pool: &SqlitePool, detail: &ComicDetail, favorite: bool, cover: Option<String>) -> AppResult<String> {
    let (_guard, mut tx) = crate::db::begin_write(pool).await?;
    let existing: Option<String> = sqlx::query_scalar("SELECT work_id FROM work_external_ids WHERE provider=? AND external_id=?")
        .bind(PROVIDER).bind(&detail.item.path_word).fetch_optional(&mut *tx).await?;
    if let Some(id) = existing { tx.commit().await?; return Ok(id); }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let item = &detail.item;
    let metadata = WorkMetadata {
        provider: PROVIDER.into(), external_id: item.path_word.clone(), title: item.title.clone(),
        original_title: None, aliases: detail.aliases.clone(), description: item.summary.clone(),
        cover_url: item.cover_url.clone(), banner_url: None, year: None, season: None,
        subject_type: "comic".into(), genres: item.tags.clone(), score: None, rank: None,
        rating_count: 0, collection_count: 0, air_date: None, broadcast: None,
        source_keys: vec![PROVIDER.into()], cover_provider: Some(PROVIDER.into()), banner_provider: None,
        score_provider: None, fetched_at: now.clone(),
    };
    sqlx::query("INSERT INTO works(id,title,type,status,favorite,created_at,updated_at) VALUES(?,?,'comic','planned',?,?,?)")
        .bind(&id).bind(&item.title).bind(favorite).bind(&now).bind(&now).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,?,?,?,?)")
        .bind(&id).bind(PROVIDER).bind(&item.path_word).bind(&now).bind(&now).execute(&mut *tx).await?;
    crate::metadata::apply_metadata(&mut tx, &id, &metadata, cover, None, &now).await?;
    sqlx::query("INSERT INTO metadata_provider_records(work_id,provider,external_id,title,confidence,response_json,fetched_at) VALUES(?,?,?,?,1,?,?)")
        .bind(&id).bind(PROVIDER).bind(&item.path_word).bind(&item.title)
        .bind(serde_json::to_string(&metadata)?).bind(&now).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(id)
}

#[tauri::command]
pub async fn save_comic_explore_work(path_word: String, favorite: bool, state: State<'_, AppState>) -> AppResult<String> {
    if !valid_id(&path_word) { return Err(AppError::Validation("漫画来源 ID 无效".into())); }
    let existing: Option<String> = sqlx::query_scalar("SELECT work_id FROM work_external_ids WHERE provider=? AND external_id=?")
        .bind(PROVIDER).bind(&path_word).fetch_optional(&state.pool).await?;
    if let Some(id) = existing { return Ok(id); }
    let detail = detail_in_pool(&state.pool, &path_word, false).await?;
    let mut cover = detail.item.cover_url.clone();
    if let Some(url) = &detail.item.cover_url {
        let destination = crate::metadata_aggregator::artwork_cache_path(&state.cover_cache_path,
            &format!("copymanga:{path_word}"), "cover", url);
        if let Ok(Some(cached)) = crate::comic_cover_cache::promote(&state.cover_cache_path, &path_word, url).await {
            cover = Some(cached);
        } else if crate::metadata_aggregator::cache_cover(url, &destination).await.is_ok() {
            cover = Some(destination.to_string_lossy().into_owned());
        }
    }
    persist_work(&state.pool, &detail, favorite, cover).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> ComicDetail {
        parse_detail(json!({"comic":{"name":"短篇","path_word":"short-comic","author":[{"name":"作者"}],
            "theme":[{"name":"日常"}],"cover":"https://sm.mangafunb.fun/a/cover.jpg","brief":"简介",
            "alias":"别名,Short","status":{"display":"已完結"},"last_chapter":{"name":"终话"}},
            "groups":{"default":{"count":1}}})).unwrap()
    }

    #[test]
    fn parses_metadata_without_claiming_chapter_contents_or_ratings() {
        let detail = fixture();
        assert_eq!(detail.item.authors, ["作者"]);
        assert_eq!(detail.chapter_count, Some(1));
        assert_eq!(detail.aliases, ["别名", "Short"]);
        assert!(parse_detail(Value::Null).is_err());
        assert!(parse_list(json!({"list":[{"name":"缺少ID"}],"total":1})).is_err());
        let mut value = json!({"name":"作品","path_word":"book","cover":"https://evil.test/cover.jpg"});
        assert!(parse_item(&value).unwrap().cover_url.is_none());
        value["path_word"] = json!("../book");
        assert!(parse_item(&value).is_err());
    }

    #[test]
    fn old_metadata_cache_does_not_require_local_cover_paths() {
        let mut old = serde_json::to_value(fixture()).unwrap();
        let item = old["item"].as_object_mut().unwrap();
        item.remove("cachedCoverPath"); item.remove("cachedCoverThumbnailPath");
        let detail: ComicDetail = serde_json::from_value(old).unwrap();
        assert_eq!(detail.item.title, "短篇");
        assert!(detail.item.cached_cover_path.is_none());
        assert!(detail.item.cached_cover_thumbnail_path.is_none());
    }

    #[test]
    fn separates_search_and_directory_filters_and_bounds_paging() {
        let mut input = ComicQuery { query: "短篇 & 猫".into(), theme: "".into(), top: "".into(), sort: "popular".into(), page: 2 };
        let (path, params) = query_params(&input).unwrap();
        assert_eq!(path, "/api/v3/search/comic");
        assert!(params.contains(&("q".into(), "短篇 & 猫".into())));
        assert!(params.contains(&("offset".into(), "24".into())));
        input.theme = "aiqing".into();
        assert!(query_params(&input).is_err());
        input.query.clear(); input.sort = "updated".into(); input.top = "finish".into();
        let (_, params) = query_params(&input).unwrap();
        assert!(params.contains(&("ordering".into(), "-datetime_updated".into())));
        input.page = 0; assert!(query_params(&input).is_err());
    }

    #[tokio::test]
    async fn repeated_import_preserves_personal_records_and_independent_ids() {
        let pool = crate::db::test_pool().await.unwrap();
        let detail = fixture();
        let id = persist_work(&pool, &detail, true, detail.item.cover_url.clone()).await.unwrap();
        sqlx::query("UPDATE works SET title='手动标题',notes='我的记录',rating=9,status='in_progress',favorite=0 WHERE id=?")
            .bind(&id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,'bangumi','123','now','now')")
            .bind(&id).execute(&pool).await.unwrap();
        assert_eq!(persist_work(&pool, &detail, true, None).await.unwrap(), id);
        let row: (String, String, f64, String, bool) = sqlx::query_as("SELECT title,notes,rating,status,favorite FROM works WHERE id=?")
            .bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(row, ("手动标题".into(), "我的记录".into(), 9.0, "in_progress".into(), false));
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM work_external_ids WHERE work_id=?").bind(&id).fetch_one(&pool).await.unwrap(), 2);
        let mut items = vec![detail.item]; local_states(&pool, &mut items).await.unwrap();
        assert_eq!(items[0].local_work_id.as_deref(), Some(id.as_str()));
        assert!(!items[0].favorite);
    }

    #[tokio::test]
    async fn optional_bangumi_match_keeps_copy_identity_and_personal_data() {
        let pool = crate::db::test_pool().await.unwrap();
        let detail = fixture();
        let id = persist_work(&pool, &detail, true, None).await.unwrap();
        sqlx::query("UPDATE works SET title='自定义标题',notes='读过第一话',status='in_progress' WHERE id=?")
            .bind(&id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO work_field_locks(work_id,field_name,updated_at) VALUES(?,'title','now')")
            .bind(&id).execute(&pool).await.unwrap();
        let json: String = sqlx::query_scalar("SELECT response_json FROM metadata_provider_records WHERE work_id=? AND provider='copymanga'")
            .bind(&id).fetch_one(&pool).await.unwrap();
        let mut metadata: WorkMetadata = serde_json::from_str(&json).unwrap();
        metadata.provider = "bangumi".into(); metadata.external_id = "123".into(); metadata.title = "Bangumi 标题".into();
        let (_guard, mut tx) = crate::db::begin_write(&pool).await.unwrap();
        crate::book_scrape::apply_prepared_match(&mut tx, &id, crate::book_scrape::PreparedBookMatch {
            external_id: "123".into(), metadata, cover_path: None, single_volume: true,
        }, "now").await.unwrap();
        tx.commit().await.unwrap();
        let row: (String, String, String, bool) = sqlx::query_as("SELECT title,notes,status,favorite FROM works WHERE id=?")
            .bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(row, ("自定义标题".into(), "读过第一话".into(), "in_progress".into(), true));
        let copy: String = sqlx::query_scalar("SELECT external_id FROM work_external_ids WHERE work_id=? AND provider='copymanga'")
            .bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(copy, "short-comic");
    }

    #[tokio::test]
    async fn valid_cache_works_offline_and_bad_responses_do_not_replace_it() {
        let pool = crate::db::test_pool().await.unwrap();
        let host = "http://127.0.0.1:1";
        let key = format!("v1:{host}/detail:[]");
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES(?,?,?,'now',?)")
            .bind(PROVIDER).bind(key).bind(serde_json::to_string(&fixture()).unwrap())
            .bind((Utc::now()+ChronoDuration::hours(1)).to_rfc3339()).execute(&pool).await.unwrap();
        let (_, stale) = cached_request(&pool, host, "/detail", &[], 1, false, parse_detail).await.unwrap();
        assert!(!stale);
        let (detail, stale) = cached_request(&pool, host, "/detail", &[], 1, true, parse_detail).await.unwrap();
        assert!(stale); assert_eq!(detail.item.title, "短篇");
        assert!(cached_request(&pool, host, "/missing", &[], 1, false, parse_detail).await.is_err());
    }

    #[tokio::test]
    async fn successful_http_with_empty_business_result_is_not_cached() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let pool = crate::db::test_pool().await.unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 4096]; socket.read(&mut buffer).await.unwrap();
            let body = r#"{"code":200,"results":null}"#;
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        assert!(cached_request(&pool, &host, "/detail", &[], 1, false, parse_detail).await.is_err());
        server.await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM metadata_cache WHERE provider='copymanga'").fetch_one(&pool).await.unwrap(), 0);
    }

    #[tokio::test]
    #[ignore = "explicit live public metadata smoke test; no account, chapter contents or user database"]
    async fn live_public_metadata_endpoints() {
        let params = vec![("free_type".into(), "1".into()), ("limit".into(), PAGE_SIZE.to_string()), ("offset".into(), "0".into()), ("ordering".into(), "-popular".into()), ("platform".into(), "3".into())];
        let list = parse_list(request(CATALOG_HOST, "/api/v3/comics", &params).await.unwrap()).unwrap();
        assert_eq!(list.items.len(), PAGE_SIZE as usize);
        let themes = parse_themes(request(CATALOG_HOST, "/api/v3/h5/filter/comic/tags", &[("type".into(), "1".into()), ("platform".into(), "3".into())]).await.unwrap()).unwrap();
        assert!(!themes.is_empty());
        let filter = ComicQuery { query: "".into(), theme: themes[0].path_word.clone(), top: "finish".into(), sort: "updated".into(), page: 1 };
        let (path, mut params) = query_params(&filter).unwrap();
        params.iter_mut().find(|(name, _)| name == "limit").unwrap().1 = "2".into();
        let filtered = parse_list(request(CATALOG_HOST, path, &params).await.unwrap()).unwrap();
        assert!(filtered.total <= list.total);
        let detail = parse_detail(request(DETAIL_HOST, &format!("/api/v3/comic2/{}", list.items[0].path_word), &[("platform".into(), "3".into())]).await.unwrap()).unwrap();
        assert_eq!(detail.item.path_word, list.items[0].path_word);
        let pool = crate::db::test_pool().await.unwrap();
        let id = persist_work(&pool, &detail, true, None).await.unwrap();
        assert!(!id.is_empty());
        let query = ComicQuery { query: list.items[0].title.clone(), theme: "".into(), top: "".into(), sort: "popular".into(), page: 1 };
        let (path, mut params) = query_params(&query).unwrap();
        params.iter_mut().find(|(name, _)| name == "limit").unwrap().1 = "2".into();
        let search = parse_list(request(CATALOG_HOST, path, &params).await.unwrap()).unwrap();
        assert!(search.items.iter().any(|item| item.path_word == list.items[0].path_word));
    }
}
