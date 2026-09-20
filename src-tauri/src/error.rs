use serde::Serialize;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误：{0}")]
    Database(sqlx::Error),
    #[error("数据库正在处理其他操作，请稍后重试；本次操作未完成")]
    DatabaseBusy,
    #[error("数据库迁移失败：{0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("文件系统错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 数据错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("找不到路径：{0}")]
    PathNotFound(PathBuf),
    #[error("无效输入：{0}")]
    Validation(String),
    #[error("未找到记录：{0}")]
    NotFound(String),
    #[error("无法启动程序：{0}")]
    Launch(String),
    #[error("网络服务错误：{0}")]
    Network(String),
    #[error("系统错误：{0}")]
    System(String),
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        if crate::db::is_busy(&error) {
            Self::DatabaseBusy
        } else {
            Self::Database(error)
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
