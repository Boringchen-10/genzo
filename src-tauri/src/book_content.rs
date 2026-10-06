//! Explicit, device-local reading cache. Never indexes generated files as user media.
use crate::{comic_explore as catalog, db::AppState, error::{AppError, AppResult}};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, fs, io::{Read, Write}, path::{Path, PathBuf}, sync::{Arc, OnceLock}, time::Duration};
use tauri::State;
use tokio::sync::{Mutex, Semaphore};
use futures_util::{stream, StreamExt};
use zip::{write::SimpleFileOptions, ZipWriter};

const MAX_TEXT: usize = 32 * 1024 * 1024;
const MAX_IMAGE: usize = 20 * 1024 * 1024;
const MAX_CONTENT: usize = 512 * 1024 * 1024;
static DOWNLOADS: Semaphore = Semaphore::const_new(2);
static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry { pub id: String, pub title: String, pub order: f64, pub count: u64 }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceGroup { pub id: String, pub title: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePage { pub entries: Vec<SourceEntry>, pub total: u64, pub offset: u32, pub group: String, pub groups: Vec<SourceGroup>, pub stale: bool }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedContent { pub entry_id: String, pub title: String, pub format: String, pub bytes: u64, pub cached_at: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedFile { name: String, sha256: String, bytes: u64 }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest { version: u32, kind: String, book_id: String, entry_id: String, title: String, open_file: String, files: Vec<CachedFile>, cached_at: String }

fn invalid(message: &str) -> AppError { AppError::Validation(message.into()) }
fn check(kind: &str, book: &str, entry: Option<&str>) -> AppResult<()> {
    if !matches!(kind, "comic" | "novel") || !catalog::valid_id(book) || entry.is_some_and(|s| !catalog::valid_id(s)) {
        return Err(invalid("阅读来源标识无效"));
    }
    Ok(())
}
fn source_entries(value: &Value, kind: &str, book: &str) -> AppResult<Vec<SourceEntry>> {
    let list = value["list"].as_array().ok_or_else(|| invalid("来源没有返回章节目录"))?;
    if list.len() > 10_000 { return Err(invalid("来源目录超出支持范围")); }
    let mut ids = HashSet::new();
    list.iter().map(|v| {
        let id = v[if kind == "novel" { "id" } else { "uuid" }].as_str().filter(|s| catalog::valid_id(s)).ok_or_else(|| invalid("章卷 ID 无效"))?;
        if !ids.insert(id) || (kind == "novel" && v["book_path_word"].as_str() != Some(book)) { return Err(invalid("目录归属不符或有重复章卷")); }
        Ok(SourceEntry { id: id.into(), title: v["name"].as_str().filter(|s| !s.is_empty()).ok_or_else(|| invalid("章卷名称缺失"))?.into(),
            order: v["index"].as_f64().ok_or_else(|| invalid("章卷顺序缺失"))?, count: v["size"].as_u64().or_else(|| v["count"].as_u64()).unwrap_or(0) })
    }).collect()
}

async fn directory(pool: &sqlx::SqlitePool, kind: &str, book: &str, group: &str, offset: u32, refresh: bool) -> AppResult<SourcePage> {
    check(kind, book, None)?;
    if offset > 1_000_000 || (!group.is_empty() && !catalog::valid_id(group)) || (kind == "novel" && (offset != 0 || !group.is_empty())) { return Err(invalid("目录分页参数无效")); }
    let mut groups = vec![];
    let selected;
    let host;
    let path;
    let params;
    let mut stale_groups = false;
    if kind == "novel" {
        selected = String::new(); host = catalog::CATALOG_HOST;
        path = format!("/api/v3/book/{book}/volumes"); params = vec![];
    } else {
        host = catalog::DETAIL_HOST;
        let (value, stale) = catalog::cached_request_for("copy-reading", pool, host, &format!("/api/v3/comic2/{book}"), &[], 1, refresh, |v| {
            if v["comic"]["path_word"].as_str() != Some(book) { return Err(invalid("漫画目录作品归属不符")); }
            Ok(v)
        }).await?;
        stale_groups = stale;
        for (id, v) in value["groups"].as_object().ok_or_else(|| invalid("漫画没有返回章节分组"))? {
            if !catalog::valid_id(id) { return Err(invalid("漫画分组 ID 无效")); }
            groups.push(SourceGroup { id: id.clone(), title: v["name"].as_str().unwrap_or(id).into() });
        }
        selected = if group.is_empty() { groups.iter().find(|v| v.id == "default").or_else(|| groups.first()).ok_or_else(|| invalid("漫画尚未提供章节"))?.id.clone() } else { group.into() };
        if !groups.iter().any(|v| v.id == selected) { return Err(invalid("漫画分组已经变化，请刷新")); }
        path = format!("/api/v3/comic/{book}/group/{selected}/chapters");
        params = vec![("limit".into(), "100".into()), ("offset".into(), offset.to_string())];
    }
    let (mut page, stale) = catalog::cached_request_for("copy-reading", pool, host, &path, &params, 1, refresh, |v| {
        let entries = source_entries(&v, kind, book)?;
        let total = v["total"].as_u64().ok_or_else(|| invalid("目录总数缺失"))?;
        if total > 1_000_000 || total < offset as u64 + entries.len() as u64 || (entries.is_empty() && (offset as u64) < total)
            || (kind == "novel" && total != entries.len() as u64) { return Err(invalid("来源返回了不完整目录，请刷新重试")); }
        Ok(SourcePage { entries, total, offset, group: selected.clone(), groups: groups.clone(), stale: false })
    }).await?;
    page.stale = stale || stale_groups;
    Ok(page)
}

#[tauri::command]
pub async fn get_book_reading_source(work_id: String, state: State<'_, AppState>) -> AppResult<Option<Value>> {
    let source: Option<(String, String)> = sqlx::query_as("SELECT w.type,e.external_id FROM works w JOIN work_external_ids e ON e.work_id=w.id WHERE w.id=? AND ((w.type='novel' AND e.provider='copynovel') OR (w.type='comic' AND e.provider='copymanga')) ORDER BY e.created_at LIMIT 1")
        .bind(work_id).fetch_optional(&state.pool).await?;
    Ok(source.map(|(kind, path_word)| serde_json::json!({"kind":kind,"pathWord":path_word})))
}

#[tauri::command]
pub async fn get_book_source_entries(kind: String, path_word: String, group: String, offset: u32, refresh: bool, state: State<'_, AppState>) -> AppResult<SourcePage> {
    directory(&state.pool, &kind, &path_word, &group, offset, refresh).await
}

fn key(root: &Path, kind: &str, book: &str, entry: &str) -> PathBuf {
    let hash = format!("{:x}", Sha256::digest(format!("{kind}\n{book}\n{entry}")));
    root.join("reading-cache").join("v1").join(hash)
}
#[cfg(test)]
fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn regular(path: &Path) -> bool { fs::symlink_metadata(path).is_ok_and(|v| v.file_type().is_file()) }
fn safe_name(name: &str) -> bool { !name.is_empty() && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')) && !name.starts_with('.') }
fn file_hash(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path)?; let mut digest = Sha256::new(); let mut buffer = [0; 64 * 1024];
    loop { let count = file.read(&mut buffer)?; if count == 0 { break; } digest.update(&buffer[..count]); }
    Ok(format!("{:x}", digest.finalize()))
}
fn load(path: &Path, kind: &str, book: &str, entry: &str, verify: bool) -> Option<(Manifest, PathBuf)> {
    let mut versions = fs::read_dir(path).ok()?.filter_map(Result::ok).filter(|v| v.file_type().is_ok_and(|v| v.is_dir()) && v.file_name().to_string_lossy().starts_with("complete-")).collect::<Vec<_>>();
    versions.sort_by_key(|v| v.file_name());
    for version in versions.into_iter().rev() {
        let directory = version.path();
        let manifest_file = directory.join("manifest.json");
        if !regular(&manifest_file) || fs::metadata(&manifest_file).ok()?.len() > 128 * 1024 { continue; }
        let Some(manifest) = fs::read(&manifest_file).ok().and_then(|v| serde_json::from_slice::<Manifest>(&v).ok()) else { continue };
        if manifest.version != 1 || manifest.kind != kind || manifest.book_id != book || manifest.entry_id != entry || !safe_name(&manifest.open_file) || manifest.files.is_empty() || manifest.files.len() > 3 { continue; }
        if !manifest.files.iter().any(|v| v.name == manifest.open_file) { continue; }
        if manifest.files.iter().all(|v| safe_name(&v.name) && regular(&directory.join(&v.name)) && v.bytes <= MAX_CONTENT as u64
            && fs::metadata(directory.join(&v.name)).is_ok_and(|m| m.len() == v.bytes)
            && (!verify || file_hash(&directory.join(&v.name)).is_ok_and(|hash| hash == v.sha256))) {
            return Some((manifest, directory));
        }
    }
    None
}
fn summary(manifest: &Manifest) -> CachedContent {
    CachedContent { entry_id: manifest.entry_id.clone(), title: manifest.title.clone(), format: if manifest.kind == "novel" { "EPUB" } else { "CBZ" }.into(),
        bytes: manifest.files.iter().map(|v| v.bytes).sum(), cached_at: manifest.cached_at.clone() }
}
fn publish(target: &Path, pending: &Path, manifest: &Manifest) -> AppResult<()> {
    let data = serde_json::to_vec(manifest)?;
    let mut file = fs::File::create(pending.join("manifest.json"))?;
    file.write_all(&data)?; file.sync_all()?;
    // Windows cannot rename the staging directory while its manifest is open.
    drop(file);
    fs::rename(pending, target.join(format!("complete-{}-{}", chrono::Utc::now().timestamp_millis(), uuid::Uuid::new_v4())))?;
    Ok(())
}
#[tauri::command]
pub async fn list_cached_book_content(kind: String, path_word: String, entry_ids: Vec<String>, state: State<'_, AppState>) -> AppResult<Vec<CachedContent>> {
    check(&kind, &path_word, None)?;
    if entry_ids.len() > 10_000 { return Err(invalid("缓存查询数量过多")); }
    for id in &entry_ids { check(&kind, &path_word, Some(id))?; }
    let root = state.data_directory.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(entry_ids.iter().filter_map(|id| load(&key(&root, &kind, &path_word, id), &kind, &path_word, id, false).map(|(v, _)| summary(&v))).collect()))
        .await.map_err(|_| invalid("缓存查询失败"))?
}
fn content_url(value: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(value).map_err(|_| invalid("正文地址无效"))?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port_or_known_default() != Some(443)
        || !url.host_str().is_some_and(|v| v.ends_with(".mangafunb.fun")) { return Err(invalid("正文地址不属于受支持的 HTTPS 内容来源")); }
    Ok(url)
}
async fn bytes(client: &reqwest::Client, url: reqwest::Url, limit: usize) -> AppResult<Vec<u8>> {
    let host = url.host_str().unwrap_or_default().to_string();
    for attempt in 0..3 {
        let response = client.get(url.clone()).header("Accept", "*/*").send().await;
        match response {
            Ok(mut response) => {
                let status = response.status();
                if status.is_success() {
                    if response.content_length().is_some_and(|n| n > limit as u64) { return Err(invalid("正文超过单文件大小限制")); }
                    let mut data = vec![]; let mut interrupted = false;
                    loop {
                        match response.chunk().await {
                            Ok(Some(chunk)) => {
                                if chunk.len() > limit.saturating_sub(data.len()) { return Err(invalid("正文超过单文件大小限制")); }
                                data.extend_from_slice(&chunk);
                            }
                            Ok(None) => break,
                            Err(_) => { interrupted = true; break; }
                        }
                    }
                    if !interrupted { return if data.is_empty() { Err(invalid("来源返回空正文")) } else { Ok(data) }; }
                } else if !status.is_server_error() && !matches!(status.as_u16(), 408 | 429) {
                    return Err(AppError::Network(format!("正文暂不可访问（HTTP {}，{host}）；原有缓存保留", status.as_u16())));
                }
            }
            Err(_) => {}
        }
        if attempt < 2 { tokio::time::sleep(Duration::from_millis(if attempt == 0 { 500 } else { 2000 })).await; }
    }
    Err(AppError::Network(format!("正文连接或传输失败（{host}），已重试 3 次；请检查阅读网络设置，原有缓存保留")))
}
fn image_extension(data: &[u8]) -> AppResult<&'static str> {
    let format = image::guess_format(data).map_err(|_| invalid("来源返回的页面不是有效图片"))?;
    let ext = match format { image::ImageFormat::Jpeg => "jpg", image::ImageFormat::Png => "png", image::ImageFormat::WebP => "webp", _ => return Err(invalid("正文图片格式暂不支持")) };
    let reader = image::ImageReader::with_format(std::io::Cursor::new(data), format);
    let (w, h) = reader.into_dimensions().map_err(|_| invalid("正文图片损坏"))?;
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 64_000_000 { return Err(invalid("正文图片尺寸异常")); }
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(data), format);
    let mut limits = image::Limits::default(); limits.max_alloc = Some(256 * 1024 * 1024); reader.limits(limits);
    reader.decode().map_err(|_| invalid("正文图片不完整或损坏"))?;
    Ok(ext)
}
fn access(value: &Value) -> AppResult<()> {
    if value["is_lock"].as_bool() == Some(true) || value["is_lock"].as_u64() == Some(1) { return Err(invalid("来源已锁定该内容，不能获取；请在来源平台检查访问权限")); }
    Ok(())
}
fn text(data: &[u8], encoding: &str) -> AppResult<String> {
    let value = match encoding.trim().to_ascii_lowercase().replace('-', "").as_str() {
        "utf8" => std::str::from_utf8(data).map(str::to_string).map_err(|_| invalid("小说不是有效 UTF-8，未生成乱码文件"))?,
        "gbk" | "gb2312" | "cp936" => encoding_rs::GBK.decode_without_bom_handling_and_without_replacement(data)
            .ok_or_else(|| invalid("小说不是有效 GBK，未生成乱码文件"))?.into_owned(),
        _ => return Err(invalid("来源没有提供受支持的正文编码（UTF-8 / GBK）")),
    };
    let value = value.strip_prefix('\u{feff}').unwrap_or(&value).to_string();
    if value.chars().any(|c| c < '\u{20}' && !matches!(c, '\t' | '\r' | '\n')) { return Err(invalid("小说包含无效控制字符")); }
    if value.trim_start().to_ascii_lowercase().starts_with("<!doctype html") || value.trim_start().to_ascii_lowercase().starts_with("<html") { return Err(invalid("来源返回了网页错误页而非小说正文")); }
    Ok(value)
}
fn lines(text: &str) -> Vec<&str> {
    let mut result = vec![]; let mut start = 0; let data = text.as_bytes(); let mut i = 0;
    while i < data.len() {
        if matches!(data[i], b'\r' | b'\n') { result.push(&text[start..i]); if data[i] == b'\r' && data.get(i + 1) == Some(&b'\n') { i += 1; } start = i + 1; } i += 1;
    }
    result.push(&text[start..]); result
}
fn ranges(contents: &[Value], count: usize) -> AppResult<()> {
    for item in contents {
        if item["content_type"].as_u64() == Some(1) {
            let start = item["start_lines"].as_u64().ok_or_else(|| invalid("章节起始行号缺失"))?;
            let end = item["end_lines"].as_u64().ok_or_else(|| invalid("章节结束行号缺失"))?;
            if start > end || end > count as u64 { return Err(invalid("章节目录与正文行号不匹配")); }
        }
    }
    Ok(())
}
fn xml(value: &str) -> String { value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;") }
fn zip_file(writer: &mut ZipWriter<fs::File>, name: &str, data: &[u8]) -> AppResult<()> {
    writer.start_file(name, SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)).map_err(|_| invalid("无法创建阅读文件"))?;
    writer.write_all(data)?; Ok(())
}

