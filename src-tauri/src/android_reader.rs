//! Native reader sessions. Only opaque session resources are served on loopback.
use crate::{book_content, db::AppState, error::{AppError, AppResult}};
use serde_json::{json, Value};
use std::{collections::HashMap, io::Read, path::PathBuf, sync::{Arc, OnceLock}, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::{Mutex, Notify, Semaphore}};

static ACTIVE: OnceLock<Mutex<Option<(String, Arc<Notify>)>>> = OnceLock::new();

struct Chapter {
    title: String,
    archive: Option<PathBuf>,
    pages: Vec<String>,
    sections: Vec<Value>,
    inline_images: HashMap<usize, Vec<u8>>,
}
struct Session {
    state: AppState,
    kind: String,
    book: String,
    group: String,
    initial: String,
    base: String,
    chapters: Mutex<HashMap<String, Arc<Chapter>>>,
    loading: Mutex<()>,
    closed: Arc<Notify>,
}
fn invalid(message: &str) -> AppError { AppError::Validation(message.into()) }
fn valid_id(value: &str) -> bool { crate::comic_explore::valid_id(value) }
#[tauri::command]
pub async fn get_reading_resume(kind: String, path_word: String, state: tauri::State<'_, AppState>) -> AppResult<Option<Value>> {
    if !matches!(kind.as_str(), "comic" | "novel") || !valid_id(&path_word) { return Err(invalid("阅读来源标识无效")); }
    let row: Option<(String,String,String)> = sqlx::query_as("SELECT entry_id,group_id,updated_at FROM android_reading_progress WHERE kind=? AND book_id=? ORDER BY updated_at DESC LIMIT 1")
        .bind(kind).bind(path_word).fetch_optional(&state.pool).await?;
    Ok(row.map(|(entry,group,time)| json!({"entryId":entry,"group":group,"updatedAt":time})))
}
fn archive_pages(path: &std::path::Path) -> AppResult<Vec<String>> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(|_| invalid("漫画缓存无法读取，请重新获取"))?;
    if zip.len() == 0 || zip.len() > 1000 { return Err(invalid("漫画缓存页数无效")); }
    let mut pages = Vec::new();
    for index in 0..zip.len() {
        let file = zip.by_index(index).map_err(|_| invalid("漫画缓存目录损坏"))?;
        let name = file.name();
        if file.is_dir() || file.size() > 20 * 1024 * 1024 || name.contains(['/', '\\'])
            || ![".jpg", ".png", ".webp"].iter().any(|extension| name.ends_with(extension)) {
            return Err(invalid("漫画缓存页面无效"));
        }
        pages.push(name.to_owned());
    }
    pages.sort();
    Ok(pages)
}
fn archive_resource(path: &std::path::Path, name: &str) -> AppResult<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(|_| invalid("阅读缓存损坏"))?;
    let mut file = zip.by_name(name).map_err(|_| invalid("缓存页面不存在"))?;
    if file.size() > 20 * 1024 * 1024 { return Err(invalid("缓存页面过大")); }
    let mut bytes = Vec::new();
    file.by_ref().take(20 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 20 * 1024 * 1024 { return Err(invalid("缓存页面过大")); }
    Ok(bytes)
}
fn xml(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}
fn image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
    else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
    else { "image/jpeg" }
}
fn section_document(section: &Value, index: usize) -> Vec<u8> {
    let title = xml(section["title"].as_str().unwrap_or("正文"));
    let body = if let Some(text) = section["text"].as_str() {
        book_content::reader_paragraphs(text)
    } else { format!("<p class=\"illustration\"><img src=\"image-{index}\" alt=\"{title}\"/></p>") };
    format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"zh\"><head><title>{title}</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><style>p{{text-indent:2em;margin:0 0 .6em;overflow-wrap:anywhere}}p:empty{{min-height:.6em}}h1{{font-size:1.3em}}img{{max-width:100%;height:auto}}.illustration{{text-indent:0;text-align:center}}</style></head><body><h1>{title}</h1>{body}</body></html>").into_bytes()
}

