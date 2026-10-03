//! Choose artwork for its actual role, without changing a work's identity.
use crate::models::WorkMetadata;
use serde_json::Value;
use sqlx::SqlitePool;

#[derive(Clone, Copy)]
enum Role { Poster, Backdrop }

fn image_path(value: &str) -> bool {
    value.starts_with('/') && value.len() > 1
        && !value[1..].contains('/') && !value.contains("..")
        && value[1..].bytes().all(|c| c.is_ascii_alphanumeric() || b"_- .".contains(&c))
        && [".jpg", ".png", ".webp"].iter().any(|extension| value.ends_with(extension))
}

fn choose(data: &Value, role: Role, current: Option<&str>) -> Option<String> {
    let (key, target, minimum, preferred) = match role {
        Role::Poster => ("posters", 2.0 / 3.0, 500, 780),
        Role::Backdrop => ("backdrops", 16.0 / 9.0, 1280, 1920),
    };
    let default_file = current.and_then(|url| url.rsplit('/').next());
    data[key].as_array()?.iter().filter_map(|item| {
        let path = item["file_path"].as_str()?;
        let width = item["width"].as_u64()?;
        let height = item["height"].as_u64()?;
        if !image_path(path) || width < minimum || height == 0 || width > 12_000 || height > 12_000 { return None; }
        let ratio = width as f64 / height as f64;
        let distance = (ratio / target - 1.0).abs();
        if distance > 0.12 { return None; }
        let language = match (role, item["iso_639_1"].as_str()) {
            (Role::Poster, Some("zh")) | (Role::Backdrop, None) => 3,
            (Role::Poster, None) | (Role::Backdrop, Some("zh")) => 2,
            (_, Some("en")) => 1,
            _ => 0,
        };
        let votes = item["vote_count"].as_u64().unwrap_or(0) as f64;
        let rating = item["vote_average"].as_f64().filter(|n| n.is_finite()).unwrap_or(0.0).clamp(0.0, 10.0);
        // Shrink sparse ratings so one perfect vote cannot beat a well-rated image.
        let score = (rating * votes + 6.0 * 20.0) / (votes + 20.0);
        Some((path, width >= preferred, language, score, distance, default_file == Some(&path[1..])))
    }).max_by(|a, b| {
        a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(a.3.total_cmp(&b.3))
            .then(b.4.total_cmp(&a.4)).then(a.5.cmp(&b.5)).then_with(|| b.0.cmp(a.0))
    }).map(|candidate| format!("https://image.tmdb.org/t/p/original{}", candidate.0))
}

