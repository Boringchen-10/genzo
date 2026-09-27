use super::*;
use crate::{db, scan_tasks};
use std::fs;

#[test]
fn webdav_reuse_requires_size_timestamp_and_remote_version_agreement() {
    let known = (10, None, None);
    let remote: (String, Option<String>) = ("/dav/01.mkv".into(), Some("version-one".into()));
    let mut entry = crate::webdav::DavEntry {
        href: remote.0.clone(),
        name: "01.mkv".into(),
        directory: false,
        size: 10,
        modified_at: None,
        etag: remote.1.clone(),
    };
    assert!(remote_unchanged(Some(&known), Some(&remote), &entry));
    entry.etag = Some("version-two".into());
    assert!(!remote_unchanged(Some(&known), Some(&remote), &entry));
    entry.etag = None;
    assert!(!remote_unchanged(
        Some(&known),
        Some(&(remote.0.clone(), None)),
        &entry
    ));
    entry.modified_at = Some("stable timestamp".into());
    assert!(remote_unchanged(
        Some(&(10, entry.modified_at.clone(), None)),
        Some(&(remote.0, None)),
        &entry
    ));
}

async fn fixture() -> (SqlitePool, tempfile::TempDir, String) {
    let pool = db::test_pool().await.unwrap();
    let directory = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES(?,?,'video',1,'now','now','mounted')")
        .bind(&id).bind(normalize_existing_path(directory.path()).unwrap()).execute(&pool).await.unwrap();
    (pool, directory, id)
}
async fn key(pool: &SqlitePool, id: &str) -> String {
    let root: LibraryRoot = sqlx::query_as("SELECT * FROM library_roots WHERE id=?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
    scan_tasks::scope_key(pool, &root).await.unwrap()
}
#[tokio::test]
async fn mounted_rescan_reuses_parsing_without_writing_existing_rows() {
    let (pool, directory, id) = fixture().await;
    let path = directory.path().join("Example - 01.mkv");
    fs::write(&path, b"original fixture").unwrap();
    scan_library_root(&pool, &id).await.unwrap();
    sqlx::query("UPDATE media_files SET parsed_title='confirmed title',thumbnail_path='cached-thumbnail',updated_at='keep timestamp'").execute(&pool).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_repeat BEFORE UPDATE ON media_files BEGIN SELECT RAISE(ABORT,'unchanged file was rewritten'); END").execute(&pool).await.unwrap();
    let second = scan_library_root(&pool, &id).await.unwrap();
    assert_eq!(second.job.updated_count, 0);
    let task = scan_tasks::list(&pool)
        .await
        .unwrap()
        .into_iter()
        .find(|task| task.id == second.job.id)
        .unwrap();
    assert_eq!(task.reused, 1);
    assert_eq!(task.processed, 1);
    let preserved: (String, String, String) =
        sqlx::query_as("SELECT parsed_title,thumbnail_path,updated_at FROM media_files")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        preserved,
        (
            "confirmed title".into(),
            "cached-thumbnail".into(),
            "keep timestamp".into()
        )
    );
    sqlx::query("DROP TRIGGER reject_repeat")
        .execute(&pool)
        .await
        .unwrap();
    fs::write(path, b"changed fixture of a different size").unwrap();
    fs::write(directory.path().join("Example - 02.mkv"), b"added fixture").unwrap();
    let third = scan_library_root(&pool, &id).await.unwrap();
    assert_eq!((third.job.updated_count, third.job.added_count), (1, 1));
}
#[tokio::test]
async fn retry_subtree_preserves_siblings_and_rejects_changed_or_outside_scope() {
    let (pool, directory, id) = fixture().await;
    fs::create_dir(directory.path().join("first")).unwrap();
    fs::write(directory.path().join("first/01.mkv"), b"first").unwrap();
    let sibling = directory.path().join("02.mkv");
    fs::write(&sibling, b"sibling").unwrap();
    scan_library_root(&pool, &id).await.unwrap();
    fs::remove_file(sibling).unwrap(); // Only temporary fixture data.
    let signature = key(&pool, &id).await;
    let first = normalize_existing_path(&directory.path().join("first")).unwrap();
    let result = scan_with_options(&pool, &id, Some((signature.clone(), vec![first])))
        .await
        .unwrap();
    assert_eq!(result.job.missing_count, 0);
    assert!(scan_with_options(
        &pool,
        &id,
        Some(("changed signature".into(), vec!["first".into()]))
    )
    .await
    .is_err());
    let outside = directory
        .path()
        .join("../outside")
        .to_string_lossy()
        .into_owned();
    assert!(
        scan_with_options(&pool, &id, Some((signature, vec![outside])))
            .await
            .is_err()
    );
    let full = scan_library_root(&pool, &id).await.unwrap();
    assert_eq!(full.job.missing_count, 1);
}
#[tokio::test]
async fn failed_directory_is_persisted_and_retries_after_connection_returns() {
    let pool = db::test_pool().await.unwrap();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("cloud");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("01.mkv"), b"fixture").unwrap();
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES(?,?,'video',1,'now','now','mounted')")
        .bind(&id).bind(normalize_existing_path(&root).unwrap()).execute(&pool).await.unwrap();
    scan_library_root(&pool, &id).await.unwrap();
    fs::rename(&root, directory.path().join("offline")).unwrap();
    let failed = scan_library_root(&pool, &id).await.unwrap();
    let task = scan_tasks::list(&pool)
        .await
        .unwrap()
        .into_iter()
        .find(|task| task.id == failed.job.id)
        .unwrap();
    assert_eq!(task.failed_directories.len(), 1);
    assert_eq!(failed.job.missing_count, 0);
    let persisted: String =
        sqlx::query_scalar("SELECT payload_json FROM scan_task_state WHERE job_id=?")
            .bind(&task.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(persisted.contains("failedDirectories"));
    fs::rename(directory.path().join("offline"), &root).unwrap();
    let result = scan_with_options(&pool, &id, Some((task.scope_key, task.failed_directories)))
        .await
        .unwrap();
    assert!(result.errors.is_empty());
    assert_eq!(result.job.added_count, 0);
}
#[tokio::test]
async fn queued_cancellation_never_changes_index_and_remains_visible() {
    let (pool, directory, id) = fixture().await;
    fs::write(directory.path().join("01.mkv"), b"fixture").unwrap();
    let guard = SCAN_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let scan_pool = pool.clone();
    let scan_id = id.clone();
    let running = tokio::spawn(async move { scan_library_root(&scan_pool, &scan_id).await });
    let job = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let Some(task) = scan_tasks::list(&pool)
                .await
                .unwrap()
                .into_iter()
                .find(|task| task.root_id == id)
            {
                break task;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(job.stage, "queued");
    scan_tasks::cancel(&pool, &job.id).await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), running)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    drop(guard);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    assert_eq!(scan_tasks::list(&pool).await.unwrap()[0].stage, "cancelled");
}

