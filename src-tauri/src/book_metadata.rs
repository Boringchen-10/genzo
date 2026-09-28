use crate::db::AppState;
use crate::error::{AppError, AppResult};
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;
use zip::ZipArchive;

const MAX_XML_BYTES: u64 = 512 * 1024;
const MAX_COVER_BYTES: u64 = 12 * 1024 * 1024;

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedBookMetadata {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub series: Option<String>,
    pub number: Option<String>,
    pub description: Option<String>,
    pub isbn: Option<String>,
    pub cover_path: Option<String>,
}

fn value(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn attribute(event: &BytesStart<'_>, key: &str) -> Option<String> {
    event.attributes().flatten().find_map(|attribute| {
        (attribute.key.as_ref() == key)
            .then(|| attribute.normalized_value(XmlVersion::Implicit1_0).ok().map(|item| item.into_owned()))
            .flatten()
    })
}

fn xml_fields(xml: &str, epub: bool) -> EmbeddedBookMetadata {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut result = EmbeddedBookMetadata::default();
    let mut current = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event) | Event::Empty(event)) => {
                let name = event.local_name().as_ref().to_string();
                if epub && name == "meta" {
                    let meta_name = attribute(&event, "name");
                    let content = attribute(&event, "content");
                    match meta_name.as_deref() {
                        Some("calibre:series") => result.series = content.and_then(|value| self::value(&value)),
                        Some("calibre:series_index") => result.number = content.and_then(|value| self::value(&value)),
                        _ => {}
                    }
                    if attribute(&event, "property").as_deref() == Some("belongs-to-collection") {
                        current = "series".to_string();
                    }
                } else {
                    current = name;
                }
            }
            Ok(Event::Text(event)) => {
                {
                    let text = event.xml_content(XmlVersion::Implicit1_0);
                    let text = value(&text);
                    match current.as_str() {
                        "Title" | "title" => result.title = result.title.or(text),
                        "Writer" | "creator" => result.creator = result.creator.or(text),
                        "Series" | "series" => result.series = result.series.or(text),
                        "Number" => result.number = result.number.or(text),
                        "Summary" | "description" => result.description = result.description.or(text),
                        "identifier" => result.isbn = result.isbn.or(text.filter(|value| value.chars().filter(|character| character.is_ascii_digit()).count() == 13)),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(_)) => current.clear(),
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    result
}

fn read_member(archive: &mut ZipArchive<File>, name: &str, limit: u64) -> AppResult<Vec<u8>> {
    let member = archive.by_name(name).map_err(|error| AppError::Validation(format!("无法读取书籍元数据：{error}")))?;
    if member.size() > limit {
        return Err(AppError::Validation("书籍内嵌元数据或封面过大".into()));
    }
    let mut bytes = Vec::with_capacity(member.size() as usize);
    member.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(AppError::Validation("书籍内嵌元数据或封面过大".into()));
    }
    Ok(bytes)
}

fn member_names(archive: &mut ZipArchive<File>) -> AppResult<Vec<String>> {
    if archive.len() > 20000 { return Err(AppError::Validation("书籍压缩包条目过多".into())); }
    let mut names = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        names.push(archive.by_index(index).map_err(|error| AppError::Validation(format!("无法读取书籍目录：{error}")))?.name().to_string());
    }
    Ok(names)
}

