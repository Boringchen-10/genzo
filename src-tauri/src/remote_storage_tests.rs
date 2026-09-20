//! Isolated loopback fixtures: never connects to a user's server or production database.
use crate::{
    credentials::{self, Credentials},
    db::{self, AppState},
    remote_storage, remote_transfer, scanner,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

struct Fixture {
    _guard: tokio::sync::OwnedMutexGuard<()>,
    state: AppState,
    root: String,
    mode: Arc<AtomicUsize>,
    gets: Arc<AtomicUsize>,
    resumes: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
    _directory: tempfile::TempDir,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
        credentials::delete(&self.root);
    }
}

async fn fixture() -> Fixture {
    static TEST_LOCK: std::sync::OnceLock<Arc<tokio::sync::Mutex<()>>> = std::sync::OnceLock::new();
    let guard = TEST_LOCK
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
        .lock_owned()
        .await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mode = Arc::new(AtomicUsize::new(0));
    let gets = Arc::new(AtomicUsize::new(0));
    let resumes = Arc::new(AtomicUsize::new(0));
    let (m, g, r) = (mode.clone(), gets.clone(), resumes.clone());
    let task = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let (m, g, r) = (m.clone(), g.clone(), r.clone());
            tokio::spawn(async move {
                let mut request = Vec::new();
                loop {
                    let mut byte = [0];
                    if socket.read_exact(&mut byte).await.is_err() {
                        return;
                    }
                    request.push(byte[0]);
                    if request.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request);
                let length = request
                    .lines()
                    .filter_map(|line| line.split_once(':'))
                    .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                let mut body = vec![0; length];
                if socket.read_exact(&mut body).await.is_err() {
                    return;
                }
                if !request
                    .to_lowercase()
                    .contains("authorization: basic dxnlcjpwyxnz")
                {
                    let _ = socket
                        .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
                        .await;
                    return;
                }
                if request.starts_with("PROPFIND") {
                    if m.load(Ordering::SeqCst) == 1 {
                        let _ = socket
                            .write_all(b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n")
                            .await;
                        return;
                    }
                    let mut xml = String::from("<d:multistatus xmlns:d=\"DAV:\">");
                    for name in [
                        "Show%20-%2001.mkv",
                        "show%20-%2001.mkv",
                        "Show%20OAD%2001.mkv",
                    ] {
                        xml.push_str(&format!("<d:response><d:href>/dav/{name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>10</d:getcontentlength><d:getetag>&quot;stable&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"));
                    }
                    xml.push_str("</d:multistatus>");
                    let _=socket.write_all(format!("HTTP/1.1 207 Multi-Status\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{xml}",xml.len()).as_bytes()).await;
                } else {
                    g.fetch_add(1, Ordering::SeqCst);
                    let range = request
                        .lines()
                        .filter_map(|l| l.split_once(':'))
                        .find(|(k, _)| k.eq_ignore_ascii_case("range"))
                        .map(|(_, v)| v.trim());
                    if m.load(Ordering::SeqCst) == 3 {
                        let _=socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n0123").await;
                        return;
                    }
                    let (start, end) = if m.load(Ordering::SeqCst) == 2 {
                        (0, 9)
                    } else if let Some(range) = range {
                        let (a, b) = range
                            .strip_prefix("bytes=")
                            .unwrap()
                            .split_once('-')
                            .unwrap();
                        let start = a.parse::<usize>().unwrap_or(0);
                        let end = b.parse::<usize>().unwrap_or(9);
                        (start, end)
                    } else {
                        (0, 9)
                    };
                    if start > 0 {
                        assert!(request.to_lowercase().contains("if-range: \"stable\""));
                        r.fetch_add(1, Ordering::SeqCst);
                    }
                    let partial = range.is_some() && m.load(Ordering::SeqCst) != 2;
                    let body = &b"0123456789"[start..=end];
                    let header=format!("HTTP/1.1 {}\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{end}/10\r\nAccept-Ranges: bytes\r\nSet-Cookie: secret=never-forward\r\nConnection: close\r\n\r\n",if partial {"206 Partial Content"} else {"200 OK"},body.len());
                    let _ = socket.write_all(header.as_bytes()).await;
                    let _ = socket.write_all(body).await;
                }
            });
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let pool = db::test_pool().await.unwrap();
    let root = Uuid::new_v4().to_string();
    credentials::save(
        &root,
        &Credentials {
            username: "user".into(),
            password: "pass".into(),
        },
    )
    .unwrap();
    sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES(?,?,'video',1,'now','now','webdav')").bind(&root).bind(format!("webdav://{root}")).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES(?,'fixture',?,'',?)").bind(&root).bind(format!("http://{address}/dav/")).bind(&root).execute(&pool).await.unwrap();
    let state = AppState {
        pool,
        database_path: directory.path().join("test.db"),
        data_directory: directory.path().into(),
        cover_cache_path: directory.path().join("covers"),
        thumbnail_cache_path: directory.path().join("thumbnails"),
    };
    Fixture {
        _guard: guard,
        state,
        root,
        mode,
        gets,
        resumes,
        task,
        _directory: directory,
    }
}

#[tokio::test]
async fn scans_remote_names_without_body_reads_and_preserves_records_when_offline() {
    let f = fixture().await;
    let first = scanner::scan_library_root(&f.state.pool, &f.root)
        .await
        .unwrap();
    assert_eq!(first.job.added_count, 3, "{:?}", first.errors);
    assert!(first.errors.is_empty());
    assert_eq!(f.gets.load(Ordering::SeqCst), 0);
    assert_eq!(
        scanner::scan_library_root(&f.state.pool, &f.root)
            .await
            .unwrap()
            .job
            .added_count,
        0
    );
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT id,path FROM media_files")
        .fetch_all(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 3);
    f.mode.store(1, Ordering::SeqCst);
    let failed = scanner::scan_library_root(&f.state.pool, &f.root)
        .await
        .unwrap();
    assert!(!failed.errors.is_empty());
    assert_eq!(failed.job.missing_count, 0);
    let after: Vec<(String, String)> = sqlx::query_as("SELECT id,path FROM media_files")
        .fetch_all(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(rows, after);
    let groups = crate::grouping::list_unassigned_groups(&f.state.pool)
        .await
        .unwrap();
    assert!(groups.iter().any(|g| g.title.contains("OAD")));
    f.mode.store(0, Ordering::SeqCst);
    assert!(scanner::scan_library_root(&f.state.pool, &f.root)
        .await
        .unwrap()
        .errors
        .is_empty());
}

#[tokio::test]
async fn streams_ranges_without_exposing_upstream_credentials_or_cookies() {
    let f = fixture().await;
    scanner::scan_library_root(&f.state.pool, &f.root)
        .await
        .unwrap();
    let id: String = sqlx::query_scalar("SELECT id FROM media_files LIMIT 1")
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    let url = remote_transfer::open_path(&f.state, &id, true)
        .await
        .unwrap();
    assert!(url.starts_with("http://127.0.0.1:"));
    assert!(!url.contains("pass"));
    let response = reqwest::Client::new()
        .get(&url)
        .header("Range", "bytes=0-0")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 206);
    assert!(response.headers().get("set-cookie").is_none());
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"0");
    let bad = reqwest::get(format!("{url}-wrong")).await.unwrap();
    assert_eq!(bad.status().as_u16(), 404);
    // A server ignoring Range must fall back to a complete local cache.
    f.mode.store(2, Ordering::SeqCst);
    let cached = remote_transfer::open_path(&f.state, &id, true)
        .await
        .unwrap();
    assert!(!cached.starts_with("http"));
    assert_eq!(tokio::fs::read(cached).await.unwrap(), b"0123456789");
}