async fn generate<F, Fut>(kind: &str, book: &str, entry: &str, value: &Value, directory: &Path, concurrency: usize, mut fetch: F) -> AppResult<(String, String, Vec<String>)>
where F: FnMut(reqwest::Url, usize) -> Fut, Fut: std::future::Future<Output = AppResult<Vec<u8>>> {
    access(value)?;
    if kind == "comic" {
        let chapter = &value["chapter"];
        if chapter["uuid"].as_str() != Some(entry) { return Err(invalid("漫画章节 ID 不符")); }
        let images = chapter["contents"].as_array().filter(|v| !v.is_empty() && v.len() <= 1000).ok_or_else(|| invalid("来源尚未提供可访问的漫画页面；可能需要来源账号权限"))?;
        if chapter["size"].as_u64().is_some_and(|n| n != images.len() as u64) { return Err(invalid("漫画页面数量不完整")); }
        let mut zip = ZipWriter::new(fs::File::create(directory.join("chapter.cbz"))?);
        let mut size = 0;
        let urls = images.iter().map(|page| content_url(page["url"].as_str().ok_or_else(|| invalid("漫画页面地址缺失"))?)).collect::<AppResult<Vec<_>>>()?;
        let mut pages = stream::iter(urls).map(|url| fetch(url, MAX_IMAGE)).buffered(concurrency.clamp(1, 8));
        let mut index = 0;
        while let Some(result) = pages.next().await {
            let data = result.map_err(|e| AppError::Network(format!("第 {} / {} 页获取失败：{e}", index + 1, images.len())))?;
            size += data.len(); if size > MAX_CONTENT { return Err(invalid("单章超过 512 MiB 限制")); }
            let ext = image_extension(&data)?;
            zip_file(&mut zip, &format!("{:04}.{ext}", index + 1), &data)?;
            index += 1;
        }
        zip.finish().map_err(|_| invalid("无法完成漫画缓存"))?.sync_all()?;
        return Ok((chapter["name"].as_str().unwrap_or(entry).into(), "chapter.cbz".into(), vec!["chapter.cbz".into()]));
    }
    let volume = &value["volume"];
    if value["book"]["path_word"].as_str() != Some(book) || volume["id"].as_str() != Some(entry) || volume["book_path_word"].as_str() != Some(book) { return Err(invalid("小说卷册作品归属不符")); }
    let contents = volume["contents"].as_array().filter(|v| !v.is_empty() && v.len() <= 10_000).ok_or_else(|| invalid("来源尚未提供小说章节目录"))?;
    let raw = fetch(content_url(volume["txt_addr"].as_str().filter(|s| !s.is_empty()).ok_or_else(|| invalid("该卷没有可访问正文；请检查来源账号权限"))?)?, MAX_TEXT).await?;
    let decoded = text(&raw, volume["txt_encoding"].as_str().unwrap_or_default())?;
    let rows = lines(&decoded); ranges(contents, rows.len())?;
    if !contents.iter().any(|v| v["content_type"].as_u64() == Some(1)) { return Err(invalid("小说目录缺少文本章节")); }
    fs::write(directory.join("volume.txt"), decoded.as_bytes())?;
    // Only names/types/ranges are retained, never temporary signed content URLs.
    let toc: Vec<Value> = contents.iter().enumerate().map(|(index, v)| serde_json::json!({"index":index,"name":v["name"],"contentType":v["content_type"],"startLines":v["start_lines"],"endLines":v["end_lines"]})).collect();
    fs::write(directory.join("toc.json"), serde_json::to_vec(&toc)?)?;
    let title = volume["name"].as_str().unwrap_or(entry);
    let mut zip = ZipWriter::new(fs::File::create(directory.join("volume.epub"))?);
    zip_file(&mut zip, "mimetype", b"application/epub+zip")?;
    zip_file(&mut zip, "META-INF/container.xml", br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#)?;
    let mut nav = String::new(); let mut manifest = String::new(); let mut spine = String::new(); let mut size = raw.len();
    let pending = contents.iter().enumerate().map(|(i, item)| {
        let url = if item["content_type"].as_u64() == Some(2) { Some(content_url(item["content"].as_str().ok_or_else(|| invalid("小说插图地址缺失"))?)?) } else { None };
        Ok((i, item.clone(), url))
    }).collect::<AppResult<Vec<_>>>()?;
    let mut sections = stream::iter(pending).map(|(i, item, url)| {
        let download = url.map(|url| fetch(url, MAX_IMAGE));
        async move { (i, item, match download { Some(download) => download.await.map(Some), None => Ok(None) }) }
    }).buffered(concurrency.clamp(1, 4));
    while let Some((i, item, downloaded)) = sections.next().await {
        let name = item["name"].as_str().unwrap_or("未命名目录项");
        let body = match item["content_type"].as_u64() {
            Some(1) => format!("<pre style=\"white-space:pre-wrap;overflow-wrap:anywhere;font:inherit\">{}</pre>", xml(&rows[item["start_lines"].as_u64().unwrap() as usize..item["end_lines"].as_u64().unwrap() as usize].join("\n"))),
            Some(2) => {
                let data = downloaded.map_err(|e| AppError::Network(format!("插图「{name}」获取失败：{e}")))?.ok_or_else(|| invalid("小说插图缺失"))?;
                size += data.len(); if size > MAX_CONTENT { return Err(invalid("单卷超过 512 MiB 限制")); }
                let ext = image_extension(&data)?; let mime = if ext == "jpg" { "jpeg" } else { ext };
                zip_file(&mut zip, &format!("OEBPS/image-{i}.{ext}"), &data)?;
                manifest.push_str(&format!("<item id=\"img{i}\" href=\"image-{i}.{ext}\" media-type=\"image/{mime}\"/>"));
                format!("<img style=\"max-width:100%\" src=\"image-{i}.{ext}\" alt=\"{}\"/>", xml(name))
            }
            _ => "<p>来源提供了暂不支持的目录项，已保留原始位置。</p>".into(),
        };
        let document = format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>{}</title></head><body><h1>{}</h1>{body}</body></html>", xml(name), xml(name));
        size += document.len(); if size > MAX_CONTENT { return Err(invalid("小说章节展开后超过大小限制")); }
        zip_file(&mut zip, &format!("OEBPS/chapter-{i}.xhtml"), document.as_bytes())?;
        manifest.push_str(&format!("<item id=\"c{i}\" href=\"chapter-{i}.xhtml\" media-type=\"application/xhtml+xml\"/>"));
        spine.push_str(&format!("<itemref idref=\"c{i}\"/>"));
        nav.push_str(&format!("<li><a href=\"chapter-{i}.xhtml\">{}</a></li>", xml(name)));
    }
    let nav = format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>目录</title></head><body><nav epub:type=\"toc\"><ol>{nav}</ol></nav></body></html>");
    zip_file(&mut zip, "OEBPS/nav.xhtml", nav.as_bytes())?;
    let opf = format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"book-id\">urn:genzo:copynovel:{book}:{entry}</dc:identifier><dc:title>{}</dc:title><dc:language>zh</dc:language><meta property=\"dcterms:modified\">{}</meta></metadata><manifest><item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>{manifest}</manifest><spine>{spine}</spine></package>", xml(title), chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ"));
    zip_file(&mut zip, "OEBPS/content.opf", opf.as_bytes())?;
    zip.finish().map_err(|_| invalid("无法完成小说缓存"))?.sync_all()?;
    Ok((title.into(), "volume.epub".into(), vec!["volume.epub".into(), "volume.txt".into(), "toc.json".into()]))
}