/// Reuse existing request caching/retries; missing candidates retain default paths.
pub(crate) async fn enrich(pool: &SqlitePool, metadata: &mut WorkMetadata, fresh: bool) -> Vec<String> {
    let parts: Vec<_> = metadata.external_id.split('/').collect();
    let valid_id = parts.get(1).and_then(|s| s.parse::<u64>().ok()).is_some_and(|id| id > 0);
    let season = match parts.as_slice() {
        ["movie" | "tv", _] if valid_id => false,
        ["tv", _, "season", n] if valid_id && n.parse::<u16>().is_ok_and(|n| n <= 999) => true,
        _ => return Vec::new(),
    };
    let series = format!("{}/{}", parts[0], parts[1]);
    // Include fallback languages explicitly because the shared request uses zh-CN.
    let params = [("include_image_language", "zh,en,null".to_string())];
    let mut warnings = Vec::new();
    match crate::film_tv::request(pool, &format!("{series}/images"), &params, fresh).await {
        Ok(response) => {
            warnings.extend(response.warning);
            if !season {
                if let Some(url) = choose(&response.data, Role::Poster, metadata.cover_url.as_deref()) {
                    metadata.cover_url = Some(url);
                    metadata.cover_provider = Some("tmdb".into());
                }
            }
            if let Some(url) = choose(&response.data, Role::Backdrop, metadata.banner_url.as_deref()) {
                metadata.banner_url = Some(url);
                metadata.banner_provider = Some("tmdb".into());
            }
        }
        Err(_) => warnings.push("TMDB 候选图片未更新，沿用默认图片与已有缓存".into()),
    }
    if season {
        match crate::film_tv::request(pool, &format!("{}/images", metadata.external_id), &params, fresh).await {
            Ok(response) => {
                warnings.extend(response.warning);
                if let Some(url) = choose(&response.data, Role::Poster, metadata.cover_url.as_deref()) {
                    metadata.cover_url = Some(url);
                    metadata.cover_provider = Some("tmdb".into());
                }
            }
            Err(_) => warnings.push("TMDB 本季候选海报未更新，沿用默认海报与已有缓存".into()),
        }
    }
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn poster(path: &str, width: u64, language: Value, rating: f64, votes: u64) -> Value {
        json!({"file_path":path,"width":width,"height":width * 3 / 2,"iso_639_1":language,"vote_average":rating,"vote_count":votes})
    }

    #[test]
    fn selects_sufficient_pixels_before_language_and_rejects_wrong_shape() {
        let images = json!({"posters":[poster("/small.jpg",500,json!("zh"),9.0,100),poster("/large.jpg",1000,Value::Null,8.0,100),{"file_path":"/wide.jpg","width":2000,"height":1000,"iso_639_1":"zh"}]});
        assert_eq!(choose(&images, Role::Poster, None).as_deref(), Some("https://image.tmdb.org/t/p/original/large.jpg"));
        let images = json!({"posters":[poster("/en.jpg",1000,json!("en"),9.0,100),poster("/zh.jpg",1000,json!("zh"),8.0,100)]});
        assert!(choose(&images, Role::Poster, None).unwrap().ends_with("/zh.jpg"));
    }

    #[test]
    fn rejects_invalid_paths_and_sparse_ratings_do_not_win() {
        let images = json!({"posters":[poster("//evil.jpg",1000,Value::Null,10.0,100),poster("/../evil.jpg",1000,Value::Null,10.0,100),poster("/one.jpg",1000,Value::Null,10.0,1),poster("/many.jpg",1000,Value::Null,8.0,100)]});
        assert!(choose(&images, Role::Poster, None).unwrap().ends_with("/many.jpg"));
        assert!(choose(&json!({"posters":[]}), Role::Poster, None).is_none());
        assert!(choose(&json!({"posters":[{"file_path":"/a.jpg","width":1000,"height":0}]}), Role::Poster, None).is_none());
    }

    #[test]
    fn backgrounds_prefer_textless_landscapes_and_keep_default_on_ties() {
        let images = json!({"backdrops":[{"file_path":"/zh.jpg","width":1920,"height":1080,"iso_639_1":"zh"},{"file_path":"/plain.jpg","width":1920,"height":1080,"iso_639_1":null}]});
        assert!(choose(&images, Role::Backdrop, None).unwrap().ends_with("/plain.jpg"));
        let images = json!({"posters":[poster("/a.jpg",1000,Value::Null,8.0,10),poster("/b.jpg",1000,Value::Null,8.0,10)]});
        assert!(choose(&images, Role::Poster, Some("https://image.tmdb.org/t/p/w780/b.jpg")).unwrap().ends_with("/b.jpg"));
    }

    async fn cache(pool: &SqlitePool, path: &str, data: Value) {
        let params = [("include_image_language", "zh,en,null".to_string())];
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?,'now','2999')")
            .bind(format!("film-tv:zh-CN:{path}:{}", serde_json::to_string(&params).unwrap())).bind(data.to_string()).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn season_posters_are_independent_and_offline_failure_retains_defaults() {
        let pool = crate::db::test_pool().await.unwrap();
        let mut metadata = crate::film_tv::metadata(&json!({"id":42,"name":"TV","poster_path":"/default.jpg","backdrop_path":"/default-bg.jpg"}), crate::film_tv::Kind::Tv, Some(2)).unwrap();
        cache(&pool, "tv/42/images", json!({"posters":[poster("/series.jpg",1000,json!("zh"),8.0,100)],"backdrops":[{"file_path":"/bg.jpg","width":1920,"height":1080}]})).await;
        cache(&pool, "tv/42/season/2/images", json!({"posters":[poster("/season2.jpg",1000,json!("zh"),8.0,100)]})).await;
        assert!(enrich(&pool, &mut metadata, false).await.is_empty());
        assert!(metadata.cover_url.as_deref().unwrap().ends_with("/season2.jpg"));
        assert!(metadata.banner_url.as_deref().unwrap().ends_with("/bg.jpg"));
        sqlx::query("UPDATE metadata_cache SET expires_at='2000'").execute(&pool).await.unwrap();
        let cached = (metadata.cover_url.clone(), metadata.banner_url.clone());
        assert_eq!(enrich(&pool, &mut metadata, true).await.len(), 2);
        assert_eq!((metadata.cover_url.clone(), metadata.banner_url.clone()), cached);
        sqlx::query("DELETE FROM metadata_cache").execute(&pool).await.unwrap();
        let original = (metadata.cover_url.clone(), metadata.banner_url.clone());
        assert_eq!(enrich(&pool, &mut metadata, true).await.len(), 2);
        assert_eq!((metadata.cover_url, metadata.banner_url), original);
    }
}
