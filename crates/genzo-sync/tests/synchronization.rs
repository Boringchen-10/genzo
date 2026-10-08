mod support;
use genzo_sync::{protocol::Document, store, transport::DavTransport, Error};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use support::Server;
use uuid::Uuid;

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    let migrations = [
        include_str!("../../../src-tauri/migrations/0001_initial.sql"),
        include_str!("../../../src-tauri/migrations/0002_metadata_matching.sql"),
        include_str!("../../../src-tauri/migrations/0003_episode_subtitle_links.sql"),
        include_str!("../../../src-tauri/migrations/0004_anime_episode_numbers.sql"),
        include_str!("../../../src-tauri/migrations/0005_metadata_aggregation.sql"),
        include_str!("../../../src-tauri/migrations/0006_work_banner_path.sql"),
        include_str!("../../../src-tauri/migrations/0007_anime_file_structure.sql"),
        include_str!("../../../src-tauri/migrations/0008_media_relocation_candidates.sql"),
        include_str!("../../../src-tauri/migrations/0009_remote_storage.sql"),
        include_str!("../../../src-tauri/migrations/0010_remote_relocation_guard.sql"),
        include_str!("../../../src-tauri/migrations/0011_remove_unlinked_episode_placeholders.sql"),
        include_str!("../../../src-tauri/migrations/0012_episode_type.sql"),
        include_str!("../../../src-tauri/migrations/0013_recognition_history.sql"),
        include_str!("../../../src-tauri/migrations/0014_playback_progress.sql"),
        include_str!("../../../src-tauri/migrations/0015_scan_task_state.sql"),
        include_str!("../../../src-tauri/migrations/0016_recognition_preferences.sql"),
        include_str!("../../../src-tauri/migrations/0017_recognition_preference_indexes.sql"),
        include_str!("../../../src-tauri/migrations/0018_episode_artwork_sources.sql"),
        include_str!("../../../src-tauri/migrations/0019_episode_artwork_offset.sql"),
        include_str!("../../../src-tauri/migrations/0020_bookshelf.sql"),
        include_str!("../../../src-tauri/migrations/0021_resource_group_routes.sql"),
        include_str!("../../../src-tauri/migrations/0022_root_destinations.sql"),
        include_str!("../../../src-tauri/migrations/0023_book_volume_matches.sql"),
        include_str!("../../../src-tauri/migrations/0024_book_entry_order.sql"),
        include_str!("../../../src-tauri/migrations/0026_personal_sync.sql"),
    ];
    for migration in migrations {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }
    store::initialize(&pool).await.unwrap();
    pool
}
async fn work(pool: &SqlitePool, anchor: Option<&str>) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES(?,'同一标题','video','original','now','now')").bind(&id).execute(pool).await.unwrap();
    if let Some(anchor) = anchor {
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,'bangumi',?,'now','now')").bind(&id).bind(anchor).execute(pool).await.unwrap();
    }
    id
}
fn dav(server: &Server) -> DavTransport {
    DavTransport::new(&server.url, "u".into(), "p".into(), true).unwrap()
}
async fn connect(pool: &SqlitePool, server: &Server, create: bool) {
    store::connect(
        pool,
        &dav(server),
        &server.url,
        "host-private-credential-id",
        "test",
        create,
        true,
    )
    .await
    .unwrap();
}
#[tokio::test]
async fn shared_package_conditions_do_not_change_automatic_sync_document() {
    let server=Server::start();let transport=dav(&server);
    let document=Document::empty(Uuid::new_v4().to_string());transport.write(&document,None).await.unwrap();
    transport.write_package(b"package-one".to_vec(),None).await.unwrap();
    let (_,first)=transport.read_package().await.unwrap().unwrap();
    assert!(matches!(transport.write_package(b"wrong".to_vec(),None).await,Err(Error::Precondition)));
    transport.write_package(b"package-two".to_vec(),Some(&first)).await.unwrap();
    assert!(matches!(transport.write_package(b"stale".to_vec(),Some(&first)).await,Err(Error::Precondition)));
    assert_eq!(transport.read_package().await.unwrap().unwrap().0,b"package-two");
    assert_eq!(transport.read().await.unwrap().unwrap().document.library_id,document.library_id);
}
async fn count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM works")
        .fetch_one(pool)
        .await
        .unwrap()
}
async fn text(pool: &SqlitePool, id: &str, field: &str) -> String {
    sqlx::query_scalar(&format!("SELECT {field} FROM works WHERE id=?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}
#[tokio::test]
async fn independent_databases_share_anchor_without_replacing_local_ids_or_files() {
    let server = Server::start();
    let a = pool().await;
    let b = pool().await;
    let wa = work(&a, Some("42")).await;
    let wb = work(&b, Some("42")).await;
    sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES('local-file',?,'H:/PRIVATE/movie.mkv','movie','mkv','video','now','now')").bind(&wb).execute(&b).await.unwrap();
    connect(&a, &server, true).await;
    connect(&b, &server, false).await;
    sqlx::query("UPDATE works SET favorite=1 WHERE id=?")
        .bind(&wa)
        .execute(&a)
        .await
        .unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    store::synchronize(&b, &dav(&server)).await.unwrap();
    assert_eq!(count(&b).await, 1);
    assert_eq!(text(&b, &wb, "title").await, "同一标题");
    let row: (String, String) =
        sqlx::query_as("SELECT work_id,path FROM media_files WHERE id='local-file'")
            .fetch_one(&b)
            .await
            .unwrap();
    assert_eq!(row, (wb, "H:/PRIVATE/movie.mkv".into()));
    let bytes = String::from_utf8(server.document()).unwrap();
    assert!(!bytes.contains("PRIVATE"));
    assert!(!bytes.contains("credential"));
    assert_eq!(store::status(&b, false).await.unwrap().pending, 0);
}
#[tokio::test]
async fn same_title_without_anchor_is_never_merged_and_empty_join_never_clears_remote() {
    let server = Server::start();
    let a = pool().await;
    let b = pool().await;
    let empty = pool().await;
    work(&a, None).await;
    work(&b, None).await;
    connect(&a, &server, true).await;
    connect(&b, &server, false).await;
    let before = Document::parse(&server.document())
        .unwrap()
        .operations
        .len();
    connect(&empty, &server, false).await;
    assert_eq!(count(&empty).await, 2);
    assert_eq!(
        before,
        Document::parse(&server.document())
            .unwrap()
            .operations
            .len()
    );
}
#[tokio::test]
async fn concurrent_notes_retain_both_and_other_fields_merge() {
    let server = Server::start();
    let a = pool().await;
    let b = pool().await;
    let wa = work(&a, Some("123")).await;
    connect(&a, &server, true).await;
    connect(&b, &server, false).await;
    let wb: String = sqlx::query_scalar("SELECT id FROM works")
        .fetch_one(&b)
        .await
        .unwrap();
    sqlx::query("UPDATE works SET notes='PC offline note',favorite=1 WHERE id=?")
        .bind(&wa)
        .execute(&a)
        .await
        .unwrap();
    sqlx::query("UPDATE works SET notes='Phone offline note',rating=8 WHERE id=?")
        .bind(&wb)
        .execute(&b)
        .await
        .unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    store::synchronize(&b, &dav(&server)).await.unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    let conflicts = store::conflicts(&a).await.unwrap();
    let notes = conflicts.iter().find(|v| v.field == "notes").unwrap();
    assert_eq!(notes.candidates.len(), 2);
    assert_eq!(text(&a, &wa, "notes").await, text(&b, &wb, "notes").await);
    let fields: (bool, f64) = sqlx::query_as("SELECT favorite,rating FROM works WHERE id=?")
        .bind(&wa)
        .fetch_one(&a)
        .await
        .unwrap();
    assert_eq!(fields, (true, 8.0));
    store::resolve(
        &a,
        &notes.entity,
        "notes",
        "both retained and combined".into(),
    )
    .await
    .unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    store::synchronize(&b, &dav(&server)).await.unwrap();
    assert!(store::conflicts(&b).await.unwrap().is_empty());
    assert_eq!(text(&b, &wb, "notes").await, "both retained and combined");
}
#[tokio::test]
async fn deletion_wins_over_offline_edits_and_source_offline_is_not_deletion() {
    let server = Server::start();
    let a = pool().await;
    let b = pool().await;
    let wa = work(&a, Some("123")).await;
    connect(&a, &server, true).await;
    connect(&b, &server, false).await;
    let wb: String = sqlx::query_scalar("SELECT id FROM works")
        .fetch_one(&b)
        .await
        .unwrap();
    sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES('file',?,'D:/keep.mkv','keep','mkv','video','now','now')").bind(&wb).execute(&b).await.unwrap();
    sqlx::query("UPDATE media_files SET missing=1 WHERE id='file'")
        .execute(&b)
        .await
        .unwrap();
    store::synchronize(&b, &dav(&server)).await.unwrap();
    assert_eq!(count(&b).await, 1);
    sqlx::query("DELETE FROM works WHERE id=?")
        .bind(wa)
        .execute(&a)
        .await
        .unwrap();
    sqlx::query("UPDATE works SET notes='stale edit' WHERE id=?")
        .bind(wb)
        .execute(&b)
        .await
        .unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    store::synchronize(&b, &dav(&server)).await.unwrap();
    assert_eq!(count(&b).await, 0);
    let file: (Option<String>, String) =
        sqlx::query_as("SELECT work_id,path FROM media_files WHERE id='file'")
            .fetch_one(&b)
            .await
            .unwrap();
    assert_eq!(file, (None, "D:/keep.mkv".into()));
    store::synchronize(&b, &dav(&server)).await.unwrap();
    assert_eq!(count(&b).await, 0);
}
#[tokio::test]
async fn lost_success_response_and_auth_failure_keep_pending_and_idempotent_retry() {
    let server = Server::start();
    let a = pool().await;
    let wa = work(&a, Some("123")).await;
    connect(&a, &server, true).await;
    sqlx::query("UPDATE works SET notes='must survive' WHERE id=?")
        .bind(wa)
        .execute(&a)
        .await
        .unwrap();
    server.faults.lock().unwrap().lose_put_response = true;
    assert!(store::synchronize(&a, &dav(&server)).await.is_err());
    assert!(store::status(&a, false).await.unwrap().pending > 0);
    let n = Document::parse(&server.document())
        .unwrap()
        .operations
        .len();
    server.faults.lock().unwrap().unauthorized = true;
    assert!(matches!(
        store::synchronize(&a, &dav(&server)).await,
        Err(Error::Auth)
    ));
    assert!(store::status(&a, false).await.unwrap().pending > 0);
    server.faults.lock().unwrap().unauthorized = false;
    store::synchronize(&a, &dav(&server)).await.unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    assert_eq!(
        n,
        Document::parse(&server.document())
            .unwrap()
            .operations
            .len()
    );
    assert_eq!(store::status(&a, false).await.unwrap().pending, 0);
}
#[tokio::test]
async fn unsafe_servers_and_new_protocol_cannot_overwrite_data() {
    let server = Server::start();
    let a = pool().await;
    work(&a, None).await;
    server.faults.lock().unwrap().ignore_conditions = true;
    assert!(matches!(
        store::connect(
            &a,
            &dav(&server),
            &server.url,
            "private",
            "test",
            true,
            true
        )
        .await,
        Err(Error::ConditionUnsupported)
    ));
    server.faults.lock().unwrap().ignore_conditions = false;
    connect(&a, &server, true).await;
    server.replace(br#"{"protocolVersion":2,"doNotChange":"newer-format"}"#.to_vec());
    let bytes = server.document();
    assert!(matches!(
        store::synchronize(&a, &dav(&server)).await,
        Err(Error::Protocol)
    ));
    assert_eq!(server.document(), bytes);
    assert_eq!(count(&a).await, 1);
}
#[tokio::test]
async fn stale_etag_is_rejected_and_weak_etag_fails_probe() {
    let server = Server::start();
    let a = pool().await;
    connect(&a, &server, true).await;
    let first = dav(&server).read().await.unwrap().unwrap();
    let mut changed = first.document.clone();
    changed.revision += 1;
    dav(&server)
        .write(&changed, Some(&first.etag))
        .await
        .unwrap();
    assert!(matches!(
        dav(&server).write(&first.document, Some(&first.etag)).await,
        Err(Error::Precondition)
    ));
    server.faults.lock().unwrap().weak_etag = true;
    assert!(matches!(
        dav(&server).probe().await,
        Err(Error::ConditionUnsupported)
    ));
}
#[tokio::test]
async fn rollback_cannot_publish_a_business_change_and_repeat_sync_does_not_reorder_works() {
    let server = Server::start();
    let a = pool().await;
    let w = work(&a, None).await;
    connect(&a, &server, true).await;
    let before = text(&a, &w, "updated_at").await;
    let mut tx = a.begin().await.unwrap();
    sqlx::query("UPDATE works SET notes='rolled back' WHERE id=?")
        .bind(&w)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    assert_eq!(text(&a, &w, "notes").await, "original");
    assert_eq!(text(&a, &w, "updated_at").await, before);
    assert_eq!(store::status(&a, false).await.unwrap().pending, 0);
}

#[tokio::test]
async fn restart_after_failed_upload_retains_counter_journal_and_pending() {
    let server = Server::start();
    let dir = tempfile::tempdir().unwrap();
    let filename = dir.path().join("sync.db");
    let options = SqliteConnectOptions::new()
        .filename(&filename)
        .create_if_missing(true)
        .foreign_keys(true);
    let disk = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options.clone())
        .await
        .unwrap();
    let migrated = pool().await;
    let schemas:Vec<String>=sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table','index','view','trigger') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").fetch_all(&migrated).await.unwrap();
    for schema in schemas {
        sqlx::raw_sql(&schema).execute(&disk).await.unwrap();
    }
    sqlx::query("INSERT INTO sync_runtime(id) VALUES(1)")
        .execute(&disk)
        .await
        .unwrap();
    store::initialize(&disk).await.unwrap();
    let work = work(&disk, Some("12")).await;
    connect(&disk, &server, true).await;
    sqlx::query("UPDATE works SET notes='offline at shutdown' WHERE id=?")
        .bind(&work)
        .execute(&disk)
        .await
        .unwrap();
    server.faults.lock().unwrap().fail_get = true;
    assert!(store::synchronize(&disk, &dav(&server)).await.is_err());
    let old = store::status(&disk, false).await.unwrap();
    assert!(old.pending > 0);
    disk.close().await;
    let disk = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    store::initialize(&disk).await.unwrap();
    assert_eq!(
        store::status(&disk, false).await.unwrap().device_id,
        old.device_id
    );
    store::synchronize(&disk, &dav(&server)).await.unwrap();
    assert_eq!(store::status(&disk, false).await.unwrap().pending, 0);
    assert_eq!(text(&disk, &work, "notes").await, "offline at shutdown");
}

#[tokio::test]
async fn viewing_sessions_preserve_rewind_and_resume_only_identical_version() {
    let server = Server::start();
    let a = pool().await;
    let b = pool().await;
    let wa = work(&a, Some("55")).await;
    let wb = work(&b, Some("55")).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("same.mkv");
    std::fs::write(&path, b"identical bytes").unwrap();
    for (pool, work, media) in [(&a, &wa, "a-file"), (&b, &wb, "b-file")] {
        sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,size,modified_at,created_at,updated_at) VALUES(?,?,?,'same','mkv','video',15,'version-1','now','now')").bind(media).bind(work).bind(path.to_string_lossy().as_ref()).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,sort_number,title,fetched_at) VALUES(?,'bangumi','555',1,'Episode','now')").bind(work).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES(?,?,'bangumi','555','manual',1,'now')").bind(media).bind(work).execute(pool).await.unwrap();
    }
    connect(&a, &server, true).await;
    connect(&b, &server, false).await;
    let va = store::bind_media(&a, "a-file").await.unwrap();
    let vb = store::bind_media(&b, "b-file").await.unwrap();
    assert_eq!(va, vb);
    let session = Uuid::new_v4().to_string();
    let mut tx = a.begin().await.unwrap();
    store::record_session(
        &mut tx,
        "a-file",
        &session,
        "2026-10-04T01:00:00Z",
        "2026-10-04T01:00:02Z",
        50000,
        100000,
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let mut tx = a.begin().await.unwrap();
    store::record_session(
        &mut tx,
        "a-file",
        &session,
        "2026-10-04T01:00:00Z",
        "2026-10-04T01:00:03Z",
        20000,
        100000,
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    store::finish_sessions(&a, &[session]).await.unwrap();
    store::synchronize(&a, &dav(&server)).await.unwrap();
    store::synchronize(&b, &dav(&server)).await.unwrap();
    let position: i64 = sqlx::query_scalar(
        "SELECT position_ms FROM playback_progress WHERE media_file_id='b-file'",
    )
    .fetch_one(&b)
    .await
    .unwrap();
    assert_eq!(
        position, 20000,
        "rewind is a valid latest observation, not max(position)"
    );
    sqlx::query("UPDATE sync_media_versions SET version_key='manual:11111111-1111-4111-8111-111111111111' WHERE media_file_id='b-file'").execute(&b).await.unwrap();
    sqlx::query("DELETE FROM playback_progress WHERE media_file_id='b-file'")
        .execute(&b)
        .await
        .unwrap();
    store::synchronize(&b, &dav(&server)).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM playback_progress")
        .fetch_one(&b)
        .await
        .unwrap();
    assert_eq!(n, 0, "a different cut cannot inherit resume");
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_viewing_sessions")
        .fetch_one(&b)
        .await
        .unwrap();
    assert_eq!(sessions, 1);
}

#[tokio::test]
async fn failed_first_creation_resumes_and_concurrent_creators_merge_without_overwrite() {
    let server = Server::start();
    let a = pool().await;
    work(&a, None).await;
    server.faults.lock().unwrap().lose_put_response = true;
    assert!(
        store::connect(&a, &dav(&server), &server.url, "private", "A", true, true)
            .await
            .is_err()
    );
    assert!(store::status(&a, false).await.unwrap().pending > 0);
    store::synchronize(&a, &dav(&server)).await.unwrap();
    assert_eq!(store::status(&a, false).await.unwrap().pending, 0);
    let other = Server::start();
    let b = pool().await;
    let c = pool().await;
    work(&b, None).await;
    work(&c, None).await;
    let db = dav(&other);
    let dc = dav(&other);
    let (left, right) = tokio::join!(
        store::connect(&b, &db, &other.url, "b", "B", true, true),
        store::connect(&c, &dc, &other.url, "c", "C", true, true)
    );
    left.unwrap();
    right.unwrap();
    store::synchronize(&b, &db).await.unwrap();
    store::synchronize(&c, &dc).await.unwrap();
    assert_eq!(count(&b).await, 2);
    assert_eq!(count(&c).await, 2);
    assert_eq!(
        store::status(&b, false).await.unwrap().library_id,
        store::status(&c, false).await.unwrap().library_id
    );
}

#[tokio::test]
async fn manual_locked_local_image_and_field_survive_metadata_sync() {
    let server = Server::start();
    let a = pool().await;
    let b = pool().await;
    let wa = work(&a, Some("9")).await;
    let wb = work(&b, Some("9")).await;
    sqlx::query("UPDATE works SET cover_path='https://lain.bgm.tv/test.jpg' WHERE id=?")
        .bind(&wa)
        .execute(&a)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE works SET title='Manual title',cover_path='C:/LocalOnly/manual.png' WHERE id=?",
    )
    .bind(&wb)
    .execute(&b)
    .await
    .unwrap();
    for field in ["title", "cover_path"] {
        sqlx::query("INSERT INTO work_field_locks(work_id,field_name,locked,updated_at) VALUES(?,?,1,'now')").bind(&wb).bind(field).execute(&b).await.unwrap();
        sqlx::query("INSERT INTO work_field_sources(work_id,field_name,provider,updated_at) VALUES(?,?,'manual','now')").bind(&wb).bind(field).execute(&b).await.unwrap();
    }
    sqlx::query("INSERT INTO work_field_sources(work_id,field_name,provider,updated_at) VALUES(?,'title','bangumi','now')").bind(&wa).execute(&a).await.unwrap();
    connect(&a, &server, true).await;
    connect(&b, &server, false).await;
    assert_eq!(text(&b, &wb, "title").await, "Manual title");
    assert_eq!(text(&b, &wb, "cover_path").await, "C:/LocalOnly/manual.png");
    assert!(!String::from_utf8(server.document())
        .unwrap()
        .contains("LocalOnly"));
    store::synchronize(&a, &dav(&server)).await.unwrap();
    assert_eq!(text(&a, &wa, "title").await, "Manual title");
}
