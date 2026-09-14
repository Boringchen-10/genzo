use crate::error::{AppError, AppResult};
use crate::models::WorkMetadata;
use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

const API_ROOT: &str = "https://api.bgm.tv/v0";

#[derive(Clone)]
pub struct BangumiProvider {
    client: Client,
}

impl BangumiProvider {
    pub fn new() -> AppResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Genzo/0.2.0 (local media library)")
            .build()
            .map_err(|error| AppError::Network(format!("无法初始化 Bangumi 客户端：{error}")))?;
        Ok(Self { client })
    }

    pub async fn search(&self, query: &str) -> AppResult<Vec<WorkMetadata>> {
        let response = self
            .client
            .post(format!("{API_ROOT}/search/subjects"))
            .json(&json!({ "keyword": query, "sort": "match", "filter": { "type": [2] } }))
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 429 {
            return Err(AppError::Network(
                "Bangumi 请求过于频繁，请稍后再试".to_string(),
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 搜索失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Network(format!("Bangumi 返回了无法解析的数据：{error}")))?;
        Ok(body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(12)
            .filter_map(subject_to_metadata)
            .collect())
    }

    pub async fn get_details(&self, external_id: &str) -> AppResult<WorkMetadata> {
        let response = self
            .client
            .get(format!("{API_ROOT}/subjects/{external_id}"))
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 详情读取失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Network(format!("Bangumi 返回了无法解析的数据：{error}")))?;
        subject_to_metadata(&body)
            .ok_or_else(|| AppError::Network("Bangumi 详情缺少必要字段".to_string()))
    }

    pub async fn calendar(&self) -> AppResult<Vec<WorkMetadata>> {
        let response = self
            .client
            .get("https://api.bgm.tv/calendar")
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 429 {
            return Err(AppError::Network(
                "Bangumi 请求过于频繁，请稍后再试".to_string(),
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 番组日历读取失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Network(format!("Bangumi 返回了无法解析的数据：{error}")))?;
        Ok(body
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|day| day.get("items").and_then(Value::as_array))
            .flatten()
            .filter_map(subject_to_metadata)
            .collect())
    }

    pub async fn download_cover(&self, url: &str, destination: &Path) -> AppResult<()> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|_| AppError::Network("Bangumi 封面地址无效".to_string()))?;
        if parsed.scheme() != "https"
            || !matches!(parsed.host_str(), Some("lain.bgm.tv" | "bgm.tv"))
        {
            return Err(AppError::Network(
                "Bangumi 返回了不受信任的封面地址".to_string(),
            ));
        }
        let response = self
            .client
            .get(parsed)
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 封面下载失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        if response
            .content_length()
            .is_some_and(|size| size > 20 * 1024 * 1024)
        {
            return Err(AppError::Network("Bangumi 封面超过 20 MB".to_string()));
        }
        let bytes = response.bytes().await.map_err(network_error)?;
        if bytes.len() > 20 * 1024 * 1024 {
            return Err(AppError::Network("Bangumi 封面超过 20 MB".to_string()));
        }
        tokio::fs::write(destination, bytes).await?;
        Ok(())
    }
}

fn network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Network("连接 Bangumi 超时，请检查网络后重试".to_string())
    } else if error.is_connect() {
        AppError::Network("无法连接 Bangumi，本地媒体库仍可正常使用".to_string())
    } else {
        AppError::Network(format!("Bangumi 请求失败：{error}"))
    }
}

