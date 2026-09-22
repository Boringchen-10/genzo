use anitomy_ng::{parse as anitomy_parse, ElementKind, Options as AnitomyOptions};
use serde::Serialize;
use std::path::Path;
use strsim::jaro_winkler;

macro_rules! cached_regex {
    ($pattern:expr $(,)?) => {{
        static REGEX: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        REGEX.get_or_init(|| regex::Regex::new($pattern).expect("static regex"))
    }};
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParsedAnime {
    pub raw_file_name: String,
    pub title: Option<String>,
    pub original_title: Option<String>,
    pub season: Option<i64>,
    pub episode: Option<String>,
    pub episode_start: Option<u32>,
    pub episode_end: Option<u32>,
    pub year: Option<i64>,
    pub release_group: Option<String>,
    pub special_type: Option<String>,
    pub media_info: Vec<String>,
    /// An ambiguous descending range must not be reinterpreted by a fallback parser.
    #[serde(skip)]
    pub(crate) invalid_episode_range: bool,
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
    parse_numeric_episode(raw, &mut parsed);
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
    let combined = cached_regex!(r"(?i)\bS(\d{1,2})E(\d{1,4})\b");
    if let Some(caps) = combined.captures(&text) {
        parsed.season = caps[1].parse().ok();
        set_episode_range(&mut parsed, caps[2].parse().ok(), None);
        text = combined.replace_all(&text, " ").to_string();
    }
    let chinese_season = cached_regex!(r"第([一二三四五六七八九十\d]+)季");
    if let Some(caps) = chinese_season.captures(&text) {
        parsed.season = chinese_season_number(&caps[1]);
        text = chinese_season.replace_all(&text, " ").to_string();
    }
    let season_re = cached_regex!(
        r"(?i)\bS(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b|\bseason\s*(\d{1,2})\b"
    );
    if let Some(caps) = season_re.captures(&text) {
        parsed.season = caps
            .get(1)
            .or_else(|| caps.get(2))
            .or_else(|| caps.get(3))
            .and_then(|m| m.as_str().parse().ok());
        text = season_re.replace_all(&text, " ").to_string();
    }
    let collection_count_re = cached_regex!(
        r"(?i)(?:全\s*\d{1,4}\s*[集话]|\d{1,4}\s*[集话]\s*(?:全|完)|complete\s*series)"
    );
    text = collection_count_re.replace_all(&text, " ").to_string();
    let episode_re =
        cached_regex!(r"(?i)(?:^|\s|[-])(?:EP?|#)?\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?(?:\s|$)");
    if let Some(caps) = episode_re.captures_iter(&text).last() {
        set_episode_range(
            &mut parsed,
            caps.get(1).and_then(|value| value.as_str().parse().ok()),
            caps.get(2).and_then(|value| value.as_str().parse().ok()),
        );
        if let Some(range) = caps.get(0) {
            text.replace_range(range.start()..range.end(), " ");
        }
    }
    text = cached_regex!(r"\s+").replace_all(&text, " ").to_string();
    let anitomy = anitomy_elements(raw);
    merge_anitomy(&mut parsed, &anitomy, false);
    let title = clean_token(text.trim().trim_matches('-').trim());
    if !title.is_empty() {
        parsed.title = parsed.title.or(Some(title));
    }
    parsed
}

pub fn parse_folder_name(folder_name: &str) -> ParsedAnime {
    let cleaned = preprocess_folder_name(folder_name);
    let mut parsed = parse_file_name(&cleaned);
    let elements = anitomy_elements(&cleaned);
    merge_anitomy(&mut parsed, &elements, true);
    parsed.raw_file_name = folder_name.to_string();
    if parsed.title.is_none() && !cleaned.is_empty() {
        parsed.title = Some(cleaned);
    }
    parsed
}

fn chinese_season_number(value: &str) -> Option<i64> {
    if let Ok(number) = value.parse() {
        return Some(number);
    }
    let digit = |ch| {
        "一二三四五六七八九"
            .chars()
            .position(|n| n == ch)
            .map(|n| n as i64 + 1)
    };
    if let Some((tens, units)) = value.split_once('十') {
        let tens = if tens.is_empty() {
            Some(1)
        } else {
            tens.chars().next().and_then(digit)
        }?;
        let units = if units.is_empty() {
            Some(0)
        } else {
            units.chars().next().and_then(digit)
        }?;
        Some(tens * 10 + units)
    } else {
        value.chars().next().and_then(digit)
    }
}

/// Keeps the nearest season/special marker while looking past container folders.
pub fn parse_work_folder(file_path: &Path, library_root: Option<&Path>) -> ParsedAnime {
    let mut fallback = ParsedAnime::default();
    let mut season = None;
    let mut special_type = None;
    for directory in file_path.ancestors().skip(1) {
        let Some(name) = directory.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let mut candidate = parse_folder_name(name);
        season = season.or(candidate.season);
        special_type = special_type.or(candidate.special_type.clone());
        candidate.season = season;
        candidate.special_type = special_type.clone();
        if fallback.title.is_none() {
            fallback = candidate.clone();
        }
        if !is_division_folder(name) {
            return candidate;
        }
        if library_root.is_some_and(|root| directory == root) {
            break;
        }
    }
    fallback
}

pub fn parse_media_path(file_name: &str, path: &Path, library_root: Option<&Path>) -> ParsedAnime {
    let mut parsed = parse_file_name(file_name);
    let folder = parse_work_folder(path, library_root);
    if parsed
        .title
        .as_deref()
        .is_none_or(|title| !title.chars().any(char::is_alphabetic) || is_division_folder(title))
    {
        parsed.title = folder.title;
    }
    parsed.season = parsed.season.or(folder.season);
    parsed.special_type = parsed.special_type.or(folder.special_type);
    parsed.year = parsed.year.or(folder.year);
    parsed
}

pub fn preprocess_folder_name(value: &str) -> String {
    let bracketed = cached_regex!(r"\[[^\]]*\]|【[^】]*】|\([^)]*\)|（[^）]*）");
    let suffix = cached_regex!(
        r"(?i)(?:全\s*\d{1,4}\s*[集话]|\d{1,4}\s*[集话]\s*(?:全|完)|全集|高清|超清|1080p|2160p|4k|内嵌字幕|蓝光|bdrip)\s*$"
    );
    let separators = cached_regex!(r"[\s._\-—–]+$");
    let spaces = cached_regex!(r"\s+");
    let mut cleaned = bracketed.replace_all(value, " ").to_string();
    loop {
        let next = suffix.replace(&cleaned, "").to_string();
        if next == cleaned {
            break;
        }
        cleaned = next;
    }
    cleaned = separators.replace_all(cleaned.trim(), "").to_string();
    spaces.replace_all(cleaned.trim(), " ").to_string()
}

fn is_division_folder(value: &str) -> bool {
    cached_regex!(r"(?i)^(?:season\s*\d{0,2}|s\d{1,2}|第[一二三四五六七八九十\d]+季|vol\.?\s*\d+|bd|dvd|disc\s*\d*|sp|ova|oad|特别篇|劇場版|剧场版|特典|video|videos|subtitle|subtitles|视频|字幕)$")
    .is_match(value.trim())
}

fn anitomy_elements(input: &str) -> Vec<anitomy_ng::Element> {
    anitomy_parse(input, AnitomyOptions::default())
}

fn merge_anitomy(parsed: &mut ParsedAnime, elements: &[anitomy_ng::Element], prefer_title: bool) {
    for element in elements {
        match element.kind {
            ElementKind::Title if prefer_title || parsed.title.is_none() => {
                let title = clean_token(&element.value);
                if !title.is_empty() {
                    parsed.title = Some(title);
                }
            }
            ElementKind::Season if parsed.season.is_none() => {
                parsed.season = element.value.parse().ok();
            }
            ElementKind::Episode if parsed.episode_start.is_none() => {
                let mut values = element.value.split(['-', '~']);
                let start = values.next().and_then(|value| value.trim().parse().ok());
                let end = values.next().and_then(|value| value.trim().parse().ok());
                set_episode_range(parsed, start, end);
            }
            ElementKind::Year if parsed.year.is_none() => parsed.year = element.value.parse().ok(),
            ElementKind::ReleaseGroup if parsed.release_group.is_none() => {
                parsed.release_group = Some(element.value.clone());
            }
            ElementKind::Type if parsed.special_type.is_none() => {
                let kind = element.value.to_ascii_uppercase();
                if matches!(kind.as_str(), "SP" | "OVA" | "OAD" | "MOVIE") {
                    parsed.special_type = Some(kind);
                }
            }
            _ => {}
        }
    }
}

fn parse_numeric_episode(raw_stem: &str, parsed: &mut ParsedAnime) {
    let numeric = cached_regex!(r"^(\d{1,3})$");
    let prefixed = cached_regex!(r"(?i)(?:EP|E|第|话|話|集)\s*(\d{1,3})");
    // Before season tokens are removed, only inspect standalone/bracketed
    // ranges. Otherwise "S2 - 01" or "Season 3 - 01" looks like 2-1/3-1.
    // Unbracketed title ranges are handled after season removal above.
    let range = cached_regex!(r"(?:^|[\[【(])\s*(\d{1,3})\s*[-~]\s*(\d{1,3})(?:\s*[\]】)]|\s*$)");
    if let Some(captures) = numeric.captures(raw_stem.trim()) {
        set_episode_range(
            parsed,
            captures
                .get(1)
                .and_then(|value| value.as_str().parse().ok()),
            None,
        );
    } else if let Some(captures) = prefixed.captures(raw_stem) {
        set_episode_range(
            parsed,
            captures
                .get(1)
                .and_then(|value| value.as_str().parse().ok()),
            None,
        );
    } else if let Some(captures) = range.captures(raw_stem) {
        set_episode_range(
            parsed,
            captures
                .get(1)
                .and_then(|value| value.as_str().parse().ok()),
            captures
                .get(2)
                .and_then(|value| value.as_str().parse().ok()),
        );
    }
}

fn set_episode_range(parsed: &mut ParsedAnime, start: Option<u32>, end: Option<u32>) {
    if parsed.invalid_episode_range {
        return;
    }
    let Some(start) = start else {
        return;
    };
    if end.is_some_and(|end| end < start) {
        parsed.episode = None;
        parsed.episode_start = None;
        parsed.episode_end = None;
        parsed.invalid_episode_range = true;
        return;
    }
    parsed.episode_start = Some(start);
    parsed.episode_end = end;
    parsed.episode = Some(match end {
        Some(end) => format!("{start}-{end}"),
        None => start.to_string(),
    });
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
    let normalized_title = normalize_title(title);
    let title_exact = !q.is_empty() && q == normalized_title;
    let title_similarity = jaro_winkler(&q, &normalized_title);
    let alias_exact = aliases.iter().any(|alias| normalize_title(alias) == q);
    let alias_similarity = aliases
        .iter()
        .map(|alias| jaro_winkler(&q, &normalize_title(alias)))
        .fold(0.0, f64::max);
    let best = title_similarity.max(alias_similarity);
    let mut reasons = if title_exact {
        vec!["标题完全匹配".to_string()]
    } else {
        vec![format!("标题相似度 {:.0}%", best * 100.0)]
    };
    let mut score = if title_exact { 1.0 } else { best * 0.60 };
    if alias_exact {
        score += 0.20;
        reasons.push("别名完全匹配".to_string());
    }
    if query.year.is_some() && query.year == year {
        score += 0.15;
        reasons.push("年份一致".to_string());
    }
    if query.season.is_some() && query.season == candidate_season {
        score += 0.15;
        reasons.push("季度一致".to_string());
    }
    if query.special_type.is_some() {
        score = score.min(0.79);
        reasons.push("特别篇或剧场版需确认".to_string());
    }
    (score.min(1.0), reasons)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descending_ranges_remain_unverified_instead_of_guessing_or_violating_db_constraints() {
        for name in [
            "Example - 12-01.mkv",
            "Example - 24~13.mkv",
            "[Group] Example [12-01] [1080p].mkv",
        ] {
            let parsed = parse_file_name(name);
            assert!(parsed.invalid_episode_range, "{name}: {parsed:?}");
            assert_eq!(parsed.episode_start, None, "{name}");
            assert_eq!(parsed.episode_end, None, "{name}");
            assert_eq!(parsed.episode, None, "{name}");
        }
        let mut parsed = ParsedAnime::default();
        set_episode_range(&mut parsed, Some(24), Some(1));
        set_episode_range(&mut parsed, Some(24), None);
        assert_eq!(parsed.episode_start, None);
    }

    #[test]
    fn episode_range_order_is_safe_for_every_numeric_pair() {
        for start in [0, 1, 12, 24, 1080, u32::MAX] {
            for end in [0, 1, 12, 24, 1080, u32::MAX] {
                let mut parsed = ParsedAnime::default();
                set_episode_range(&mut parsed, Some(start), Some(end));
                if end < start {
                    assert_eq!((parsed.episode_start, parsed.episode_end), (None, None));
                } else {
                    assert_eq!(
                        (parsed.episode_start, parsed.episode_end),
                        (Some(start), Some(end))
                    );
                }
            }
        }
    }
    #[test]
    fn parses_release_name() {
        let p = parse_file_name("[字幕组] 进击的巨人 S2 - 01 [1080p].mkv");
        assert_eq!(p.title.as_deref(), Some("进击的巨人"));
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode_start, Some(1));
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
        assert_eq!(p.episode_start, Some(1));
        assert_eq!(p.episode_end, Some(12));
    }

    #[test]
    fn finds_work_folder_above_video_container_for_numeric_episode() {
        let path = Path::new(r"G:\影音\【 4K 】Q 亲吻姐姐 12集全\视频\01.mkv");
        let parsed = parse_work_folder(path, Some(Path::new(r"G:\影音")));
        assert_eq!(parsed.title.as_deref(), Some("Q 亲吻姐姐"));
        let episode = parse_file_name("01.mkv");
        assert_eq!(episode.episode_start, Some(1));
    }

    #[test]
    fn skips_season_folder_when_locating_work() {
        let path = Path::new(r"G:\影音\进击的巨人\Season 2\01.mkv");
        let parsed = parse_work_folder(path, Some(Path::new(r"G:\影音")));
        assert_eq!(parsed.title.as_deref(), Some("进击的巨人"));
        assert_eq!(parsed.season, Some(2));
    }

    #[test]
    fn preserves_installment_markers_from_names_and_folders() {
        for (name, season) in [
            ("Show S02E01.mkv", 2),
            ("Show 第二季 - 01.mkv", 2),
            ("Show Season 3 - 01.mkv", 3),
        ] {
            let parsed = parse_file_name(name);
            assert_eq!(parsed.season, Some(season), "{name}");
            assert_eq!(parsed.episode_start, Some(1), "{name}");
        }
        for marker in ["OAD", "OVA", "SP"] {
            let path = format!(r"C:\Anime\Show\{marker}\01.mkv");
            let parsed = parse_media_path("01.mkv", Path::new(&path), Some(Path::new(r"C:\Anime")));
            assert_eq!(parsed.title.as_deref(), Some("Show"));
            assert_eq!(parsed.special_type.as_deref(), Some(marker));
        }
        let parsed = parse_file_name("[ReinForce] Kiss×sis - OAD 01 (BDRip 1920x1080).mkv");
        assert_eq!(parsed.special_type.as_deref(), Some("OAD"));
        assert_eq!(parsed.episode_start, Some(1));
    }
}
