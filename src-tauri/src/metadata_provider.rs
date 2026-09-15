use crate::anime_parser::normalize_title;
use crate::error::AppResult;
use crate::models::{MetadataProviderStatus, WorkMetadata};
use async_trait::async_trait;
use std::future::Future;
use std::time::{Duration, Instant};
use strsim::jaro_winkler;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub struct MetadataSearchQuery {
    pub title: String,
    pub aliases: Vec<String>,
    pub year: Option<i64>,
    pub subject_type: String,
}

impl MetadataSearchQuery {
    pub fn from_primary(primary: &WorkMetadata) -> Self {
        let mut aliases = primary.aliases.clone();
        if let Some(original) = &primary.original_title {
            aliases.push(original.clone());
        }
        Self {
            title: primary.title.clone(),
            aliases,
            year: primary.year,
            subject_type: primary.subject_type.clone(),
        }
    }

    pub fn all_titles(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.title.as_str()).chain(self.aliases.iter().map(String::as_str))
    }
}

#[async_trait]
pub trait MetadataProvider: Send + Sync {
    fn key(&self) -> &'static str;
    fn status(&self) -> MetadataProviderStatus;
    async fn search(&self, query: &MetadataSearchQuery) -> AppResult<Vec<WorkMetadata>>;
    async fn get_details(&self, external_id: &str) -> AppResult<WorkMetadata>;
}

pub struct ProviderRateLimiter {
    interval: Duration,
    next_allowed: Mutex<Instant>,
}

pub async fn retry_network<F, Fut, T>(mut operation: F) -> AppResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = AppResult<T>>,
{
    for attempt in 0..3_u32 {
        match operation().await {
            Err(crate::error::AppError::Network(_)) if attempt < 2 => {
                tokio::time::sleep(Duration::from_millis(250 * 2_u64.pow(attempt))).await;
            }
            result => return result,
        }
    }
    unreachable!("retry loop always returns on the final attempt")
}

impl ProviderRateLimiter {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            next_allowed: Mutex::new(Instant::now()),
        }
    }

    pub async fn wait(&self) {
        let mut next_allowed = self.next_allowed.lock().await;
        let now = Instant::now();
        if *next_allowed > now {
            tokio::time::sleep(*next_allowed - now).await;
        }
        *next_allowed = Instant::now() + self.interval;
    }
}

/// Validates a supplemental result against the Bangumi anchor.
pub fn supplemental_match_confidence(query: &MetadataSearchQuery, candidate: &WorkMetadata) -> f64 {
    let candidate_titles = std::iter::once(candidate.title.as_str())
        .chain(candidate.original_title.as_deref())
        .chain(candidate.aliases.iter().map(String::as_str))
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>();
    let title_score = query
        .all_titles()
        .flat_map(|left| {
            candidate_titles.iter().map(move |right| {
                let left = normalize_title(left);
                let right = normalize_title(right);
                if left.is_empty() || right.is_empty() {
                    0.0
                } else if left == right {
                    1.0
                } else {
                    jaro_winkler(&left, &right)
                }
            })
        })
        .fold(0.0_f64, f64::max);
    let year_score = match (query.year, candidate.year) {
        (Some(left), Some(right)) if left == right => 1.0,
        (Some(left), Some(right)) if (left - right).abs() <= 1 => 0.5,
        (Some(_), Some(_)) => 0.0,
        _ => 0.75,
    };
    (title_score * 0.85 + year_score * 0.15).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use chrono::Utc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn metadata(title: &str, year: Option<i64>) -> WorkMetadata {
        WorkMetadata {
            provider: "test".to_string(),
            external_id: "1".to_string(),
            title: title.to_string(),
            original_title: None,
            aliases: Vec::new(),
            description: String::new(),
            cover_url: None,
            banner_url: None,
            year,
            season: None,
            subject_type: "tv".to_string(),
            genres: Vec::new(),
            score: None,
            rank: None,
            rating_count: 0,
            collection_count: 0,
            air_date: None,
            broadcast: None,
            source_keys: vec!["test".to_string()],
            cover_provider: None,
            banner_provider: None,
            score_provider: None,
            fetched_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn supplemental_match_requires_title_and_year_agreement() {
        let query = MetadataSearchQuery {
            title: "葬送的芙莉莲".to_string(),
            aliases: vec!["Sousou no Frieren".to_string()],
            year: Some(2023),
            subject_type: "tv".to_string(),
        };
        assert_eq!(
            supplemental_match_confidence(&query, &metadata("Sousou no Frieren", Some(2023))),
            1.0
        );
        assert!(supplemental_match_confidence(&query, &metadata("Unrelated", Some(2010))) < 0.6);
    }

    #[tokio::test]
    async fn retries_transient_network_errors_with_a_bound() {
        let attempts = AtomicUsize::new(0);
        let value = retry_network(|| {
            let attempt = attempts.fetch_add(1, Ordering::SeqCst);
            async move {
                if attempt < 2 {
                    Err(AppError::Network("temporary".to_string()))
                } else {
                    Ok(42)
                }
            }
        })
        .await
        .expect("third attempt succeeds");
        assert_eq!(value, 42);
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }
}
