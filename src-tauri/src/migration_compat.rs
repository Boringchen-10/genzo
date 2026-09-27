use crate::error::AppResult;
use sha2::{Digest, Sha384};
use sqlx::migrate::MigrateError;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::borrow::Cow;

// Frozen historical SQL: never edit this fixture or previously shipped migrations.
const INITIAL_16: &str = include_str!("../migration_compat/0016_initial.sql");
const FINAL_16: &str = include_str!("../migrations/0016_recognition_preferences.sql");
const TABLES: [&str; 2] = ["recognition_preferences", "media_episode_overrides"];
const INDEXES: [&str; 2] = [
    "idx_recognition_preferences_work",
    "idx_media_episode_overrides_work",
];

/// Migration 16 briefly shipped before its two indexes were appended. Accept only
/// those exact known SQL checksums (including Windows line endings), after verifying
/// the actual schema. Keep the ledger unchanged; migration 17 supplies the indexes.
/// SQLx still validates every other migration and rejects unknown alterations.
pub async fn run(pool: &SqlitePool) -> AppResult<()> {
    let mut migrator = sqlx::migrate!("./migrations");
    let has_ledger: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?;
    if has_ledger {
        let applied: Option<Vec<u8>> = sqlx::query_scalar(
            "SELECT checksum FROM _sqlx_migrations WHERE version = 16 AND success = 1",
        )
        .fetch_optional(pool)
        .await?;
        if let Some(checksum) = applied {
            let migration = migrator
                .migrations
                .to_mut()
                .iter_mut()
                .find(|m| m.version == 16)
                .expect("migration 16 must remain embedded");
            if migration.checksum.as_ref() != checksum.as_slice() {
                if !known_checksum(&checksum) || !known_schema(pool).await? {
                    return Err(MigrateError::VersionMismatch(16).into());
                }
                // Runtime compatibility only: do not rewrite _sqlx_migrations.
                migration.checksum = Cow::Owned(checksum);
            }
        }
    }
    migrator.run(pool).await?;
    Ok(())
}

fn known_checksum(checksum: &[u8]) -> bool {
    [INITIAL_16, FINAL_16].into_iter().any(|sql| {
        let lf = sql.replace("\r\n", "\n");
        [lf.clone(), lf.replace('\n', "\r\n")]
            .into_iter()
            .any(|variant| Sha384::digest(variant.as_bytes()).as_slice() == checksum)
    })
}

fn normalized_schema(sql: &str) -> String {
    sql.chars().filter(|c| !c.is_ascii_whitespace()).collect()
}

async fn schema_sql(pool: &SqlitePool, name: &str) -> AppResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT sql FROM sqlite_schema WHERE name = ?")
            .bind(name)
            .fetch_optional(pool)
            .await?,
    )
}

