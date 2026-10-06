// COPY book contracts researched from Kira (MIT); see THIRD_PARTY_NOTICES.md.
use crate::{comic_explore::{self as catalog, ComicDetail, ComicPage, ComicQuery, ComicTheme}, db::AppState, error::{AppError, AppResult}};
use serde_json::Value;
use tauri::State;

pub(super) const PROVIDER: &str = "copynovel";

fn invalid() -> AppError { AppError::Network("轻小说来源返回了无效资料".into()) }

fn detail(value: Value, id: &str) -> AppResult<ComicDetail> {
    let item = catalog::parse_item(&value["book"])?;
    if item.path_word != id { return Err(invalid()); }
    Ok(ComicDetail { item, aliases: vec![], chapter_count: None, stale: false })
}

pub(super) async fn annotate(pool: &sqlx::SqlitePool, page: &mut ComicPage) -> AppResult<()> {
    let rows: Vec<(String, String, bool)> = sqlx::query_as("SELECT e.external_id,w.id,w.favorite FROM work_external_ids e JOIN works w ON w.id=e.work_id WHERE e.provider=? AND w.type='novel'")
        .bind(PROVIDER).fetch_all(pool).await?;
    for item in &mut page.items {
        if let Some((_, id, favorite)) = rows.iter().find(|(source, _, _)| source == &item.path_word) {
            item.local_work_id = Some(id.clone()); item.favorite = *favorite;
        }
    }
    Ok(())
}

fn query(input: &ComicQuery) -> AppResult<(&'static str, Vec<(String, String)>)> {
    if !(1..=10_000).contains(&input.page) || input.query.chars().count() > 200
        || !input.top.is_empty() || !matches!(input.sort.as_str(), "popular" | "updated")
        || (!input.theme.is_empty() && !catalog::valid_id(&input.theme)) {
        return Err(AppError::Validation("轻小说筛选参数无效".into()));
    }
    let mut params = vec![("limit".into(), "24".into()), ("offset".into(), ((input.page - 1) * 24).to_string())];
    if !input.query.trim().is_empty() {
        if !input.theme.is_empty() { return Err(AppError::Validation("搜索时请清除题材筛选".into())); }
        params.extend([("q".into(), input.query.trim().into()), ("q_type".into(), "".into())]);
        Ok(("/api/v3/search/books", params))
    } else {
        params.push(("ordering".into(), if input.sort == "updated" { "-datetime_updated" } else { "-popular" }.into()));
        if !input.theme.is_empty() { params.push(("theme".into(), input.theme.clone())); }
        Ok(("/api/v3/books", params))
    }
}

async fn in_pool(pool: &sqlx::SqlitePool, id: &str, refresh: bool) -> AppResult<ComicDetail> {
    if !catalog::valid_id(id) { return Err(AppError::Validation("轻小说来源 ID 无效".into())); }
    let (mut result, stale) = catalog::cached_request_for(PROVIDER, pool, catalog::CATALOG_HOST,
        &format!("/api/v3/book/{id}"), &[("in_mainland".into(), "true".into())], 24, refresh, |v| detail(v, id)).await?;
    let local: Option<(String, bool)> = sqlx::query_as("SELECT w.id,w.favorite FROM works w JOIN work_external_ids e ON e.work_id=w.id WHERE e.provider=? AND e.external_id=? AND w.type='novel'")
        .bind(PROVIDER).bind(id).fetch_optional(pool).await?;
    if let Some((id, favorite)) = local { result.item.local_work_id = Some(id); result.item.favorite = favorite; }
    result.stale = stale;
    Ok(result)
}

#[tauri::command]
pub async fn list_novel_explore(input: ComicQuery, refresh: bool, state: State<'_, AppState>, app: tauri::AppHandle) -> AppResult<ComicPage> {
    let (path, params) = query(&input)?;
    let (mut page, stale) = catalog::cached_request_for(PROVIDER, &state.pool, catalog::CATALOG_HOST, path, &params, 1, refresh, catalog::parse_list).await?;
    page.page = input.page; page.stale = stale;
    annotate(&state.pool, &mut page).await?;
    catalog::cached_covers(&app, &state.cover_cache_path, &mut page.items);
    Ok(page)
}