impl Session {
    async fn chapter(&self, entry: &str) -> AppResult<Arc<Chapter>> {
        if !valid_id(entry) { return Err(invalid("阅读章节标识无效")); }
        if let Some(chapter) = self.chapters.lock().await.get(entry).cloned() { return Ok(chapter); }
        let _loading = self.loading.lock().await;
        if let Some(chapter) = self.chapters.lock().await.get(entry).cloned() { return Ok(chapter); }
        let (root, kind, book, id) = (self.state.data_directory.clone(), self.kind.clone(), self.book.clone(), entry.to_owned());
        let cached = tokio::task::spawn_blocking(move || book_content::reader_archive(&root, &kind, &book, &id))
            .await.map_err(|error| AppError::System(error.to_string()))??;
        let chapter = if let Some((title, archive)) = cached {
            let pages = if self.kind == "comic" {
                let path = archive.clone();
                tokio::task::spawn_blocking(move || archive_pages(&path)).await.map_err(|error| AppError::System(error.to_string()))??
            } else { Vec::new() };
            Chapter { title, archive: Some(archive), pages, sections: Vec::new(), inline_images:HashMap::new() }
        } else {
            let content = serde_json::to_value(book_content::online_content(&self.state.pool, &self.kind, &self.book, entry, &self.group).await?)?;
            Chapter { title: content["title"].as_str().unwrap_or(entry).into(), archive: None,
                pages: content["pages"].as_array().unwrap().iter().map(|value| value.as_str().unwrap().to_owned()).collect(),
                sections: content["sections"].as_array().unwrap().clone(), inline_images:HashMap::new() }
        };
        let chapter = Arc::new(chapter);
        let mut chapters = self.chapters.lock().await;
        // Retain current and nearby text, rather than accumulating entire series.
        if chapters.len() >= 3 { chapters.retain(|key, _| key == &self.initial); }
        chapters.insert(entry.to_owned(), chapter.clone());
        Ok(chapter)
    }
    async fn manifest(&self, entry: &str) -> AppResult<Value> {
        let chapter = self.chapter(entry).await?;
        let saved: Option<String> = sqlx::query_scalar("SELECT location_json FROM android_reading_progress WHERE kind=? AND book_id=? AND group_id=? AND entry_id=?")
            .bind(&self.kind).bind(&self.book).bind(&self.group).bind(entry).fetch_optional(&self.state.pool).await?;
        let content_base = format!("{}chapter/{entry}/", self.base);
        let pages: Vec<String> = chapter.pages.iter().enumerate().map(|(index, _)| format!("{content_base}page/{index}")).collect();
        let links: Vec<Value> = chapter.sections.iter().enumerate().map(|(index, section)| json!({"href":format!("OEBPS/chapter-{index}.xhtml"),"type":"application/xhtml+xml","title":section["title"]})).collect();
        let resources: Vec<Value> = chapter.sections.iter().enumerate().filter(|(_, section)| section["imageUrl"].is_string())
            .map(|(index, _)| json!({"href":format!("OEBPS/image-{index}"),"type":"image/jpeg"})).collect();
        Ok(json!({"kind":self.kind,"entryId":entry,"title":chapter.title,"offline":chapter.archive.is_some(),
            "archivePath":chapter.archive,"archiveEntries":if chapter.archive.is_some() {chapter.pages.clone()} else {vec![]},"pages":pages,"contentBase":content_base,
            "location":saved.and_then(|value| serde_json::from_str::<Value>(&value).ok()),
            "publication":{"metadata":{"identifier":format!("genzo:{}:{}:{entry}",self.kind,self.book),"title":chapter.title,"language":["zh"],"@type":"http://schema.org/Book"},
                "readingOrder":links,"toc":links,"resources":resources}}))
    }
    async fn location(&self, entry: &str, value: &Value) -> AppResult<String> {
        let chapter = self.chapter(entry).await?;
        if self.kind == "comic" {
            let page = value["pageIndex"].as_u64().ok_or_else(|| invalid("漫画页码无效"))?;
            let offset = value["offset"].as_f64().unwrap_or(0.0);
            if page >= chapter.pages.len() as u64 || !offset.is_finite() || !(0.0..=1.0).contains(&offset) {
                return Err(invalid("漫画阅读位置超出范围"));
            }
            return Ok(serde_json::to_string(&json!({"pageIndex":page,"offset":offset}))?);
        }
        let href = value["href"].as_str().filter(|href| !href.is_empty() && href.len() <= 2048
            && !href.contains(['\\', '?', ':']) && !href.starts_with('/') && !href.split('/').any(|part| part == ".."))
            .ok_or_else(|| invalid("小说正文位置无效"))?;
        if let Some(archive) = chapter.archive.clone() {
            let name = href.split('#').next().unwrap().to_owned();
            let exists = tokio::task::spawn_blocking(move || {
                zip::ZipArchive::new(std::fs::File::open(archive)?).map(|mut zip| zip.by_name(&name).is_ok())
                    .map_err(|_| std::io::Error::other("EPUB 缓存损坏"))
            }).await.map_err(|error| AppError::System(error.to_string()))??;
            if !exists { return Err(invalid("小说正文位置不属于本卷")); }
        } else if !chapter.sections.iter().enumerate().any(|(index, _)| href.split('#').next() == Some(format!("OEBPS/chapter-{index}.xhtml").as_str())) {
            return Err(invalid("小说正文位置不属于本卷"));
        }
        for name in ["progression", "totalProgression"] {
            if !value["locations"][name].is_null() && !value["locations"][name].as_f64().is_some_and(|number| (0.0..=1.0).contains(&number)) {
                return Err(invalid("小说阅读进度无效"));
            }
        }
        let encoded = serde_json::to_string(value)?;
        if encoded.len() > 16 * 1024 { return Err(invalid("小说阅读位置过大")); }
        Ok(encoded)
    }
    async fn bookmarks(&self) -> AppResult<Value> {
        let rows: Vec<(String, String, String, String)> = sqlx::query_as("SELECT id,entry_id,location_json,label FROM android_reading_bookmarks WHERE kind=? AND book_id=? AND group_id=? ORDER BY created_at DESC LIMIT 1000")
            .bind(&self.kind).bind(&self.book).bind(&self.group).fetch_all(&self.state.pool).await?;
        Ok(Value::Array(rows.into_iter().map(|(id, entry, location, label)| json!({"id":id,"entryId":entry,"location":serde_json::from_str::<Value>(&location).unwrap_or(Value::Null),"label":label})).collect()))
    }
}

