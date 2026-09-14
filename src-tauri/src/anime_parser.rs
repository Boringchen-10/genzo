use serde::Serialize;
use std::path::Path;
use strsim::normalized_levenshtein;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParsedAnime {
    pub raw_file_name: String,
    pub title: Option<String>,
    pub original_title: Option<String>,
    pub season: Option<i64>,
    pub episode: Option<String>,
    pub year: Option<i64>,
    pub release_group: Option<String>,
    pub special_type: Option<String>,
    pub media_info: Vec<String>,
}

const TECH_TOKENS: &[&str] = &[
    "480p",
    "576p",
    "720p",
    "1080p",
    "2160p",
    "4k",
    "8k",
    "x264",
    "x265",
    "h264",
    "h265",
    "hevc",
    "av1",
    "10bit",
    "8bit",
    "aac",
    "flac",
    "opus",
    "web-dl",
    "webrip",
    "bluray",
    "bdrip",
    "remux",
    "proper",
    "repack",
    "dual audio",
    "multi audio",
    "中字",
    "简中",
    "繁中",
    "字幕",
    "外挂",
    "内封",
];

fn clean_token(value: &str) -> String {
    value
        .trim_matches(|c: char| c.is_whitespace() || "[](){}".contains(c))
        .trim()
        .to_string()
}

pub fn normalize_title(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut last_space = false;
    for ch in value.chars() {
        let mapped = match ch {
            '\u{3000}' => ' ',
            '：' => ':',
            '－' | '–' | '—' => '-',
            '（' => '(',
            '）' => ')',
            '\u{FF01}'..='\u{FF5E}' => char::from_u32(ch as u32 - 0xFEE0).unwrap_or(ch),
            _ => ch,
        };
        if mapped.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
        } else if ",.!?".contains(mapped) {
            last_space = false;
        } else {
            out.push(mapped.to_ascii_lowercase());
            last_space = false;
        }
    }
    out.trim().to_string()
}

pub fn parse_file_name(file_name: &str) -> ParsedAnime {
    let raw = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let mut parsed = ParsedAnime {
        raw_file_name: file_name.to_string(),
        ..Default::default()
    };
    let mut text = raw
        .replace(['_', '.'], " ")
        .replace('【', "[")
        .replace('】', "]");
    while let Some(start) = text.find('[') {
        let Some(end_rel) = text[start + 1..].find(']') else {
            break;
        };
        let end = start + end_rel + 1;
        let token = clean_token(&text[start + 1..end]);
        if !token.is_empty() {
            if token.chars().all(|c| c.is_ascii_digit()) && token.len() == 4 {
                parsed.year = token.parse().ok();
            } else if is_media_token(&token) {
                parsed.media_info.push(token.clone());
            } else if parsed.release_group.is_none() && start == 0 {
                parsed.release_group = Some(token.clone());
            }
        }
        text.replace_range(start..=end, " ");
    }
    let lowered = text.to_ascii_lowercase();
    for marker in ["ncop", "nced", "ova", "oad", "special", "sp", "movie"] {
        if lowered.split_whitespace().any(|word| word == marker) {
            parsed.special_type = Some(marker.to_uppercase());
        }
    }
    if text.contains("劇場版") || text.contains("剧场版") || text.contains("映画") {
        parsed.special_type = Some("MOVIE".to_string());
    }
    let season_re = regex::Regex::new(r"(?i)\bS(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b")
        .expect("static regex");
    if let Some(caps) = season_re.captures(&text) {
        parsed.season = caps
            .get(1)
            .or_else(|| caps.get(2))
            .and_then(|m| m.as_str().parse().ok());
        text = season_re.replace_all(&text, " ").to_string();
    }
    let collection_count_re = regex::Regex::new(
        r"(?i)(?:全\s*\d{1,4}\s*[集话]|\d{1,4}\s*[集话]\s*(?:全|完)|complete\s*series)",
    )
    .expect("static regex");
    text = collection_count_re.replace_all(&text, " ").to_string();
    let episode_re = regex::Regex::new(
        r"(?i)(?:^|\s|[-])(?:EP?|#)?\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?(?:\s|$)",
    )
    .expect("static regex");
    if let Some(caps) = episode_re.captures_iter(&text).last() {
        parsed.episode = caps.get(1).map(|start| match caps.get(2) {
            Some(end) => format!("{}-{}", start.as_str(), end.as_str()),
            None => start.as_str().to_string(),
        });
        if let Some(range) = caps.get(0) {
            text.replace_range(range.start()..range.end(), " ");
        }
    }
    text = regex::Regex::new(r"\s+")
        .expect("static regex")
        .replace_all(&text, " ")
        .to_string();
    let title = text.trim().trim_matches('-').trim();
    let title = clean_token(title);
    if !title.is_empty() {
        parsed.title = Some(title);
    }
    parsed
}

