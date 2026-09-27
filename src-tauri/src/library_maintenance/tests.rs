use super::*;

async fn fixture() -> SqlitePool {
    let pool = db::test_pool().await.unwrap();
    sqlx::raw_sql("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('work','保留作品','video','保留笔记','2020','2020');
      INSERT INTO library_roots(id,path,kind,source_type,availability,last_scanned_at,created_at,updated_at) VALUES('old','C:\\Old','video','local','unavailable','2026-09-27','2020','2020'),('new','D:\\New','video','local','online','2026-09-27','2020','2020');
      INSERT INTO media_files(id,work_id,library_root_id,path,file_name,extension,media_type,size,missing,modified_at,created_at,updated_at) VALUES('maintenance-a','work','old','C:\\Old\\01.mkv','01.mkv','mkv','video',8,1,'oldmtime','2020','2020'),('maintenance-b',NULL,'new','D:\\New\\01.mkv','01.mkv','mkv','video',8,0,'newmtime','2026','2026');
      INSERT INTO anime_episodes(work_id,provider,external_id,sort_number,fetched_at) VALUES('work','bangumi','ep1',1,'2020');
      INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES('maintenance-a','work','bangumi','ep1','manual',1,'2020');
      INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,completed,updated_at) VALUES('maintenance-a',12345,60000,0,'2026-09-27T00:00:00Z');
      INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES('subtitle','work','C:\\sub.ass','sub.ass','ass','other','2020','2020');
      INSERT INTO subtitle_links(subtitle_media_file_id,video_media_file_id,work_id,match_method,created_at,updated_at) VALUES('subtitle','maintenance-a','work','episode','2020','2020');")
        .execute(&pool).await.unwrap();
    pool
}
fn pair() -> Vec<Pair> {
    vec![Pair {
        old_id: "maintenance-a".into(),
        new_id: "maintenance-b".into(),
    }]
}