#[tauri::command]
pub async fn open_internal_reader(kind: String, path_word: String, entry_id: String, group: String, state: tauri::State<'_, AppState>) -> AppResult<Value> {
    if !cfg!(target_os = "android") { return Err(invalid("原生阅读器仅支持 Android")); }
    if !matches!(kind.as_str(), "comic" | "novel") || !valid_id(&path_word) || !valid_id(&entry_id)
        || (!group.is_empty() && !valid_id(&group)) || (kind == "novel" && !group.is_empty()) { return Err(invalid("阅读来源标识无效")); }
    start_reader(state.inner().clone(),kind,path_word,entry_id,group,HashMap::new()).await
}
async fn start_reader(state: AppState, kind: String, path_word: String, entry_id: String, group: String, chapters: HashMap<String, Arc<Chapter>>) -> AppResult<Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let closed = Arc::new(Notify::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let token = uuid::Uuid::new_v4().to_string();
    let base = format!("http://{}/{token}/", listener.local_addr()?);
    let session = Arc::new(Session { state, kind:kind.clone(), book:path_word,
        group, initial:entry_id.clone(), base:base.clone(), chapters:Mutex::new(chapters), loading:Mutex::new(()), closed:closed.clone() });
    let active = ACTIVE.get_or_init(|| Mutex::new(None));
    if let Some((_, previous)) = active.lock().await.replace((id.clone(), closed.clone())) { previous.notify_one(); }
    tauri::async_runtime::spawn(async move {
        let slots = Arc::new(Semaphore::new(8));
        let mut workers = tokio::task::JoinSet::new();
        loop {
            let connection = tokio::select! {
                _ = closed.notified() => break,
                _ = workers.join_next(), if !workers.is_empty() => continue,
                connection = listener.accept() => connection,
            };
            let Ok((stream, _)) = connection else { break };
            let Ok(permit) = slots.clone().try_acquire_owned() else { continue };
            let session = session.clone(); let token = token.clone();
            workers.spawn(async move {
                let _permit = permit;
                let _ = tokio::time::timeout(Duration::from_secs(120), serve(stream, &session, &token)).await;
            });
        }
    });
    if let Err(error) = crate::android_bridge::call("openReader", json!({"sessionId":id,"baseUrl":base,"kind":kind,"entryId":entry_id})).await {
        if let Some((_, closed)) = active.lock().await.take() { closed.notify_one(); }
        return Err(error);
    }
    Ok(json!({"sessionId":id,"kind":kind}))
}