pub(crate) fn subject_to_metadata(value: &Value) -> Option<WorkMetadata> {
    let external_id = value.get("id")?.as_i64()?.to_string();
    let original = nonempty(value.get("name").and_then(Value::as_str));
    let chinese = nonempty(value.get("name_cn").and_then(Value::as_str));
    let title = chinese.clone().or_else(|| original.clone())?;
    let aliases = extract_aliases(value, &title, original.as_deref());
    let year = value
        .get("date")
        .or_else(|| value.get("air_date"))
        .and_then(Value::as_str)
        .and_then(|date| date.get(..4))
        .and_then(|year| year.parse::<i64>().ok());
    let subject_type = match value.get("platform").and_then(Value::as_str) {
        Some("剧场版") => "movie",
        Some("OVA") | Some("OAD") => "ova",
        Some("WEB") => "web",
        _ => "tv",
    }
    .to_string();
    let genres = value
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tag| tag.get("name").and_then(Value::as_str))
        .take(12)
        .map(str::to_string)
        .collect();
    let rating = value.get("rating");
    let collection_count = value
        .get("collection")
        .and_then(Value::as_object)
        .map(|collection| collection.values().filter_map(Value::as_i64).sum::<i64>())
        .unwrap_or_default();
    let air_date = value
        .get("date")
        .or_else(|| value.get("air_date"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(WorkMetadata {
        provider: "bangumi".to_string(),
        external_id,
        title,
        original_title: original,
        aliases,
        description: value
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        cover_url: value
            .get("images")
            .and_then(|images| images.get("large").or_else(|| images.get("common")))
            .and_then(Value::as_str)
            .map(str::to_string),
        banner_url: None,
        year,
        season: extract_season(value),
        subject_type,
        genres,
        score: rating
            .and_then(|value| value.get("score"))
            .and_then(Value::as_f64),
        rank: value.get("rank").and_then(Value::as_i64).or_else(|| {
            rating
                .and_then(|value| value.get("rank"))
                .and_then(Value::as_i64)
        }),
        rating_count: rating
            .and_then(|value| value.get("total"))
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        collection_count,
        air_date,
        broadcast: None,
        fetched_at: Utc::now().to_rfc3339(),
    })
}

fn nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn extract_aliases(value: &Value, title: &str, original: Option<&str>) -> Vec<String> {
    let mut aliases = Vec::new();
    if let Some(items) = value.get("infobox").and_then(Value::as_array) {
        for item in items {
            let key = item.get("key").and_then(Value::as_str).unwrap_or_default();
            if matches!(key, "别名" | "中文名" | "英文名" | "日文名") {
                match item.get("value") {
                    Some(Value::String(alias)) => aliases.push(alias.clone()),
                    Some(Value::Array(values)) => aliases.extend(
                        values
                            .iter()
                            .filter_map(|entry| {
                                entry
                                    .get("v")
                                    .and_then(Value::as_str)
                                    .or_else(|| entry.as_str())
                            })
                            .map(str::to_string),
                    ),
                    _ => {}
                }
            }
        }
    }
    aliases.retain(|alias| alias != title && Some(alias.as_str()) != original);
    aliases.sort();
    aliases.dedup();
    aliases
}

fn extract_season(value: &Value) -> Option<i64> {
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let re = regex::Regex::new(r"(?i)(?:season\s*|\sS)(\d{1,2})\b").expect("static regex");
    re.captures(name)
        .and_then(|captures| captures.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_subject_json() {
        let value = json!({"id": 123, "name": "Sousou no Frieren", "name_cn": "葬送的芙莉莲", "summary": "简介", "date": "2023-09-29", "platform": "TV", "images": {"large": "https://lain.bgm.tv/pic/cover/l/test.jpg"}, "tags": [{"name": "奇幻"}], "rating": {"rank": 42, "total": 36198, "score": 8.5}, "collection": {"wish": 10, "collect": 20, "doing": 5}});
        let metadata = subject_to_metadata(&value).expect("metadata");
        assert_eq!(metadata.external_id, "123");
        assert_eq!(metadata.title, "葬送的芙莉莲");
        assert_eq!(metadata.year, Some(2023));
        assert_eq!(metadata.score, Some(8.5));
        assert_eq!(metadata.rank, Some(42));
        assert_eq!(metadata.rating_count, 36_198);
        assert_eq!(metadata.collection_count, 35);
    }
    #[test]
    fn fetched_at_is_recorded() {
        let m = subject_to_metadata(&json!({"id": 1, "name": "A"})).unwrap();
        assert!(!m.fetched_at.is_empty());
    }

    #[test]
    fn maps_legacy_calendar_rating_shape() {
        let metadata = subject_to_metadata(&json!({
            "id": 456080,
            "name": "Calendar anime",
            "rating": {"total": 599, "score": 5.0},
            "rank": 9798,
            "collection": {"doing": 2151}
        }))
        .expect("calendar metadata");
        assert_eq!(metadata.rating_count, 599);
        assert_eq!(metadata.rank, Some(9798));
        assert_eq!(metadata.collection_count, 2151);
    }
}