#[tokio::test]
async fn cancellation_during_indexing_rolls_back_all_new_rows() {
    let directory = tempfile::tempdir().unwrap();
    let media = directory.path().join("media");
    fs::create_dir(&media).unwrap();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(directory.path().join("fixture.db"))
                .create_if_missing(true)
                .foreign_keys(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal),
        )
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES(?,?,'video',1,'now','now','mounted')")
        .bind(&id).bind(normalize_existing_path(&media).unwrap()).execute(&pool).await.unwrap();
    fs::write(media.join("Original - 01.mkv"), b"original").unwrap();
    scan_library_root(&pool, &id).await.unwrap();
    let original: (String, String) = sqlx::query_as("SELECT id,updated_at FROM media_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    for index in 0..1000 {
        fs::write(media.join(format!("New - {index:04}.mkv")), b"new").unwrap();
    }
    let scan_pool = pool.clone();
    let scan_id = id.clone();
    let running = tokio::spawn(async move { scan_library_root(&scan_pool, &scan_id).await });
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            let tasks = scan_tasks::list(&pool).await.unwrap();
            if let Some(task) = tasks
                .into_iter()
                .find(|task| task.root_id == id && task.stage == "indexing" && task.processed > 0)
            {
                assert!(task.processed < task.discovered);
                scan_tasks::cancel(&pool, &task.id).await.unwrap();
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap();
    assert!(running.await.unwrap().is_err());
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT id,updated_at FROM media_files")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rows, vec![original]);
}

#[test]
fn retry_path_keys_accept_extended_unc_and_drive_prefixes() {
    assert_eq!(
        normalized_directory(r"\\?\UNC\server\share\Anime"),
        normalized_directory(r"\\server\share\Anime")
    );
    assert!(is_more_specific_root(r"\\?\C:\Library\Show", r"C:\Library"));
    assert!(!is_more_specific_root(
        r"C:\Library-extra\Show",
        r"C:\Library"
    ));
}

#[tokio::test]
async fn partial_retry_never_moves_an_unseen_old_record_by_fingerprint() {
    let (pool, directory, id) = fixture().await;
    sqlx::query("UPDATE library_roots SET source_type='local' WHERE id=?")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();
    let original = directory.path().join("Original - 01.mkv");
    fs::write(&original, b"same fixture content").unwrap();
    scan_library_root(&pool, &id).await.unwrap();
    let old: (String, String) = sqlx::query_as("SELECT id,path FROM media_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    fs::rename(&original, directory.path().join("Original.fixture-backup")).unwrap();
    scan_library_root(&pool, &id).await.unwrap();
    fs::rename(directory.path().join("Original.fixture-backup"), &original).unwrap();
    let child = directory.path().join("copy");
    fs::create_dir(&child).unwrap();
    fs::write(child.join("Copy - 01.mkv"), b"same fixture content").unwrap();
    let result = scan_with_options(
        &pool,
        &id,
        Some((
            key(&pool, &id).await,
            vec![normalize_existing_path(&child).unwrap()],
        )),
    )
    .await
    .unwrap();
    assert_eq!(result.job.added_count, 1);
    let preserved: String = sqlx::query_scalar("SELECT path FROM media_files WHERE id=?")
        .bind(&old.0)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(preserved, old.1);
}
