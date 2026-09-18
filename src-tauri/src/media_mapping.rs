use crate::anime_parser::{normalize_title, parse_file_name, parse_media_path};
use crate::error::AppResult;
use crate::models::MediaFile;
use chrono::Utc;
use sqlx::{Sqlite, Transaction};
use std::path::Path;

const MEDIA_COLUMNS: &str = "id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path";

#[derive(Debug, Clone, PartialEq, Eq)]
struct SubtitleMatch {
    subtitle_id: String,
    video_id: String,
    episode: Option<String>,
    method: &'static str,
}

fn is_subtitle(file: &MediaFile) -> bool {
    matches!(
        file.extension.to_ascii_lowercase().as_str(),
        "ass" | "ssa" | "srt" | "vtt" | "sub"
    )
}

fn normalized_episode(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let mut parts = value.splitn(2, '-');
    let start = parts.next()?.trim().parse::<u32>().ok()?;
    Some(
        match parts.next().and_then(|end| end.trim().parse::<u32>().ok()) {
            Some(end) => format!("{start}-{end}"),
            None => start.to_string(),
        },
    )
}

fn normalized_stem(file: &MediaFile) -> String {
    let stem = Path::new(&file.file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&file.file_name);
    normalize_title(stem)
}

fn same_installment(left: &MediaFile, right: &MediaFile) -> bool {
    let left = parse_media_path(&left.file_name, Path::new(&left.path), None);
    let right = parse_media_path(&right.file_name, Path::new(&right.path), None);
    left.season.unwrap_or(1) == right.season.unwrap_or(1) && left.special_type == right.special_type
}

fn choose_subtitle_matches(files: &[MediaFile]) -> Vec<SubtitleMatch> {
    let videos: Vec<_> = files
        .iter()
        .filter(|file| file.media_type == "video" && !file.missing)
        .collect();
    let subtitles: Vec<_> = files
        .iter()
        .filter(|file| is_subtitle(file) && !file.missing)
        .collect();
    let subtitle_count = subtitles.len();
    let mut matches = Vec::new();

    for subtitle in subtitles {
        let subtitle_episode = normalized_episode(subtitle.parsed_episode.as_deref());
        let mut candidates: Vec<_> = videos
            .iter()
            .copied()
            .filter(|video| {
                same_installment(subtitle, video)
                    && subtitle_episode.is_some()
                    && normalized_episode(video.parsed_episode.as_deref()) == subtitle_episode
            })
            .collect();

        let (video, method) = if candidates.len() == 1 {
            (candidates.remove(0), "episode")
        } else if let Some(video) = videos.iter().copied().find(|video| {
            same_installment(subtitle, video) && normalized_stem(video) == normalized_stem(subtitle)
        }) {
            (video, "file_name")
        } else if videos.len() == 1 && subtitle_count == 1 && same_installment(subtitle, videos[0])
        {
            (videos[0], "single_file")
        } else {
            continue;
        };

        matches.push(SubtitleMatch {
            subtitle_id: subtitle.id.clone(),
            video_id: video.id.clone(),
            episode: subtitle_episode,
            method,
        });
    }
    matches
}