fn opf_path(container: &str) -> Option<String> {
    let mut reader = Reader::from_str(container);
    loop {
        match reader.read_event() {
            Ok(Event::Start(event) | Event::Empty(event)) if event.local_name().as_ref() == "rootfile" => {
                return attribute(&event, "full-path");
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
    }
}

fn cover_name(names: &[String], epub: bool, opf: Option<&str>) -> Option<String> {
    if epub {
        let base = opf.and_then(|path| path.rsplit_once('/')).map_or("", |(base, _)| base);
        return names.iter().find(|name| {
            let lower = name.to_ascii_lowercase();
            let in_base = base.is_empty() || lower.starts_with(&base.to_ascii_lowercase());
            in_base && lower.contains("cover") && matches!(Path::new(name).extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("jpg" | "jpeg" | "png" | "webp"))
        }).cloned();
    }
    names.iter().filter(|name| matches!(Path::new(name).extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("jpg" | "jpeg" | "png" | "webp")))
        .min_by(|left, right| natord::compare(left, right)).cloned()
}

fn read_local(path: &Path, extension: &str, cache: &Path, media_id: &str) -> AppResult<EmbeddedBookMetadata> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(|error| AppError::Validation(format!("无法打开书籍压缩包：{error}")))?;
    let names = member_names(&mut archive)?;
    let epub = extension.eq_ignore_ascii_case("epub");
    let mut metadata = EmbeddedBookMetadata::default();
    let mut opf = None;
    if epub {
        if let Some(container_name) = names.iter().find(|name| name.eq_ignore_ascii_case("META-INF/container.xml")) {
            let bytes = read_member(&mut archive, container_name, MAX_XML_BYTES)?;
            opf = opf_path(&String::from_utf8_lossy(&bytes));
        }
        if let Some(path) = opf.as_ref().filter(|path| names.contains(path)) {
            let bytes = read_member(&mut archive, path, MAX_XML_BYTES)?;
            metadata = xml_fields(&String::from_utf8_lossy(&bytes), true);
        }
    } else if let Some(name) = names.iter().find(|name| name.rsplit('/').next().is_some_and(|part| part.eq_ignore_ascii_case("ComicInfo.xml"))) {
        let bytes = read_member(&mut archive, name, MAX_XML_BYTES)?;
        metadata = xml_fields(&String::from_utf8_lossy(&bytes), false);
    }
    if let Some(name) = cover_name(&names, epub, opf.as_deref()) {
        let bytes = read_member(&mut archive, &name, MAX_COVER_BYTES)?;
        if image::guess_format(&bytes).is_ok() {
            let digest = format!("{:x}", Sha256::digest(format!("{media_id}:{}:{}", path.display(), name).as_bytes()));
            let extension = Path::new(&name).extension().and_then(|value| value.to_str()).unwrap_or("jpg").to_ascii_lowercase();
            let destination = cache.join(format!("book-{}.{extension}", &digest[..24]));
            if !destination.exists() {
                std::fs::write(&destination, bytes)?;
            }
            metadata.cover_path = Some(destination.to_string_lossy().into_owned());
        }
    }
    Ok(metadata)
}

pub async fn embedded_in_pool(pool: &SqlitePool, cache: &Path, media_file_id: &str) -> AppResult<EmbeddedBookMetadata> {
    let file: Option<(String, String, String)> = sqlx::query_as("SELECT path, extension, media_type FROM media_files WHERE id = ?")
        .bind(media_file_id).fetch_optional(pool).await?;
    let (path, extension, kind) = file.ok_or_else(|| AppError::NotFound("媒体文件不存在".into()))?;
    if !matches!(kind.as_str(), "comic" | "novel") { return Err(AppError::Validation("不是书籍文件".into())); }
    if path.starts_with("webdav://") { return Err(AppError::Validation("远程书籍请先缓存后读取内嵌资料".into())); }
    if !matches!(extension.to_ascii_lowercase().as_str(), "cbz" | "zip" | "epub") {
        return Ok(EmbeddedBookMetadata::default());
    }
    let path = PathBuf::from(path);
    let cache = cache.to_path_buf();
    let id = media_file_id.to_string();
    tokio::task::spawn_blocking(move || read_local(&path, &extension, &cache, &id))
        .await.map_err(|error| AppError::System(format!("无法读取书籍：{error}")))?
}

#[tauri::command]
pub async fn get_embedded_book_metadata(media_file_id: String, state: State<'_, AppState>) -> AppResult<EmbeddedBookMetadata> {
    embedded_in_pool(&state.pool, &state.cover_cache_path, &media_file_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn comic_info_and_opf_metadata() {
        let comic = xml_fields("<ComicInfo><Series>葬送的芙莉莲</Series><Number>02</Number><Title>旅途</Title><Writer>山田</Writer></ComicInfo>", false);
        assert_eq!(comic.series.as_deref(), Some("葬送的芙莉莲"));
        assert_eq!(comic.number.as_deref(), Some("02"));
        let epub = xml_fields("<package><metadata><dc:title>某小说</dc:title><dc:creator>作者</dc:creator><meta name=\"calibre:series\" content=\"系列名\"/><meta name=\"calibre:series_index\" content=\"3\"/></metadata></package>", true);
        assert_eq!(epub.title.as_deref(), Some("某小说"));
        assert_eq!(epub.series.as_deref(), Some("系列名"));
        assert_eq!(epub.number.as_deref(), Some("3"));
    }

    #[test]
    fn reads_embedded_comic_info_and_cover_without_extracting_media() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("volume.cbz");
        let file = File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        archive.start_file("ComicInfo.xml", options).unwrap();
        archive.write_all("<ComicInfo><Series>系列</Series><Number>2</Number><Title>第二卷</Title></ComicInfo>".as_bytes()).unwrap();
        archive.start_file("001.png", options).unwrap();
        let mut image = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1).write_to(&mut image, image::ImageFormat::Png).unwrap();
        archive.write_all(image.get_ref()).unwrap();
        archive.finish().unwrap();
        let metadata = read_local(&archive_path, "cbz", directory.path(), "media-1").unwrap();
        assert_eq!(metadata.series.as_deref(), Some("系列"));
        assert_eq!(metadata.number.as_deref(), Some("2"));
        assert!(Path::new(metadata.cover_path.as_deref().unwrap()).is_file());
        assert!(!directory.path().join("001.png").exists());
    }
}