pub fn parse_folder_name(folder_name: &str) -> ParsedAnime {
    parse_file_name(folder_name)
}

fn is_media_token(token: &str) -> bool {
    let lowered = token.to_ascii_lowercase();
    TECH_TOKENS.iter().any(|item| {
        lowered == *item
            || (!matches!(*item, "字幕" | "中字" | "简中" | "繁中") && lowered.contains(item))
    })
}

pub fn score_candidate(
    query: &ParsedAnime,
    title: &str,
    aliases: &[String],
    year: Option<i64>,
    candidate_season: Option<i64>,
) -> (f64, Vec<String>) {
    let q = normalize_title(query.title.as_deref().unwrap_or_default());
    let mut best = normalized_levenshtein(&q, &normalize_title(title));
    for alias in aliases {
        best = best.max(normalized_levenshtein(&q, &normalize_title(alias)));
    }
    let mut reasons = vec![format!("标题相似度 {:.0}%", best * 100.0)];
    let mut score = best * 0.82;
    if query.year.is_some() && query.year == year {
        score += 0.10;
        reasons.push("年份一致".to_string());
    }
    if query.season.is_some() && query.season == candidate_season {
        score += 0.08;
        reasons.push("季度一致".to_string());
    }
    if query.special_type.is_some() {
        score = score.min(0.89);
        reasons.push("特别篇或剧场版需确认".to_string());
    }
    (score.min(1.0), reasons)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_release_name() {
        let p = parse_file_name("[字幕组] 进击的巨人 S2 - 01 [1080p].mkv");
        assert_eq!(p.title.as_deref(), Some("进击的巨人"));
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode.as_deref(), Some("01"));
        assert_eq!(p.release_group.as_deref(), Some("字幕组"));
    }
    #[test]
    fn parses_japanese_and_special() {
        let p = parse_file_name("[Group] 劇場版 Fate stay night [1080p].mkv");
        assert_eq!(p.special_type.as_deref(), Some("MOVIE"));
    }
    #[test]
    fn normalizes_full_width() {
        assert_eq!(normalize_title("  ＡＢＣ：测试　"), "abc:测试");
    }
    #[test]
    fn scores_alias_and_season() {
        let q = parse_file_name("Show S2 01.mkv");
        let (s, reasons) = score_candidate(&q, "Show", &[], None, Some(2));
        assert!(s > 0.8);
        assert!(reasons.iter().any(|r| r.contains("季度")));
    }
    #[test]
    fn preserves_digits_colons_and_hyphens() {
        let p = parse_file_name("86 -Eighty Six- - 02 [1080p].mkv");
        assert_eq!(p.title.as_deref(), Some("86 -Eighty Six"));
    }
    #[test]
    fn parses_romanized_ova() {
        let p = parse_file_name("[Group] Steins Gate OVA - 01.mkv");
        assert_eq!(p.title.as_deref(), Some("Steins Gate OVA"));
        assert_eq!(p.special_type.as_deref(), Some("OVA"));
    }
    #[test]
    fn leaves_unparseable_empty() {
        assert!(parse_file_name("[1080p].mkv").title.is_none());
    }

    #[test]
    fn removes_complete_collection_count_from_folder_title() {
        let p = parse_folder_name("【 4K 】Q 亲吻姐姐 12集全");
        assert_eq!(p.title.as_deref(), Some("Q 亲吻姐姐"));
        assert!(p.episode.is_none());
    }

    #[test]
    fn stores_episode_ranges_without_separator_noise() {
        let p = parse_file_name("Show - 01-12 [1080p].mkv");
        assert_eq!(p.episode.as_deref(), Some("01-12"));
    }
}
