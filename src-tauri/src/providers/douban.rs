use crate::error::{AppError, AppResult};
use crate::metadata_provider::{MetadataProvider, MetadataSearchQuery};
use crate::models::{MetadataProviderStatus, WorkMetadata};
use async_trait::async_trait;

#[derive(Clone, Default)]
pub struct DoubanProvider;

#[async_trait]
impl MetadataProvider for DoubanProvider {
    fn key(&self) -> &'static str {
        "douban"
    }

    fn status(&self) -> MetadataProviderStatus {
        MetadataProviderStatus {
            key: "douban".to_string(),
            label: "豆瓣".to_string(),
            available: false,
            configured: false,
            requires_credential: true,
            message: Some(
                "没有可供 Genzo 合规使用的稳定公开 API；不会抓取网页或调用未公开接口".to_string(),
            ),
        }
    }

    async fn search(&self, _query: &MetadataSearchQuery) -> AppResult<Vec<WorkMetadata>> {
        Err(unavailable())
    }

    async fn get_details(&self, _external_id: &str) -> AppResult<WorkMetadata> {
        Err(unavailable())
    }
}

fn unavailable() -> AppError {
    AppError::Validation(
        "豆瓣补源尚不可用：当前没有稳定、授权的正式 API，Genzo 不会抓取网页".to_string(),
    )
}