/// Uses only the independently seeded QA book; unavailable in ordinary/debug or release apps.
#[tauri::command]
pub async fn open_reader_online_fixture(state: tauri::State<'_, AppState>) -> AppResult<Value> {
    if !cfg!(debug_assertions) || !cfg!(target_os = "android") || state.data_directory.file_name().and_then(|value| value.to_str()) != Some("com.genzo.android.readerqa") {
        return Err(invalid("此入口仅支持独立阅读测试包"));
    }
    let root = state.data_directory.clone();
    let chapter = tokio::task::spawn_blocking(move || -> AppResult<Chapter> {
        let (_, archive) = book_content::reader_archive(&root,"novel","reader-fixture-novel","one")?.ok_or_else(|| invalid("请先准备合成测试卷"))?;
        let text = std::fs::read_to_string(archive.parent().unwrap().join("volume.txt"))?;
        let rows = text.lines().collect::<Vec<_>>();
        if rows.len() != 600 || !text.starts_with("这是阅读器验收使用的合成段落") { return Err(invalid("测试数据身份不符")); }
        let image = archive_resource(&archive,"OEBPS/image-1.png")?;
        Ok(Chapter {title:"合成小说测试 · 在线资源接口".into(),archive:None,pages:Vec::new(),
            sections:vec![json!({"title":"第一章：合成正文","text":rows[..300].join("\n")}),json!({"title":"独立合成插图","imageUrl":"qa-inline-image"}),json!({"title":"第二章：继续阅读","text":rows[300..].join("\n")})],
            inline_images:HashMap::from([(1,image)])})
    }).await.map_err(|error| AppError::System(error.to_string()))??;
    start_reader(state.inner().clone(),"novel".into(),"reader-fixture-novel".into(),"one".into(),String::new(),HashMap::from([("one".into(),Arc::new(chapter))])).await
}

