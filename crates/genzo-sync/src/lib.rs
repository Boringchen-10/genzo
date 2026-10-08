//! No Tauri, Windows, SAF or credential-store dependency. Hosts supply a SQLite pool and credentials.
pub mod protocol;
pub mod store;
pub mod transport;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("AUTH_REQUIRED")]
    Auth,
    #[error("OFFLINE")]
    Offline,
    #[error("CONDITION_UNSUPPORTED")]
    ConditionUnsupported,
    #[error("PRECONDITION_FAILED")]
    Precondition,
    #[error("PROTOCOL_UNSUPPORTED")]
    Protocol,
    #[error("INVALID_DOCUMENT")]
    Invalid,
    #[error("IDENTITY_CONFLICT")]
    Identity,
    #[error("LIMIT_EXCEEDED")]
    Limit,
    #[error("SPACE_NOT_FOUND")]
    NotFound,
    #[error("ALREADY_CONNECTED")]
    AlreadyConnected,
    #[error("DATABASE_ERROR")]
    Database(#[from] sqlx::Error),
    #[error("FILE_UNAVAILABLE")]
    File(#[from] std::io::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
