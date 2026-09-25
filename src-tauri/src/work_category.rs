//! Read-only content categories; file types remain available for player dispatch.
use crate::error::AppResult;
use sqlx::SqlitePool;
use std::collections::HashMap;

pub async fn load(pool: &SqlitePool, work_id: Option<&str>) -> AppResult<HashMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT w.id, CASE
            WHEN w.type != 'video' THEN w.type
            WHEN EXISTS(SELECT 1 FROM work_external_ids e WHERE e.work_id=w.id AND e.provider='bangumi') THEN 'anime'
            WHEN EXISTS(SELECT 1 FROM work_external_ids e WHERE e.work_id=w.id AND e.provider='tmdb' AND e.external_id LIKE 'movie/%') THEN 'movie'
            WHEN EXISTS(SELECT 1 FROM work_external_ids e WHERE e.work_id=w.id AND e.provider='tmdb' AND e.external_id LIKE 'tv/%/season/%') THEN 'tv'
            ELSE 'video' END
         FROM works w WHERE (? IS NULL OR w.id=?)",
    ).bind(work_id).bind(work_id).fetch_all(pool).await?;
    Ok(rows.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn categories_preserve_anime_anchor_and_do_not_guess_unknown_video() {
        let pool = crate::db::test_pool().await.unwrap();
        for (id, kind) in [("anime", "video"), ("movie", "video"), ("tv", "video"), ("unknown", "video"), ("comic", "comic"), ("novel", "novel")] {
            sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES(?,?,?,'now','now')")
                .bind(id).bind(id).bind(kind).execute(&pool).await.unwrap();
        }
        for (id, provider, external) in [("anime", "bangumi", "123"), ("anime", "tmdb", "movie/42"), ("movie", "tmdb", "movie/43"), ("tv", "tmdb", "tv/42/season/0")] {
            sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,?,?,'now','now')")
                .bind(id).bind(provider).bind(external).execute(&pool).await.unwrap();
        }
        let categories = load(&pool, None).await.unwrap();
        for id in ["anime", "movie", "tv", "comic", "novel"] { assert_eq!(categories[id], id); }
        assert_eq!(categories["unknown"], "video");
        assert_eq!(load(&pool, Some("tv")).await.unwrap().len(), 1);
    }
}