async fn route(session: &Session, method: &str, path: &str, body: &[u8]) -> AppResult<(Vec<u8>, &'static str)> {
    // Match EPUB-relative resource names, keeping online/offline locator HREFs equal.
    let normalized = path.replace("/OEBPS/", "/");
    let segments: Vec<_> = normalized.split('/').collect();
    let result = match segments.as_slice() {
        ["entries", offset] if method == "GET" => {
            let offset = offset.parse::<u32>().map_err(|_| invalid("目录页无效"))?;
            let offline = session.chapter(&session.initial).await?.archive.is_some();
            let page = if offline { book_content::reader_cached_directory(&session.state.pool,&session.kind,&session.book,&session.group,offset).await? }
                else { book_content::directory(&session.state.pool, &session.kind, &session.book, &session.group, offset, false).await? };
            serde_json::to_value(page)?
        }
        ["bookmarks"] if method == "GET" => session.bookmarks().await?,
        ["history"] if method == "GET" => {
            let rows: Vec<(String,String,String)> = sqlx::query_as("SELECT entry_id,location_json,updated_at FROM android_reading_progress WHERE kind=? AND book_id=? AND group_id=? ORDER BY updated_at DESC LIMIT 100")
                .bind(&session.kind).bind(&session.book).bind(&session.group).fetch_all(&session.state.pool).await?;
            Value::Array(rows.into_iter().map(|(entry,location,time)| json!({"entryId":entry,"location":serde_json::from_str::<Value>(&location).unwrap_or(Value::Null),"updatedAt":time})).collect())
        }
        ["close"] if method == "POST" => { session.closed.notify_one(); json!({}) }
        ["chapter", entry] if method == "GET" => session.manifest(entry).await?,
        ["chapter", entry, "page", index] if method == "GET" => {
            let chapter = session.chapter(entry).await?;
            let index = index.parse::<usize>().map_err(|_| invalid("图片页码无效"))?;
            let source = chapter.pages.get(index).ok_or_else(|| invalid("图片页码超出范围"))?.clone();
            let bytes = if let Some(archive) = chapter.archive.clone() {
                tokio::task::spawn_blocking(move || archive_resource(&archive, &source)).await.map_err(|error| AppError::System(error.to_string()))??
            } else { book_content::online_image(&session.state.pool, &source).await? };
            let mime = image_mime(&bytes); return Ok((bytes, mime));
        }
        ["chapter", entry, resource] if method == "GET" => {
            let chapter = session.chapter(entry).await?;
            if let Some(index) = resource.strip_prefix("chapter-").and_then(|value| value.strip_suffix(".xhtml")).and_then(|value| value.parse::<usize>().ok()) {
                let section = chapter.sections.get(index).ok_or_else(|| invalid("小说章节超出范围"))?;
                return Ok((section_document(section, index), "application/xhtml+xml; charset=utf-8"));
            }
            if let Some(index) = resource.strip_prefix("image-").and_then(|value| value.parse::<usize>().ok()) {
                if let Some(bytes) = chapter.inline_images.get(&index) { return Ok((bytes.clone(),image_mime(bytes))); }
                let url = chapter.sections.get(index).and_then(|section| section["imageUrl"].as_str()).ok_or_else(|| invalid("小说插图不存在"))?;
                let bytes = book_content::online_image(&session.state.pool, url).await?;
                let mime = image_mime(&bytes); return Ok((bytes, mime));
            }
            return Err(invalid("未知正文资源"));
        }
        ["chapter", entry, action] if method == "POST" => {
            let value: Value = serde_json::from_slice(body)?;
            let now = chrono::Utc::now().to_rfc3339();
            if *action == "progress" {
                let location = session.location(entry, &value).await?;
                sqlx::query("INSERT INTO android_reading_progress(kind,book_id,group_id,entry_id,location_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,book_id,group_id,entry_id) DO UPDATE SET location_json=excluded.location_json,updated_at=excluded.updated_at")
                    .bind(&session.kind).bind(&session.book).bind(&session.group).bind(entry).bind(location).bind(&now).execute(&session.state.pool).await?;
                crate::android_events::reading(json!({"kind":session.kind,"pathWord":session.book,"entryId":entry,"group":session.group,"updatedAt":now}));
            } else if *action == "bookmark" {
                let location = session.location(entry, &value["location"]).await?;
                let label = value["label"].as_str().filter(|label| label.chars().count() <= 500).ok_or_else(|| invalid("书签标题无效"))?;
                sqlx::query("INSERT OR IGNORE INTO android_reading_bookmarks(id,kind,book_id,group_id,entry_id,location_json,label,created_at) VALUES(?,?,?,?,?,?,?,?)")
                    .bind(uuid::Uuid::new_v4().to_string()).bind(&session.kind).bind(&session.book).bind(&session.group).bind(entry).bind(location).bind(label).bind(now).execute(&session.state.pool).await?;
            } else if *action == "delete-bookmark" {
                let id = value["id"].as_str().ok_or_else(|| invalid("书签标识缺失"))?;
                sqlx::query("DELETE FROM android_reading_bookmarks WHERE id=? AND kind=? AND book_id=? AND group_id=? AND entry_id=?")
                    .bind(id).bind(&session.kind).bind(&session.book).bind(&session.group).bind(entry).execute(&session.state.pool).await?;
            } else { return Err(invalid("未知阅读操作")); }
            json!({})
        }
        _ => return Err(invalid("未知阅读资源")),
    };
    Ok((serde_json::to_vec(&result)?, "application/json; charset=utf-8"))
}