async fn known_schema(pool: &SqlitePool) -> AppResult<bool> {
    let expected = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::raw_sql(FINAL_16).execute(&expected).await?;
    for name in TABLES.into_iter().chain(INDEXES) {
        let actual = schema_sql(pool, name).await?;
        let reference = schema_sql(&expected, name)
            .await?
            .expect("known schema object");
        match actual {
            Some(sql) if normalized_schema(&sql) == normalized_schema(&reference) => {}
            None if INDEXES.contains(&name) => {}
            _ => return Ok(false),
        }
    }
    expected.close().await;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use sqlx::migrate::Migration;

    async fn legacy_pool(sql: &str) -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        apply_legacy(&pool, sql).await;
        pool
    }

    async fn apply_legacy(pool: &SqlitePool, sql: &str) {
        let mut migrator = sqlx::migrate!("./migrations");
        let mut migrations = migrator.migrations.into_owned();
        migrations.retain(|m| m.version <= 16);
        let original = migrations.iter_mut().find(|m| m.version == 16).unwrap();
        *original = Migration::new(
            16,
            original.description.clone(),
            original.migration_type,
            Cow::Owned(sql.to_owned()),
            false,
        );
        migrator.migrations = Cow::Owned(migrations);
        migrator.run(pool).await.unwrap();
    }

    #[tokio::test]
    async fn upgraded_database_can_be_closed_and_reopened() {
        let directory = tempfile::tempdir().unwrap();
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(directory.path().join("upgrade.db"))
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        apply_legacy(&pool, INITIAL_16).await;
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('fixture','keep','t')")
            .execute(&pool)
            .await
            .unwrap();
        let checksum = ledger_checksum(&pool).await;
        pool.close().await;
        for _ in 0..2 {
            let reopened = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options.clone())
                .await
                .unwrap();
            run(&reopened).await.unwrap();
            assert_eq!(checksum, ledger_checksum(&reopened).await);
            let value: String =
                sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'fixture'")
                    .fetch_one(&reopened)
                    .await
                    .unwrap();
            assert_eq!(value, "keep");
            assert!(known_schema(&reopened).await.unwrap());
            reopened.close().await;
        }
    }

    async fn ledger_checksum(pool: &SqlitePool) -> Vec<u8> {
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 16")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn original_16_reproduces_failure_then_preserves_data_and_ledger() {
        let pool = legacy_pool(INITIAL_16).await;
        assert!(matches!(
            sqlx::migrate!("./migrations").run(&pool).await,
            Err(MigrateError::VersionMismatch(16))
        ));
        sqlx::raw_sql("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','保留作品','video','t','t');
            INSERT INTO library_roots(id,path,created_at,updated_at) VALUES('r','X:/fixture','t','t');
            INSERT INTO media_files(id,work_id,library_root_id,path,file_name,extension,media_type,created_at,updated_at)
                VALUES('f','w','r','X:/fixture/01.mkv','01.mkv','mkv','video','t','t');
            INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('f',12345,240000,'t');
            INSERT INTO recognition_preferences VALUES('p','r','title','1','','anime','w','t');
            INSERT INTO media_episode_overrides VALUES('f','w',1,1,0,'t');
            INSERT INTO recognition_history(id,target_work_id,target_title,file_count,scope_json,before_json,after_json,created_at)
                VALUES('h','w','保留作品',1,'[]','{}','{}','t');")
            .execute(&pool).await.unwrap();
        let checksum = ledger_checksum(&pool).await;
        run(&pool).await.unwrap();
        run(&pool).await.unwrap();
        assert_eq!(checksum, ledger_checksum(&pool).await);
        for table in [
            "works",
            "library_roots",
            "media_files",
            "playback_progress",
            "recognition_preferences",
            "media_episode_overrides",
            "recognition_history",
        ] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1, "{table}");
        }
        let position: i64 = sqlx::query_scalar(
            "SELECT position_ms FROM playback_progress WHERE media_file_id = 'f'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(position, 12345);
        assert!(known_schema(&pool).await.unwrap());
        let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 17);
    }

    #[tokio::test]
    async fn both_shipped_versions_and_line_endings_upgrade() {
        for sql in [INITIAL_16, FINAL_16] {
            let lf = sql.replace("\r\n", "\n");
            for variant in [lf.clone(), lf.replace('\n', "\r\n")] {
                let pool = legacy_pool(&variant).await;
                let checksum = ledger_checksum(&pool).await;
                run(&pool).await.unwrap();
                assert_eq!(checksum, ledger_checksum(&pool).await);
                assert!(known_schema(&pool).await.unwrap());
            }
        }
    }

    #[tokio::test]
    async fn unknown_checksum_and_other_modified_migrations_still_fail() {
        for version in [16, 15] {
            let pool = legacy_pool(INITIAL_16).await;
            sqlx::query("UPDATE _sqlx_migrations SET checksum = X'00' WHERE version = ?")
                .bind(version)
                .execute(&pool)
                .await
                .unwrap();
            assert!(matches!(run(&pool).await,
                Err(AppError::Migration(MigrateError::VersionMismatch(v))) if v == version));
            let pending: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE version = 17")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(pending, 0);
        }
    }

    #[tokio::test]
    async fn known_checksum_does_not_hide_schema_drift() {
        for sql in [
            "ALTER TABLE recognition_preferences ADD COLUMN unexpected TEXT",
            "CREATE INDEX idx_recognition_preferences_work ON recognition_preferences(title_key)",
            "DROP TABLE media_episode_overrides",
        ] {
            let pool = legacy_pool(INITIAL_16).await;
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
            assert!(matches!(
                run(&pool).await,
                Err(AppError::Migration(MigrateError::VersionMismatch(16)))
            ));
        }
    }

    #[tokio::test]
    async fn fresh_and_incomplete_databases_keep_standard_validation() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run(&pool).await.unwrap();
        assert!(known_schema(&pool).await.unwrap());
        sqlx::query("UPDATE _sqlx_migrations SET success = 0 WHERE version = 16")
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            run(&pool).await,
            Err(AppError::Migration(MigrateError::Dirty(16)))
        ));
    }
}