#[tauri::command]
pub async fn get_novel_explore_themes(state: State<'_, AppState>) -> AppResult<Vec<ComicTheme>> {
    let (tags, _) = catalog::cached_request_for(PROVIDER, &state.pool, catalog::CATALOG_HOST, "/api/v3/theme/book/count",
        &[("free_type".into(), "1".into()), ("limit".into(), "500".into()), ("offset".into(), "0".into())], 24, false, |v| {
            let list = v["list"].as_array().ok_or_else(invalid)?;
            if v["total"].as_u64().is_some_and(|n| n > list.len() as u64) { return Err(AppError::Network("轻小说题材超过当前分页范围，请直接搜索作品".into())); }
            list.iter().map(|v| Ok(ComicTheme { name: v["name"].as_str().ok_or_else(invalid)?.into(), path_word: v["path_word"].as_str().filter(|v| catalog::valid_id(v)).ok_or_else(invalid)?.into() })).collect::<AppResult<Vec<_>>>()
        }).await?;
    Ok(tags)
}

#[tauri::command]
pub async fn get_novel_explore_detail(path_word: String, refresh: bool, state: State<'_, AppState>, app: tauri::AppHandle) -> AppResult<ComicDetail> {
    let mut result = in_pool(&state.pool, &path_word, refresh).await?;
    catalog::cached_covers(&app, &state.cover_cache_path, std::slice::from_mut(&mut result.item));
    Ok(result)
}

#[tauri::command]
pub async fn save_novel_explore_work(path_word: String, favorite: bool, state: State<'_, AppState>) -> AppResult<String> {
    let result = in_pool(&state.pool, &path_word, false).await?;
    let mut cover = result.item.cover_url.clone();
    if let Some(url) = &result.item.cover_url {
        let target = crate::metadata_aggregator::artwork_cache_path(&state.cover_cache_path, &format!("{PROVIDER}:{path_word}"), "cover", url);
        if let Ok(Some(path)) = crate::comic_cover_cache::promote(&state.cover_cache_path, &path_word, url).await { cover = Some(path); }
        else if crate::metadata_aggregator::cache_cover(url, &target).await.is_ok() { cover = Some(target.to_string_lossy().into_owned()); }
    }
    catalog::persist_source_work(&state.pool, &result, favorite, cover, PROVIDER, "novel").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn novel_search_and_detail_are_independent_from_comics() {
        let input = ComicQuery { query: "猫 & 小说".into(), theme: "".into(), top: "".into(), sort: "popular".into(), page: 2 };
        let (path, params) = query(&input).unwrap();
        assert_eq!(path, "/api/v3/search/books");
        assert!(params.contains(&("offset".into(), "24".into())));
        assert!(detail(json!({"book":{"path_word":"other", "name":"同名"}}), "book").is_err());
    }
    #[tokio::test]
    async fn repeated_import_preserves_personal_data_and_separates_source_ids() {
        let pool = crate::db::test_pool().await.unwrap();
        let result = detail(json!({"book":{"path_word":"same", "name":"小说", "brief":"简介"}}), "same").unwrap();
        let id = catalog::persist_source_work(&pool, &result, true, None, PROVIDER, "novel").await.unwrap();
        sqlx::query("UPDATE works SET notes='用户笔记',status='completed',rating=9 WHERE id=?").bind(&id).execute(&pool).await.unwrap();
        assert_eq!(catalog::persist_source_work(&pool, &result, false, None, PROVIDER, "novel").await.unwrap(), id);
        let comic = catalog::persist_source_work(&pool, &result, false, None, "copymanga", "comic").await.unwrap();
        assert_ne!(comic, id);
        let row: (String, String, f64, bool) = sqlx::query_as("SELECT notes,status,rating,favorite FROM works WHERE id=?").bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(row, ("用户笔记".into(), "completed".into(), 9., true));
    }
}