async fn serve(mut stream: tokio::net::TcpStream, session: &Session, token: &str) -> AppResult<()> {
    let mut header = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 8192 { return Err(invalid("阅读请求头过大")); }
        let byte = tokio::time::timeout_at(deadline, stream.read_u8()).await.map_err(|_| invalid("阅读请求超时"))??;
        header.push(byte);
    }
    let text = String::from_utf8_lossy(&header);
    let mut lines = text.lines();
    let request = lines.next().unwrap_or("").split_whitespace().collect::<Vec<_>>();
    let headers = lines.filter_map(|line| line.split_once(':')).collect::<Vec<_>>();
    let length = headers.iter().find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.trim().parse::<usize>()).transpose().map_err(|_| invalid("阅读请求大小无效"))?.unwrap_or(0);
    if length > 20 * 1024 { return Err(invalid("阅读请求体过大")); }
    let mut body = vec![0; length];
    tokio::time::timeout(Duration::from_secs(10), stream.read_exact(&mut body)).await.map_err(|_| invalid("阅读请求超时"))??;
    let prefix = format!("/{token}/");
    let path = request.get(1).and_then(|path| path.strip_prefix(&prefix));
    let origin_ok = headers.iter().filter(|(name, _)| name.eq_ignore_ascii_case("origin"))
        .all(|(_, origin)| session.base.starts_with(&format!("{}/", origin.trim())));
    let result = if request.len() == 3 && origin_ok && path.is_some() {
        route(session, if request[0] == "HEAD" { "GET" } else { request[0] }, path.unwrap(), &body).await
    } else { Err(invalid("阅读会话无效")) };
    let (status, bytes, mime) = match result {
        Ok((bytes, mime)) => ("200 OK", bytes, mime),
        Err(error) => ("400 Bad Request", serde_json::to_vec(&json!({"error":error.to_string()}))?, "application/json; charset=utf-8"),
    };
    stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",bytes.len()).as_bytes()).await?;
    if request.first() != Some(&"HEAD") { stream.write_all(&bytes).await?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture(kind: &str) -> (Session, tempfile::TempDir) {
        let root = tempfile::tempdir().unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let state = AppState { pool, database_path:root.path().join("db"),data_directory:root.path().into(),cover_cache_path:root.path().join("covers"),thumbnail_cache_path:root.path().join("thumbs") };
        let session = Session { state,kind:kind.into(),book:"book".into(),group:"default".into(),initial:"one".into(),base:"http://127.0.0.1:1234/test/".into(),
            chapters:Mutex::new(HashMap::from([("one".into(),Arc::new(Chapter {title:"第一章".into(),archive:None,pages:vec!["one".into(),"two".into()],sections:vec![json!({"title":"正文","text":"<正文>\n第二段"})],inline_images:HashMap::new()}))])),loading:Mutex::new(()),closed:Arc::new(Notify::new()) };
        (session, root)
    }
    #[tokio::test]
    async fn comic_progress_roundtrips_and_rejects_invalid_page_or_offset() {
        let (session, _root) = fixture("comic").await;
        route(&session,"POST","chapter/one/progress",br#"{"pageIndex":1,"offset":0.4}"#).await.unwrap();
        assert_eq!(session.manifest("one").await.unwrap()["location"],json!({"pageIndex":1,"offset":0.4}));
        for invalid in [json!({"pageIndex":2}),json!({"pageIndex":0,"offset":-1}),json!({"pageIndex":0,"offset":1.1})] {
            assert!(session.location("one",&invalid).await.is_err());
        }
    }
    #[tokio::test]
    async fn novel_locations_are_confined_to_publication_resources() {
        let (session, _root) = fixture("novel").await;
        assert!(session.location("one",&json!({"href":"OEBPS/chapter-0.xhtml","locations":{"progression":0.4}})).await.is_ok());
        for href in ["https://example.com","../secret","/absolute","OEBPS/chapter-9.xhtml"] {
            assert!(session.location("one",&json!({"href":href})).await.is_err());
        }
        assert!(session.location("one",&json!({"href":"OEBPS/chapter-0.xhtml","locations":{"progression":2}})).await.is_err());
    }
    #[tokio::test]
    async fn bookmarks_are_deduplicated_and_isolated_by_group() {
        let (mut session, _root) = fixture("comic").await;
        let body = br#"{"location":{"pageIndex":0},"label":"bookmark"}"#;
        route(&session,"POST","chapter/one/bookmark",body).await.unwrap();
        route(&session,"POST","chapter/one/bookmark",body).await.unwrap();
        let marks = session.bookmarks().await.unwrap();
        assert_eq!(marks.as_array().unwrap().len(),1);
        session.group = "another".into();
        assert!(session.bookmarks().await.unwrap().as_array().unwrap().is_empty());
    }
    #[test]
    fn source_text_is_escaped_and_paragraph_anchors_are_stable() {
        let html = String::from_utf8(section_document(&json!({"title":"<title>","text":"<script>\n第二段"}),0)).unwrap();
        assert!(!html.contains("<script>")); assert!(html.contains("&lt;script&gt;")); assert!(html.contains("id=\"p1\""));
    }
    #[tokio::test]
    async fn http_requires_token_and_rejects_foreign_origins() {
        let (session,_root) = fixture("comic").await;
        let session = Arc::new(session);
        for (path,origin,expected) in [("/wrong/chapter/one","",400),("/token/chapter/one","Origin: https://example.com\r\n",400),("/token/chapter/one","",200)] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let owned = session.clone();
            let server = tokio::spawn(async move { let (stream,_) = listener.accept().await.unwrap(); serve(stream,&owned,"token").await.unwrap(); });
            let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
            client.write_all(format!("GET {path} HTTP/1.1\r\nHost: {address}\r\n{origin}\r\n").as_bytes()).await.unwrap();
            let mut bytes = Vec::new(); client.read_to_end(&mut bytes).await.unwrap(); server.await.unwrap();
            let response = String::from_utf8(bytes).unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {expected}")),"{response}");
        }
    }
    #[tokio::test]
    async fn existing_android_25_database_upgrades_without_changing_records_or_checksums() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = std::borrow::Cow::Owned(old.migrations.into_owned().into_iter().filter(|migration| migration.version <= 25).collect());
        old.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,favorite,rating,notes,created_at,updated_at) VALUES('existing','已有个人书籍','novel',1,8,'保留笔记','t','t')").execute(&pool).await.unwrap();
        let checksums: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let current: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations WHERE version<=25 ORDER BY version").fetch_all(&pool).await.unwrap();
        assert_eq!(current,checksums);
        let preserved: (String,bool,f64,String) = sqlx::query_as("SELECT title,favorite,rating,notes FROM works WHERE id='existing'").fetch_one(&pool).await.unwrap();
        assert_eq!(preserved,("已有个人书籍".into(),true,8.0,"保留笔记".into()));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM android_reading_progress").fetch_one(&pool).await.unwrap(),0);
        crate::migration_compat::run(&pool).await.unwrap();
    }
}