pub async fn rebuild_subtitle_links(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
) -> AppResult<()> {
    let mut files = sqlx::query_as::<_, MediaFile>(&format!(
        "SELECT {MEDIA_COLUMNS} FROM media_files WHERE work_id = ?"
    ))
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?;
    for file in &mut files {
        if file.parsed_title.is_none() || file.parsed_episode.is_none() {
            let parsed = parse_file_name(&file.file_name);
            if file.parsed_title.is_none() {
                file.parsed_title = parsed.title;
            }
            if file.parsed_season.is_none() {
                file.parsed_season = parsed.season;
            }
            if file.parsed_episode.is_none() {
                file.parsed_episode = parsed.episode;
            }
            sqlx::query("UPDATE media_files SET parsed_title = ?, parsed_season = ?, parsed_episode = ?, updated_at = ? WHERE id = ?")
                .bind(&file.parsed_title)
                .bind(file.parsed_season)
                .bind(&file.parsed_episode)
                .bind(Utc::now().to_rfc3339())
                .bind(&file.id)
                .execute(&mut **transaction)
                .await?;
        }
    }
    let matches = choose_subtitle_matches(&files);
    let now = Utc::now().to_rfc3339();

    sqlx::query("DELETE FROM subtitle_links WHERE work_id = ?")
        .bind(work_id)
        .execute(&mut **transaction)
        .await?;
    for matched in matches {
        sqlx::query("INSERT INTO subtitle_links (subtitle_media_file_id, video_media_file_id, work_id, episode, match_method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(matched.subtitle_id)
            .bind(matched.video_id)
            .bind(work_id)
            .bind(matched.episode)
            .bind(matched.method)
            .bind(&now)
            .bind(&now)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn media(id: &str, name: &str, extension: &str, media_type: &str, episode: &str) -> MediaFile {
        MediaFile {
            id: id.to_string(),
            work_id: Some("work".to_string()),
            library_root_id: None,
            path: format!("C:\\Anime\\{name}"),
            file_name: name.to_string(),
            extension: extension.to_string(),
            media_type: media_type.to_string(),
            size: 0,
            modified_at: None,
            missing: false,
            created_at: String::new(),
            updated_at: String::new(),
            recognition_status: "matched".to_string(),
            parsed_title: Some("Kiss x Sis".to_string()),
            parsed_original_title: None,
            parsed_season: Some(1),
            parsed_episode: Some(episode.to_string()),
            parsed_episode_start: episode.parse().ok(),
            parsed_episode_end: None,
            parsed_year: None,
            parsed_release_group: None,
            parsed_special_type: None,
            parsed_media_info: "[]".to_string(),
            last_recognized_at: None,
            recognition_error: None,
            content_fingerprint: None,
            thumbnail_path: None,
        }
    }

    #[test]
    fn links_subtitles_in_a_separate_folder_by_episode() {
        let files = vec![
            media("v1", "Kiss x Sis - 01.mkv", "mkv", "video", "01"),
            media("v2", "Kiss x Sis - 02.mkv", "mkv", "video", "02"),
            media("s1", "Kiss x Sis - 01.ass", "ass", "other", "01"),
            media("s2", "Kiss x Sis - 02.ass", "ass", "other", "02"),
        ];
        let matches = choose_subtitle_matches(&files);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].video_id, "v1");
        assert_eq!(matches[1].video_id, "v2");
        assert!(matches.iter().all(|item| item.method == "episode"));
    }

    #[test]
    fn does_not_guess_when_multiple_videos_are_ambiguous() {
        let files = vec![
            media("v1", "disc-a.mkv", "mkv", "video", "01"),
            media("v2", "disc-b.mkv", "mkv", "video", "01"),
            media("s1", "subtitle.ass", "ass", "other", "01"),
        ];
        assert!(choose_subtitle_matches(&files).is_empty());
    }

    #[tokio::test]
    async fn persists_episode_links_for_a_work() {
        let pool = db::test_pool().await.expect("create database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', 'Kiss x Sis', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert work");
        for (id, path, name, extension, media_type) in [
            (
                "video",
                "C:\\Anime\\video\\Kiss x Sis - 01.mkv",
                "Kiss x Sis - 01.mkv",
                "mkv",
                "video",
            ),
            (
                "subtitle",
                "C:\\Anime\\subtitle\\Kiss x Sis - 01.ass",
                "Kiss x Sis - 01.ass",
                "ass",
                "other",
            ),
        ] {
            sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'work', ?, ?, ?, ?, ?, ?)")
                .bind(id).bind(path).bind(name).bind(extension).bind(media_type).bind(&now).bind(&now)
                .execute(&pool).await.expect("insert media");
        }
        let mut transaction = pool.begin().await.expect("begin transaction");
        rebuild_subtitle_links(&mut transaction, "work")
            .await
            .expect("rebuild links");
        transaction.commit().await.expect("commit");

        let linked: (String, String, Option<String>) = sqlx::query_as("SELECT subtitle_media_file_id, video_media_file_id, episode FROM subtitle_links WHERE work_id = 'work'")
            .fetch_one(&pool).await.expect("read link");
        assert_eq!(linked.0, "subtitle");
        assert_eq!(linked.1, "video");
        assert_eq!(linked.2.as_deref(), Some("1"));
    }
}
