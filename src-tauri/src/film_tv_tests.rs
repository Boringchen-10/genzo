use super::*;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn artwork_keeps_original_resolution_for_high_density_displays() {
    let data = json!({"backdrop_path":"/scene.jpg", "poster_path":"/poster.jpg"});
    assert_eq!(artwork(&data, "backdrop_path").as_deref(), Some("https://image.tmdb.org/t/p/original/scene.jpg"));
    assert_eq!(artwork(&data, "poster_path").as_deref(), Some("https://image.tmdb.org/t/p/original/poster.jpg"));
    assert!(artwork(&json!({"backdrop_path":"https://untrusted.example/image.jpg"}), "backdrop_path").is_none());
}

async fn fixture() -> (AppState, tempfile::TempDir) {
    let pool = db::test_pool().await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let state = AppState {
        pool,
        database_path: dir.path().join("test.db"),
        data_directory: dir.path().into(),
        cover_cache_path: dir.path().into(),
        thumbnail_cache_path: dir.path().into(),
    };
    sqlx::query("INSERT INTO library_roots(id,path,kind,created_at,updated_at) VALUES('root','C:\\Videos','video','now','now')").execute(&state.pool).await.unwrap();
    (state, dir)
}

async fn file(state: &AppState, id: &str, name: &str) -> MediaFile {
    sqlx::query("INSERT INTO media_files(id,library_root_id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES(?,'root',?,?,'mkv','video',100,'now','now')")
        .bind(id).bind(format!(r"\\?\UNC\RaiDrive-Administrator\share\Show\{name}")).bind(name).execute(&state.pool).await.unwrap();
    sqlx::query_as("SELECT * FROM media_files WHERE id=?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .unwrap()
}

fn source(kind: Kind) -> Value {
    if kind == Kind::Movie {
        json!({"id": 42,"title":"星际穿越","original_title":"Interstellar","release_date":"2014-11-07","overview":"中文简介","vote_average":8.6,"vote_count":100})
    } else {
        json!({"id":42,"name":"绝命毒师","original_name":"Breaking Bad","first_air_date":"2008-01-20","overview":"中文剧集简介","vote_count":100,"vote_average":9.2})
    }
}

async fn cache(
    pool: &SqlitePool,
    path: &str,
    params: &[(&str, String)],
    data: Value,
    expiry: &str,
) {
    sqlx::query("INSERT OR REPLACE INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('tmdb',?,?,'now',?)")
        .bind(format!("film-tv:zh-CN:{path}:{}", serde_json::to_string(params).unwrap())).bind(data.to_string()).bind(expiry).execute(pool).await.unwrap();
}

async fn candidate(
    state: &AppState,
    media_id: &str,
    kind: Kind,
    season: Option<i64>,
) -> MatchCandidateRow {
    let params = vec![("query", "测试".to_string())];
    cache(
        &state.pool,
        &format!("search/{}", kind.key()),
        &params,
        json!({"results":[source(kind)]}),
        "2999",
    )
    .await;
    let result = recognize(state, media_id, Some("测试".into()), kind, season)
        .await
        .unwrap();
    assert_eq!(result.status, "candidate_pending");
    sqlx::query_as("SELECT * FROM match_candidates WHERE id=?")
        .bind(&result.candidates[0].id)
        .fetch_one(&state.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn parses_mount_tv_and_movie_names_without_turning_title_numbers_into_years() {
    let (state, _dir) = fixture().await;
    for (id, name, season, episode) in [
        ("a", "Breaking.Bad.S02E03.1080p.WEB-DL.mkv", 2, 3),
        ("b", "Breaking.Bad.1x02.mkv", 1, 2),
        ("c", "Show.S00E01.mkv", 0, 1),
    ] {
        let f = file(&state, id, name).await;
        let p = parse_video(&f, Kind::Tv);
        assert_eq!(
            (p.season, p.episode_start),
            (Some(season), Some(episode)),
            "{name}"
        );
        assert_eq!(
            p.episode_end, None,
            "resolution must not become an episode range: {name}"
        );
    }
    let f = file(&state, "m", "Interstellar.2014.2160p.BluRay.mkv").await;
    let p = parse_video(&f, Kind::Movie);
    assert_eq!(
        (p.title.as_deref(), p.year, p.episode_start),
        (Some("Interstellar"), Some(2014), None)
    );
    let f = file(&state, "n", "1917.2019.1080p.mkv").await;
    let p = parse_video(&f, Kind::Movie);
    assert_eq!((p.title.as_deref(), p.year), (Some("1917"), Some(2019)));
    let f = file(&state, "under", "Breaking_Bad_S02E03_1080p.mkv").await;
    let p = parse_video(&f, Kind::Tv);
    assert_eq!(
        (p.season, p.episode_start, p.episode_end),
        (Some(2), Some(3), None)
    );
    let mut f = file(&state, "nested", "02.mkv").await;
    f.path = r"\\?\UNC\RaiDrive-Administrator\share\Breaking Bad\Season 2\02.mkv".into();
    let p = parse_video(&f, Kind::Tv);
    assert_eq!((p.season, p.episode_start), (Some(2), Some(2)));
    f.path = crate::remote_storage::virtual_path("test", "Breaking Bad/Season 2/02.mkv");
    let p = parse_video(&f, Kind::Tv);
    assert_eq!((p.season, p.episode_start), (Some(2), Some(2)));
}

#[test]
fn namespace_keeps_movie_tv_and_each_season_distinct() {
    assert_ne!(
        Anchor::parse("movie/42").unwrap(),
        Anchor::parse("tv/42/season/1").unwrap()
    );
    assert_ne!(
        Anchor::parse("tv/42/season/1").unwrap(),
        Anchor::parse("tv/42/season/2").unwrap()
    );
    for value in [
        "tv/42",
        "movie/42/extra",
        "tv/42/season/-1",
        "movie/0",
        "tv/42/season/1000",
    ] {
        assert!(Anchor::parse(value).is_err());
    }
}

#[tokio::test]
async fn selected_second_season_preserves_first_season_and_user_records() {
    let (state, _dir) = fixture().await;
    file(&state, "s1", "Breaking.Bad.S01E01.mkv").await;
    file(&state, "s2", "Breaking.Bad.S02E01.mkv").await;
    let first = candidate(&state, "s1", Kind::Tv, Some(1)).await;
    let first_id = confirm(&state, &first, &["s1".into()]).await.unwrap();
    sqlx::query("UPDATE works SET notes='私人笔记',favorite=1 WHERE id=?")
        .bind(&first_id)
        .execute(&state.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE media_files SET work_id=? WHERE id='s2'")
        .bind(&first_id)
        .execute(&state.pool)
        .await
        .unwrap();
    let second = candidate(&state, "s2", Kind::Tv, Some(2)).await;
    assert!(confirm(&state, &second, &["s1".into(), "s2".into()])
        .await
        .is_err());
    let second_id = crate::metadata::confirm_candidate_local_selected(
        &state,
        "s2",
        &second.id,
        &["s2".into()],
        crate::grouping::GroupScope::Folder,
    )
    .await
    .unwrap();
    assert_ne!(first_id, second_id);
    let row: (String, String, bool) =
        sqlx::query_as("SELECT title,notes,favorite FROM works WHERE id=?")
            .bind(&first_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert!(row.0.ends_with("第 1 季"));
    assert_eq!(row.1, "私人笔记");
    assert!(row.2);
    let links: Vec<(String, String)> =
        sqlx::query_as("SELECT id,work_id FROM media_files ORDER BY id")
            .fetch_all(&state.pool)
            .await
            .unwrap();
    assert_eq!(
        links,
        vec![("s1".into(), first_id), ("s2".into(), second_id.clone())]
    );
    file(&state, "s2b", "Breaking.Bad.S02E02.mkv").await;
    let again = candidate(&state, "s2b", Kind::Tv, Some(2)).await;
    assert_eq!(
        confirm(&state, &again, &["s2b".into()]).await.unwrap(),
        second_id
    );
}

#[tokio::test]
async fn offline_season_refresh_preserves_manual_links_and_supplies_stills() {
    let (state, _dir) = fixture().await;
    file(&state, "e1", "Breaking.Bad.S02E01.mkv").await;
    file(&state, "e2", "Breaking.Bad.S02E02.mkv").await;
    file(&state, "double", "Breaking.Bad.S02E03E04.mkv").await;
    let c = candidate(&state, "e1", Kind::Tv, Some(2)).await;
    let work = confirm(&state, &c, &["e1".into(), "e2".into(), "double".into()])
        .await
        .unwrap();
    cache(&state.pool, "tv/42", &[], source(Kind::Tv), "2999").await;
    cache(
        &state.pool,
        "tv/42/season/2",
        &[],
        json!({"episodes":[
            {"episode_number":1,"name":"第一集","still_path":"/test.jpg"},
            {"episode_number":2,"name":"第二集"}, {"episode_number":3,"name":"第三集"}
        ]}),
        "2999",
    )
    .await;
    enrich(&state, &work, "tv/42/season/2", false)
        .await
        .unwrap();
    let s = structure(&state.pool, &work, "tv/42/season/2")
        .await
        .unwrap();
    assert_eq!(s.episodes.len(), 3);
    assert_eq!(s.episodes[0].local_files[0].id, "e1");
    assert_eq!(
        s.episodes[0].image_url.as_deref(),
        Some("https://image.tmdb.org/t/p/original/test.jpg")
    );
    assert!(s.unmatched_files.iter().any(|f| f.id == "double"));
    crate::anime_details::set_episode_link(&state.pool, "e1", Some("tv/42/season/2/episode/2"))
        .await
        .unwrap();
    cache(
        &state.pool,
        "tv/42/season/2",
        &[],
        json!({"episodes":[]}),
        "2999",
    )
    .await;
    enrich(&state, &work, "tv/42/season/2", true).await.unwrap(); // No token: stale fallback.
    let s = structure(&state.pool, &work, "tv/42/season/2")
        .await
        .unwrap();
    assert_eq!(s.episodes.len(), 3);
    assert!(s.episodes[1].local_files.iter().any(|f| f.id == "e1"));
    assert!(!s.warnings.is_empty());
    let method: String =
        sqlx::query_scalar("SELECT match_method FROM media_episode_links WHERE media_file_id='e1'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(method, "manual");
}

#[tokio::test]
async fn missing_credentials_returns_clear_error_or_cached_search_without_data_loss() {
    let (state, _dir) = fixture().await;
    file(&state, "m", "Interstellar.2014.mkv").await;
    let error = recognize(&state, "m", Some("测试".into()), Kind::Movie, None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Read Access Token"));
    cache(
        &state.pool,
        "search/movie",
        &[("query", "测试".into())],
        json!({"results":[source(Kind::Movie)]}),
        "2000",
    )
    .await;
    let result = recognize(&state, "m", Some("测试".into()), Kind::Movie, None)
        .await
        .unwrap();
    assert_eq!(result.candidates.len(), 1);
    assert!(result.error.unwrap().contains("缓存"));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM works")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "search must not silently create a work");
}

#[tokio::test]
async fn movie_uses_single_work_and_does_not_fabricate_episodes() {
    let (state, _dir) = fixture().await;
    file(&state, "m", "Interstellar.2014.mkv").await;
    file(&state, "other", "Another.Movie.2015.mkv").await;
    let c = candidate(&state, "m", Kind::Movie, None).await;
    assert!(
        crate::metadata::candidates_for_media(&state.pool, "other")
            .await
            .unwrap()
            .is_empty(),
        "an unrelated movie must not inherit its sibling's candidates"
    );
    let work = confirm(&state, &c, &["m".into()]).await.unwrap();
    cache(&state.pool, "movie/42", &[], source(Kind::Movie), "2999").await;
    enrich(&state, &work, "movie/42", false).await.unwrap();
    sqlx::query("UPDATE works SET description='保留的中文简介' WHERE id=?")
        .bind(&work)
        .execute(&state.pool)
        .await
        .unwrap();
    let mut empty_summary = source(Kind::Movie);
    empty_summary["overview"] = json!("");
    cache(&state.pool, "movie/42", &[], empty_summary, "2999").await;
    enrich(&state, &work, "movie/42", false).await.unwrap();
    let description: String = sqlx::query_scalar("SELECT description FROM works WHERE id=?")
        .bind(&work)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(description, "保留的中文简介");
    let s = crate::anime_details::work_structure(&state.pool, &work)
        .await
        .unwrap();
    assert!(s.episodes.is_empty());
    assert_eq!(s.unmatched_files.len(), 1);
    let other: Option<String> =
        sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='other'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert!(other.is_none());
}

#[tokio::test]
async fn animation_tmdb_supplement_is_not_a_primary_film_anchor() {
    let (state, _dir) = fixture().await;
    sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('anime','动画','video','now','now')").execute(&state.pool).await.unwrap();
    for (provider, id) in [("bangumi", "1"), ("tmdb", "movie/42")] {
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('anime',?,?,'now','now')").bind(provider).bind(id).execute(&state.pool).await.unwrap();
    }
    assert_eq!(anchor(&state.pool, "anime").await.unwrap(), None);
    file(&state, "m", "Film.2014.mkv").await;
    let c = candidate(&state, "m", Kind::Movie, None).await;
    assert!(confirm(&state, &c, &["m".into()])
        .await
        .unwrap_err()
        .to_string()
        .contains("动漫作品"));
}

#[tokio::test]
async fn tmdb_retries_502_and_429_then_recovers() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for status in [502, 429, 200] {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0u8; 4096];
            let length = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..length]);
            assert!(request.contains("language=zh-CN"));
            assert!(request
                .to_lowercase()
                .contains("authorization: bearer test-token"));
            let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: 2\r\nRetry-After: 0\r\nConnection: close\r\n\r\n{{}}");
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let result = fetch(
        &format!("http://{address}"),
        "test-token",
        "search/movie",
        &[("query", "Example".into())],
    )
    .await
    .unwrap();
    assert_eq!(result, json!({}));
    server.await.unwrap();
}

#[tokio::test]
async fn confirmed_movie_can_be_undone_without_losing_playback() {
    let (state, _dir) = fixture().await;
    file(&state, "movie", "Interstellar.2014.mkv").await;
    let c = candidate(&state, "movie", Kind::Movie, None).await;
    let work = confirm(&state, &c, &["movie".into()]).await.unwrap();
    let records = crate::recognition_history::list(&state.pool).await.unwrap();
    let record = serde_json::to_value(&records[0]).unwrap();
    assert_eq!(record["targetWorkId"], work);
    crate::recognition_history::undo(&state.pool, record["id"].as_str().unwrap()).await.unwrap();
    let owner: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='movie'").fetch_one(&state.pool).await.unwrap();
    assert!(owner.is_none());
    let candidates: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM match_candidates WHERE media_file_id='movie'").fetch_one(&state.pool).await.unwrap();
    assert_eq!(candidates, 1);
}