#[tokio::test]
async fn downloads_resume_and_cached_playback_survives_offline_source() {
    let f = fixture().await;
    scanner::scan_library_root(&f.state.pool, &f.root)
        .await
        .unwrap();
    let id: String = sqlx::query_scalar("SELECT id FROM media_files LIMIT 1")
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    f.mode.store(3, Ordering::SeqCst);
    assert!(remote_transfer::download(&f.state, &id, true)
        .await
        .is_err());
    let done: bool = sqlx::query_scalar("SELECT completed FROM remote_cache WHERE media_file_id=?")
        .bind(&id)
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert!(!done);
    f.mode.store(0, Ordering::SeqCst);
    let path = remote_transfer::download(&f.state, &id, true)
        .await
        .unwrap();
    assert_eq!(tokio::fs::read(&path).await.unwrap(), b"0123456789");
    assert_eq!(f.resumes.load(Ordering::SeqCst), 1);
    f.mode.store(1, Ordering::SeqCst);
    let before = f.gets.load(Ordering::SeqCst);
    assert_eq!(
        remote_transfer::open_path(&f.state, &id, true)
            .await
            .unwrap(),
        path.to_string_lossy()
    );
    assert_eq!(f.gets.load(Ordering::SeqCst), before);
    assert!(remote_storage::display_path(&format!("webdav://{}/", f.root)).contains(&f.root));
}