#[tokio::test]
async fn relocation_keeps_original_identity_manual_links_subtitles_and_progress() {
    let pool = fixture().await;
    let p = preview(&pool, &pair()).await.unwrap();
    assert_eq!(apply(&pool, &pair(), &p.token).await.unwrap(), 1);
    let row: (String,String,String,bool,String) = sqlx::query_as("SELECT path,work_id,library_root_id,missing,modified_at FROM media_files WHERE id='maintenance-a'").fetch_one(&pool).await.unwrap();
    assert_eq!(
        row,
        (
            "D:\\New\\01.mkv".into(),
            "work".into(),
            "new".into(),
            false,
            "newmtime".into()
        )
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT position_ms FROM playback_progress WHERE media_file_id='maintenance-a'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        12345
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT match_method FROM media_episode_links WHERE media_file_id='maintenance-a'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "manual"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT video_media_file_id FROM subtitle_links")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "maintenance-a"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT created_at FROM media_files WHERE id='maintenance-a'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "2020"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM media_files WHERE id='maintenance-b'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn changed_preview_and_target_records_cannot_be_overwritten() {
    let pool = fixture().await;
    let p = preview(&pool, &pair()).await.unwrap();
    sqlx::query("UPDATE media_files SET modified_at='changed' WHERE id='maintenance-b'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(apply(&pool, &pair(), &p.token).await.is_err());
    let p = preview(&pool, &pair()).await.unwrap();
    sqlx::query("INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('maintenance-b',1,100,'now')").execute(&pool).await.unwrap();
    assert!(apply(&pool, &pair(), &p.token).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM media_files WHERE id IN ('maintenance-a','maintenance-b')"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
}

#[tokio::test]
async fn failed_second_write_rolls_back_the_whole_batch() {
    let pool = fixture().await;
    sqlx::raw_sql("INSERT INTO media_files(id,work_id,library_root_id,path,file_name,extension,media_type,size,missing,created_at,updated_at) VALUES('maintenance-c','work','old','C:\\Old\\02.mkv','02.mkv','mkv','video',8,1,'2020','2020'),('maintenance-d',NULL,'new','D:\\New\\02.mkv','02.mkv','mkv','video',8,0,'2026','2026'); CREATE TRIGGER reject_second BEFORE UPDATE ON media_files WHEN OLD.id='maintenance-c' BEGIN SELECT RAISE(ABORT,'test write failure'); END;")
        .execute(&pool).await.unwrap();
    let mut pairs = pair();
    pairs.push(Pair {
        old_id: "maintenance-c".into(),
        new_id: "maintenance-d".into(),
    });
    let p = preview(&pool, &pairs).await.unwrap();
    assert!(apply(&pool, &pairs, &p.token).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM media_files WHERE id LIKE 'maintenance-%'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        4
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT path FROM media_files WHERE id='maintenance-a'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "C:\\Old\\01.mkv"
    );
}

#[tokio::test]
async fn running_scan_and_fingerprint_mismatch_block_relocation() {
    let pool = fixture().await;
    sqlx::query("INSERT INTO scan_jobs(id,library_root_id,status,started_at) VALUES('job','new','running','now')").execute(&pool).await.unwrap();
    assert!(preview(&pool, &pair()).await.is_err());
    sqlx::raw_sql("UPDATE scan_jobs SET status='completed'; UPDATE media_files SET content_fingerprint=id WHERE id IN ('maintenance-a','maintenance-b');").execute(&pool).await.unwrap();
    assert!(preview(&pool, &pair()).await.is_err());
}

#[tokio::test]
async fn invalid_or_ambiguous_batch_is_atomic_and_offline_is_not_deletion() {
    let pool = fixture().await;
    let mut repeated = pair();
    repeated.extend(pair());
    assert!(preview(&pool, &repeated).await.is_err());
    sqlx::query("UPDATE library_roots SET availability='unavailable' WHERE id='new'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(preview(&pool, &pair()).await.is_err());
    let report = inspect(&pool).await.unwrap();
    assert_eq!(
        report.iter().find(|g| g.kind == "offline").unwrap().total,
        2
    );
    assert_eq!(
        report.iter().find(|g| g.kind == "missing").unwrap().total,
        0
    );
    sqlx::query("UPDATE library_roots SET availability='online' WHERE id='new'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE media_files SET size=9 WHERE id='maintenance-b'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(preview(&pool, &pair()).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT path FROM media_files WHERE id='maintenance-a'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "C:\\Old\\01.mkv"
    );
}

#[tokio::test]
async fn webdav_relocation_uses_new_locator_but_retains_old_media_id() {
    let pool = fixture().await;
    let path = remote_storage::virtual_path("new", "Season 2/01.mkv");
    sqlx::query("UPDATE library_roots SET source_type='webdav',path='webdav://new' WHERE id='new'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE media_files SET path=? WHERE id='maintenance-b'")
        .bind(path.clone())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql("INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES('new','WebDAV','http://test.invalid/dav/','','fixture'); INSERT INTO remote_files(media_file_id,source_id,href,etag) VALUES('maintenance-b','new','/dav/Season%202/01.mkv','rev');").execute(&pool).await.unwrap();
    let p = preview(&pool, &pair()).await.unwrap();
    assert!(p.rows[0].new_path.contains("Season 2/01.mkv"));
    apply(&pool, &pair(), &p.token).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT path FROM media_files WHERE id='maintenance-a'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        path
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT href FROM remote_files WHERE media_file_id='maintenance-a'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "/dav/Season%202/01.mkv"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT position_ms FROM playback_progress WHERE media_file_id='maintenance-a'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        12345
    );
}

#[tokio::test]
async fn cached_or_already_organized_targets_are_preserved() {
    let pool = fixture().await;
    sqlx::query("UPDATE media_files SET work_id='work' WHERE id='maintenance-b'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(preview(&pool, &pair()).await.is_err());
    sqlx::query("UPDATE media_files SET work_id=NULL WHERE id='maintenance-b'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql("INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES('new','WebDAV','http://test.invalid/dav/','','fixture'); INSERT INTO remote_files(media_file_id,source_id,href) VALUES('maintenance-b','new','/dav/01.mkv'); INSERT INTO remote_cache(media_file_id,revision,accessed_at) VALUES('maintenance-b','rev','now');").execute(&pool).await.unwrap();
    assert!(preview(&pool, &pair()).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM remote_cache")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn checks_duplicates_unlinked_episodes_and_mixed_seasons_without_writes() {
    let pool = fixture().await;
    sqlx::raw_sql("UPDATE media_files SET missing=0,parsed_season=1 WHERE id='maintenance-a'; UPDATE media_files SET work_id='work',parsed_season=2 WHERE id='maintenance-b';").execute(&pool).await.unwrap();
    let report = inspect(&pool).await.unwrap();
    assert_eq!(
        report.iter().find(|g| g.kind == "duplicate").unwrap().total,
        2
    );
    assert_eq!(
        report.iter().find(|g| g.kind == "unlinked").unwrap().total,
        1
    );
    assert_eq!(report.iter().find(|g| g.kind == "mixed").unwrap().total, 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM media_files")
            .fetch_one(&pool)
            .await
            .unwrap(),
        3
    );
}