async fn lock(path: &Path) -> Arc<Mutex<()>> {
    LOCKS.get_or_init(|| Mutex::new(HashMap::new())).lock().await.entry(path.to_path_buf()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
}
async fn source_value(pool: &sqlx::SqlitePool, kind: &str, book: &str, entry: &str, group: &str) -> AppResult<Value> {
    check(kind, book, Some(entry))?;
    let mut offset = 0;
    loop {
        let page = directory(pool, kind, book, group, offset, false).await?;
        if page.entries.iter().any(|v| v.id == entry) { break; }
        offset += page.entries.len() as u32;
        if offset as u64 >= page.total || kind == "novel" { return Err(invalid("章卷不属于当前作品目录，请刷新后重试")); }
    }
    let (host, path) = if kind == "novel" { (catalog::CATALOG_HOST, format!("/api/v3/book/{book}/volume/{entry}")) }
        else { (catalog::DETAIL_HOST, format!("/api/v3/comic/{book}/chapter/{entry}")) };
    catalog::request_in_pool(pool, host, &path, &[("platform".into(), "3".into()), ("in_mainland".into(), "true".into())]).await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineSection { title: String, text: Option<String>, image_url: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineContent { title: String, pages: Vec<String>, sections: Vec<OnlineSection> }
// Reader-independent online data. No CBZ/EPUB generation or reading-cache writes.
#[tauri::command]
pub async fn get_book_online_content(kind: String, path_word: String, entry_id: String, group: String, state: State<'_, AppState>) -> AppResult<OnlineContent> {
    let value = source_value(&state.pool, &kind, &path_word, &entry_id, &group).await?;
    access(&value)?;
    if kind == "comic" {
        let chapter = &value["chapter"];
        if chapter["uuid"].as_str() != Some(&entry_id) || chapter["comic_path_word"].as_str() != Some(&path_word) { return Err(invalid("漫画章节作品归属不符")); }
        let images = chapter["contents"].as_array().filter(|v| !v.is_empty() && v.len() <= 1000).ok_or_else(|| invalid("来源未提供可访问的漫画页面"))?;
        if chapter["size"].as_u64().is_some_and(|n| n != images.len() as u64) { return Err(invalid("漫画页面数量不完整")); }
        let pages = images.iter().map(|v| content_url(v["url"].as_str().ok_or_else(|| invalid("漫画页面地址缺失"))?).map(String::from)).collect::<AppResult<Vec<_>>>()?;
        return Ok(OnlineContent { title: chapter["name"].as_str().unwrap_or(&entry_id).into(), pages, sections: vec![] });
    }
    let volume = &value["volume"];
    if value["book"]["path_word"].as_str() != Some(&path_word) || volume["id"].as_str() != Some(&entry_id) || volume["book_path_word"].as_str() != Some(&path_word) { return Err(invalid("小说卷册作品归属不符")); }
    let contents = volume["contents"].as_array().filter(|v| !v.is_empty() && v.len() <= 10_000).ok_or_else(|| invalid("来源未提供小说章节目录"))?;
    let config = crate::reading_network::load(&state.pool).await?;
    let data = bytes(&config.client(Duration::from_secs(60))?, content_url(volume["txt_addr"].as_str().ok_or_else(|| invalid("来源未提供可访问的正文"))?)?, MAX_TEXT).await?;
    let decoded = text(&data, volume["txt_encoding"].as_str().unwrap_or_default())?;
    let rows = lines(&decoded); ranges(contents, rows.len())?;
    let sections = contents.iter().map(|v| {
        let mut section = OnlineSection { title: v["name"].as_str().unwrap_or("未命名章节").into(), text: None, image_url: None };
        match v["content_type"].as_u64() {
            Some(1) => section.text = Some(rows[v["start_lines"].as_u64().unwrap() as usize..v["end_lines"].as_u64().unwrap() as usize].join("\n")),
            Some(2) => section.image_url = Some(content_url(v["content"].as_str().ok_or_else(|| invalid("插图地址缺失"))?)?.into()),
            _ => section.text = Some("来源提供了暂不支持的目录项。".into()),
        }
        Ok(section)
    }).collect::<AppResult<Vec<_>>>()?;
    Ok(OnlineContent { title: volume["name"].as_str().unwrap_or(&entry_id).into(), pages: vec![], sections })
}
#[tauri::command]
pub async fn get_book_online_image(url: String, state: State<'_, AppState>) -> AppResult<tauri::ipc::Response> {
    let config = crate::reading_network::load(&state.pool).await?;
    let data = bytes(&config.client(Duration::from_secs(60))?, content_url(&url)?, MAX_IMAGE).await?;
    image_extension(&data)?; Ok(tauri::ipc::Response::new(data))
}
#[tauri::command]
pub async fn cache_book_source_content(kind: String, path_word: String, entry_id: String, group: String, refresh: bool, state: State<'_, AppState>) -> AppResult<CachedContent> {
    check(&kind, &path_word, Some(&entry_id))?;
    let started = chrono::Utc::now();
    let target = key(&state.data_directory, &kind, &path_word, &entry_id);
    let mutex = lock(&target).await; let _guard = mutex.lock().await;
    if let Some((manifest, _)) = load(&target, &kind, &path_word, &entry_id, true) {
        if !refresh || chrono::DateTime::parse_from_rfc3339(&manifest.cached_at).is_ok_and(|time| time >= started) { return Ok(summary(&manifest)); }
    }
    let _slot = DOWNLOADS.acquire().await.map_err(|_| invalid("阅读获取队列不可用"))?;
    // Fresh access information for every explicit fetch. Expired signed URLs are never replayed.
    let value = source_value(&state.pool, &kind, &path_word, &entry_id, &group).await?;
    let config = crate::reading_network::load(&state.pool).await?;
    let client = config.client(Duration::from_secs(60))?;
    let concurrency = if kind == "comic" { config.comic_concurrency } else { config.novel_concurrency };
    fs::create_dir_all(&target)?;
    let pending = target.join(format!("pending-{}", uuid::Uuid::new_v4())); fs::create_dir(&pending)?;
    let result = async {
        let (title, open_file, names) = generate(&kind, &path_word, &entry_id, &value, &pending, concurrency, |url, limit| bytes(&client, url, limit)).await?;
        let files = names.into_iter().map(|name| {
            let path = pending.join(&name);
            Ok(CachedFile { bytes: fs::metadata(&path)?.len(), sha256: file_hash(&path)?, name })
        }).collect::<AppResult<Vec<_>>>()?;
        let manifest = Manifest { version: 1, kind, book_id: path_word, entry_id, title, open_file, files, cached_at: chrono::Utc::now().to_rfc3339() };
        publish(&target, &pending, &manifest)?;
        Ok(summary(&manifest))
    }.await;
    // Only this request's generated staging directory is removed. Interrupted staging is never opened.
    if pending.exists() && fs::canonicalize(&pending).is_ok_and(|p| fs::canonicalize(&target).is_ok_and(|t| p.parent() == Some(t.as_path()))) { let _ = fs::remove_dir_all(&pending); }
    result
}

#[tauri::command]
pub async fn open_cached_book_content(kind: String, path_word: String, entry_id: String, folder: bool, state: State<'_, AppState>) -> AppResult<()> {
    check(&kind, &path_word, Some(&entry_id))?;
    let target = key(&state.data_directory, &kind, &path_word, &entry_id);
    let mutex = lock(&target).await; let _guard = mutex.lock().await;
    let (manifest, directory) = load(&target, &kind, &path_word, &entry_id, true).ok_or_else(|| invalid("完整缓存不存在或已损坏，请重新获取"))?;
    let selected: Option<(String, String, Option<String>)> = if folder { None } else {
        let tools: Vec<(String, String, Option<String>, String)> = sqlx::query_as("SELECT executable_path,arguments_template,working_directory,supported_media_types FROM external_tools WHERE is_default=1 ORDER BY updated_at DESC").fetch_all(&state.pool).await?;
        tools.into_iter().find(|(_, _, _, types)| serde_json::from_str::<Vec<String>>(types).is_ok_and(|types| types.iter().any(|v| v == &kind))).map(|(exe, args, cwd, _)| (exe, args, cwd))
    };
    tauri::async_runtime::spawn_blocking(move || {
        if folder { return crate::launcher::open_directory(&directory.to_string_lossy()); }
        let file = directory.join(&manifest.open_file).to_string_lossy().into_owned();
        if let Some((exe, args, cwd)) = selected {
            let folder = directory.to_string_lossy(); let context = crate::launcher::TemplateContext { file: &file, folder: &folder, title: &manifest.title };
            crate::launcher::launch_executable(&exe, &crate::launcher::expand_arguments(&args, &context)?, cwd.as_deref())
        } else { crate::launcher::open_with_system(&file) }
    }).await.map_err(|_| invalid("启动阅读器失败"))?
}

#[tauri::command]
pub async fn clear_cached_book_content(kind: String, path_word: String, entry_id: String, state: State<'_, AppState>) -> AppResult<()> {
    check(&kind, &path_word, Some(&entry_id))?;
    let root = state.data_directory.join("reading-cache").join("v1");
    let target = key(&state.data_directory, &kind, &path_word, &entry_id);
    let mutex = lock(&target).await; let _guard = mutex.lock().await;
    if target.exists() {
        let resolved = fs::canonicalize(&target)?; let parent = fs::canonicalize(root)?;
        if resolved.parent() != Some(parent.as_path()) || fs::symlink_metadata(&target)?.file_type().is_symlink() { return Err(invalid("缓存目录无效，未清理")); }
        fs::remove_dir_all(resolved)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    #[ignore = "explicit live anonymous content check; temporary memory only, no user library"]
    async fn live_anonymous_content_bytes() {
        let client = reqwest::Client::builder().user_agent("COPY/3.0.9").timeout(Duration::from_secs(60)).redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let book = "wuzhizhuanshengdaoleyishijiejiunachuzhenbenshi";
        let value = catalog::request(catalog::CATALOG_HOST, &format!("/api/v3/book/{book}/volume/3792"), &[("in_mainland".into(), "true".into())]).await.unwrap();
        access(&value).unwrap();
        let volume = &value["volume"];
        let data = bytes(&client, content_url(volume["txt_addr"].as_str().unwrap()).unwrap(), MAX_TEXT).await.unwrap();
        eprintln!("novel bytes={}, first={:?}", data.len(), &data[..data.len().min(4)]);
        text(&data, volume["txt_encoding"].as_str().unwrap()).unwrap();
        let root = tempfile::tempdir().unwrap();
        let pool = crate::db::test_pool().await.unwrap();
        let entries = directory(&pool, "novel", book, "", 0, true).await.unwrap();
        assert!(entries.entries.iter().any(|e| e.id == "3792"));
        let (_, file, _) = generate("novel", book, "3792", &value, root.path(), 2, |url, limit| bytes(&client, url, limit)).await.unwrap();
        eprintln!("novel generated bytes={}", fs::metadata(root.path().join(file)).unwrap().len());
        let book = "modujingbingdenuli";
        let value = catalog::request(catalog::DETAIL_HOST, &format!("/api/v3/comic/{book}/chapter/52615840-10a4-11e9-b68d-00163e0ca5bd"), &[("platform".into(), "3".into())]).await.unwrap();
        access(&value).unwrap();
        let data = bytes(&client, content_url(value["chapter"]["contents"][0]["url"].as_str().unwrap()).unwrap(), MAX_IMAGE).await.unwrap();
        image_extension(&data).unwrap();
        eprintln!("comic first page bytes={}", data.len());
        let root = tempfile::tempdir().unwrap();
        let (_, file, _) = generate("comic", book, "52615840-10a4-11e9-b68d-00163e0ca5bd", &value, root.path(), 2, |url, limit| bytes(&client, url, limit)).await.unwrap();
        eprintln!("comic generated bytes={}", fs::metadata(root.path().join(file)).unwrap().len());
    }
    #[test]
    fn strict_encoding_preserves_empty_lines_and_original_toc_indices() {
        let value = text("\u{feff}一\r\n\r\n二\r三\n".as_bytes(), "UTF-8").unwrap();
        assert_eq!(lines(&value), ["一", "", "二", "三", ""]);
        assert_eq!(text(&[0xc4,0xe3,0xba,0xc3], "GB2312").unwrap(), "你好");
        assert!(text(&[0xff], "utf8").is_err()); assert!(text(&[0x81], "gbk").is_err()); assert!(text(b"text", "unknown").is_err());
        assert!(ranges(&[json!({"content_type":1,"start_lines":0,"end_lines":5}), json!({"content_type":999})], 5).is_ok());
        assert!(ranges(&[json!({"content_type":1,"start_lines":0,"end_lines":6})], 5).is_err());
        assert!(ranges(&[json!({"content_type":1,"start_lines":-1,"end_lines":1})], 5).is_err());
        assert!(ranges(&[json!({"content_type":1})], 5).is_err());
        assert!(text(b"<!DOCTYPE html><html>error</html>", "utf8").is_err());
    }
    #[test]
    fn content_addresses_and_locked_responses_fail_closed() {
        for url in ["http://s3.mangafunb.fun/a", "https://127.0.0.1/a", "https://s3.mangafunb.fun.evil.test/a", "https://token@s3.mangafunb.fun/a", "https://s3.mangafunb.fun:444/a"] { assert!(content_url(url).is_err()); }
        assert!(content_url("https://s3.mangafunb.fun/a?signature=temporary").is_ok());
        assert!(access(&json!({"is_lock":true})).is_err()); assert!(access(&json!({"is_lock":1})).is_err());
        assert!(access(&json!({"is_vip":false,"is_login":false,"is_lock":false})).is_ok());
        assert!(image_extension(b"<html>error</html>").is_err());
    }
    #[test]
    fn novel_catalogue_checks_identity_duplicates_and_order() {
        let entry = json!({"id":"v1","name":"第1卷","index":0,"book_path_word":"book"});
        assert_eq!(source_entries(&json!({"list":[entry.clone()]}), "novel", "book").unwrap()[0].id, "v1");
        assert!(source_entries(&json!({"list":[entry.clone()]}), "novel", "other").is_err());
        assert!(source_entries(&json!({"list":[entry.clone(),entry]}), "novel", "book").is_err());
        assert!(check("comic", "../book", Some("v1")).is_err());
    }
    #[test]
    fn staging_wrong_identity_or_corruption_never_becomes_available() {
        let root = tempfile::tempdir().unwrap(); let path = key(root.path(), "novel", "book", "v1");
        let complete = path.join("complete-001"); fs::create_dir_all(&complete).unwrap();
        fs::write(complete.join("volume.epub"), b"valid fixture").unwrap();
        let manifest = Manifest { version:1,kind:"novel".into(),book_id:"book".into(),entry_id:"v1".into(),title:"卷".into(),open_file:"volume.epub".into(),files:vec![CachedFile{name:"volume.epub".into(),bytes:13,sha256:hash(b"valid fixture")}],cached_at:"2026-10-05".into() };
        fs::write(complete.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(load(&path,"novel","book","v1",true).is_some()); assert!(load(&path,"novel","other","v1",true).is_none());
        fs::create_dir_all(path.join("pending-new")).unwrap(); assert!(load(&path,"novel","book","v1",true).is_some());
        fs::write(complete.join("volume.epub"), b"invalid bytes").unwrap(); assert!(load(&path,"novel","book","v1",true).is_none());
    }
    #[test]
    fn generated_cache_is_published_and_readable_on_windows() {
        let root = tempfile::tempdir().unwrap(); let target = key(root.path(), "comic", "book", "c1");
        let pending = target.join("pending-test"); fs::create_dir_all(&pending).unwrap();
        fs::write(pending.join("chapter.cbz"), b"fixture").unwrap();
        let manifest = Manifest {version:1,kind:"comic".into(),book_id:"book".into(),entry_id:"c1".into(),title:"测试章".into(),open_file:"chapter.cbz".into(),files:vec![CachedFile{name:"chapter.cbz".into(),bytes:7,sha256:hash(b"fixture")}],cached_at:chrono::Utc::now().to_rfc3339()};
        publish(&target, &pending, &manifest).unwrap();
        assert!(!pending.exists()); assert!(load(&target,"comic","book","c1",true).is_some());
    }
    fn png() -> Vec<u8> {
        let mut data = std::io::Cursor::new(vec![]);
        image::DynamicImage::new_rgb8(2, 2).write_to(&mut data, image::ImageFormat::Png).unwrap(); data.into_inner()
    }
    fn novel_fixture() -> Value {
        json!({"book":{"path_word":"book"},"is_lock":false,"volume":{"id":"v1","book_path_word":"book","name":"测试卷 & 一", "txt_addr":"https://s3.mangafunb.fun/test.txt","txt_encoding":"UTF-8","contents":[
            {"name":"第一章 & <正文>","content_type":1,"start_lines":0,"end_lines":3},
            {"name":"独立插图","content_type":2,"content":"https://s3.mangafunb.fun/test.png"},
            {"name":"未知目录项","content_type":999},
            {"name":"第二章","content_type":1,"start_lines":3,"end_lines":5}]}})
    }
    #[tokio::test]
    async fn epub_pairs_text_toc_and_illustrations_in_original_order() {
        let root = tempfile::tempdir().unwrap(); let fixture = novel_fixture();
        let (_, file, names) = generate("novel","book","v1",&fixture,root.path(), 2, |url,_| async move {
            Ok(if url.path().ends_with(".png") { png() } else { "一\r\n\r\n二\r三\n".as_bytes().to_vec() })
        }).await.unwrap();
        assert_eq!(file,"volume.epub"); assert_eq!(names.len(),3);
        assert_eq!(fs::read_to_string(root.path().join("volume.txt")).unwrap(), "一\r\n\r\n二\r三\n");
        let toc: Vec<Value> = serde_json::from_slice(&fs::read(root.path().join("toc.json")).unwrap()).unwrap();
        assert_eq!(toc[3]["index"],3); assert!(!fs::read_to_string(root.path().join("toc.json")).unwrap().contains("mangafunb"));
        let mut zip = zip::ZipArchive::new(fs::File::open(root.path().join(file)).unwrap()).unwrap();
        assert_eq!(zip.by_index(0).unwrap().name(), "mimetype");
        let mut chapter = String::new(); zip.by_name("OEBPS/chapter-0.xhtml").unwrap().read_to_string(&mut chapter).unwrap();
        assert!(chapter.contains("第一章 &amp; &lt;正文&gt;")); assert!(chapter.contains("一\n\n二"));
        assert!(zip.by_name("OEBPS/image-1.png").is_ok()); assert!(zip.by_name("OEBPS/chapter-2.xhtml").is_ok());
        let mut opf = String::new(); zip.by_name("OEBPS/content.opf").unwrap().read_to_string(&mut opf).unwrap();
        assert!(opf.contains("<itemref idref=\"c0\"/><itemref idref=\"c1\"/><itemref idref=\"c2\"/><itemref idref=\"c3\"/>"));
        for name in ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/chapter-0.xhtml"] {
            let mut data = String::new(); zip.by_name(name).unwrap().read_to_string(&mut data).unwrap();
            let mut reader = quick_xml::Reader::from_str(&data);
            loop { match reader.read_event() { Ok(quick_xml::events::Event::Eof) => break, Ok(_) => {}, Err(e) => panic!("invalid XML {name}: {e}") } }
        }
    }
    #[tokio::test]
    async fn cbz_preserves_source_page_order_and_rejects_partial_or_wrong_contents() {
        let root = tempfile::tempdir().unwrap();
        let value = json!({"chapter":{"uuid":"c1","name":"测试章","size":2,"contents":[{"url":"https://s3.mangafunb.fun/second.png"},{"url":"https://s3.mangafunb.fun/first.png"}]}});
        let calls = Arc::new(Mutex::new(vec![])); let seen = calls.clone();
        generate("comic","book","c1",&value,root.path(), 2, move |url,_| { let seen=seen.clone(); async move { seen.lock().await.push(url.path().to_string()); Ok(png()) } }).await.unwrap();
        assert_eq!(*calls.lock().await, ["/second.png", "/first.png"]);
        let mut zip = zip::ZipArchive::new(fs::File::open(root.path().join("chapter.cbz")).unwrap()).unwrap();
        assert_eq!(zip.by_index(0).unwrap().name(),"0001.png"); assert_eq!(zip.by_index(1).unwrap().name(),"0002.png");
        assert!(generate("comic","book","wrong",&value,root.path(), 2, |_,_| async { panic!("wrong chapter must not fetch") }).await.is_err());
        let partial = json!({"chapter":{"uuid":"c1","size":3,"contents":[{"url":"https://s3.mangafunb.fun/p.png"}]}});
        assert!(generate("comic","book","c1",&partial,root.path(), 2, |_,_| async { panic!("partial metadata must not fetch") }).await.is_err());
        assert!(generate("novel","wrong","v1",&novel_fixture(),root.path(), 2, |_,_| async { panic!("wrong book must not fetch") }).await.is_err());
    }
    async fn http_response(response: Vec<u8>) -> reqwest::Url {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap(); let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket,_) = listener.accept().await.unwrap(); let mut request = [0;4096]; let n = socket.read(&mut request).await.unwrap();
            let headers=String::from_utf8_lossy(&request[..n]).to_ascii_lowercase();
            assert!(!headers.contains("authorization:")); assert!(!headers.contains("cookie:")); assert!(!headers.contains("source:"));
            socket.write_all(&response).await.unwrap(); socket.shutdown().await.unwrap();
        });
        reqwest::Url::parse(&format!("http://{addr}/content")).unwrap()
    }
    #[tokio::test]
    async fn anonymous_transport_handles_failure_limits_interruptions_and_retry() {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(2)).redirect(reqwest::redirect::Policy::none()).build().unwrap();
        for response in [b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n".to_vec(),
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\n\r\n".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\nx".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nx".to_vec()] {
            assert!(bytes(&client,http_response(response).await,10).await.is_err());
        }
        let url=http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello".to_vec()).await;
        assert_eq!(bytes(&client,url,10).await.unwrap(), b"hello");
        let url=http_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n5\r\nworld\r\n0\r\n\r\n".to_vec()).await;
        assert!(bytes(&client,url,8).await.is_err());
    }
    #[tokio::test]
    async fn transient_content_failure_is_retried_without_credentials() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = reqwest::Url::parse(&format!("http://{}/content", listener.local_addr().unwrap())).unwrap();
        let server = tokio::spawn(async move {
            for response in ["HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello"] {
                let (mut socket, _) = listener.accept().await.unwrap(); let mut request = [0; 4096];
                let count = socket.read(&mut request).await.unwrap(); let headers = String::from_utf8_lossy(&request[..count]).to_ascii_lowercase();
                assert!(!headers.contains("authorization:")); assert!(!headers.contains("cookie:"));
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
        assert_eq!(bytes(&client, url, 10).await.unwrap(), b"hello"); server.await.unwrap();
    }
    #[tokio::test]
    async fn concurrent_images_finish_out_of_order_but_keep_archive_order() {
        let root = tempfile::tempdir().unwrap();
        let value = json!({"chapter":{"uuid":"c1","size":2,"contents":[{"url":"https://s3.mangafunb.fun/slow.png"},{"url":"https://s3.mangafunb.fun/fast.png"}]}});
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let expected = Arc::new([png(), {
            let mut data = std::io::Cursor::new(vec![]);
            image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2,2,image::Rgb([255,0,0]))).write_to(&mut data,image::ImageFormat::Png).unwrap(); data.into_inner()
        }]);
        let images = expected.clone();
        tokio::time::timeout(Duration::from_secs(2), generate("comic","book","c1",&value,root.path(),2,move |url,_| {
            let barrier = barrier.clone(); let images = images.clone();
            async move { barrier.wait().await; let slow = url.path().contains("slow"); if slow { tokio::time::sleep(Duration::from_millis(20)).await; } Ok(images[if slow {0} else {1}].clone()) }
        })).await.unwrap().unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(root.path().join("chapter.cbz")).unwrap()).unwrap();
        for (index, expected) in expected.iter().enumerate() { let mut data = vec![]; zip.by_index(index).unwrap().read_to_end(&mut data).unwrap(); assert_eq!(&data, expected); }
    }
    #[tokio::test]
    async fn interrupted_illustration_never_publishes_a_complete_novel() {
        let root = tempfile::tempdir().unwrap();
        let value = novel_fixture();
        assert!(generate("novel","book","v1",&value,root.path(), 2, |url,_| async move {
            if url.path().ends_with(".png") { Err(AppError::Network("中断".into())) } else { Ok("一\n\n二\n三\n".as_bytes().to_vec()) }
        }).await.is_err());
        assert!(!root.path().join("manifest.json").exists());
    }
}
