//! Live progress stays in memory; only task boundaries touch SQLite.
use crate::{
    db::AppState,
    error::{AppError, AppResult},
    models::LibraryRoot,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanTask {
    pub id: String,
    pub root_id: String,
    pub root_path: String,
    pub scope_key: String,
    pub stage: String,
    pub current_directory: String,
    pub visited_directories: usize,
    pub pending_directories: usize,
    pub discovered: usize,
    pub processed: usize,
    pub reused: usize,
    pub errors: Vec<String>,
    pub failed_directories: Vec<String>,
    pub retry: bool,
}

pub struct TaskHandle {
    pub state: Mutex<ScanTask>,
    cancelled: AtomicBool,
}
type Registry = Mutex<HashMap<String, Arc<TaskHandle>>>;
fn registry() -> &'static Registry {
    static TASKS: OnceLock<Registry> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}
impl TaskHandle {
    pub fn update(&self, action: impl FnOnce(&mut ScanTask)) {
        let mut state = self.state.lock().unwrap();
        action(&mut state);
        crate::android_events::scan(&state);
    }
    pub fn snapshot(&self) -> ScanTask {
        self.state.lock().unwrap().clone()
    }
    pub fn check(&self) -> AppResult<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(AppError::Validation("扫描已取消，原有索引未改动".into()))
        } else {
            Ok(())
        }
    }
    pub async fn cancellation(&self) {
        while self.check().is_ok() {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
    // Once commit starts it must finish atomically, rather than report a false cancellation.
    pub fn committing(&self) -> AppResult<()> {
        let mut state = self.state.lock().unwrap();
        self.check()?;
        state.stage = "committing".into();
        crate::android_events::scan(&state);
        Ok(())
    }
}
pub async fn scope_key(pool: &SqlitePool, root: &LibraryRoot) -> AppResult<String> {
    let remote: Option<(String, String)> =
            sqlx::query_as("SELECT endpoint,directory FROM remote_sources WHERE id=? UNION ALL SELECT tree_uri,'' FROM android_saf_sources WHERE source_id=?")
            .bind(&root.id)
            .bind(&root.id)
            .fetch_optional(pool)
            .await?;
    Ok(serde_json::to_string(&(
        &root.path,
        &root.kind,
        &root.source_type,
        remote,
    ))?)
}
pub fn register(id: &str, root: &LibraryRoot, key: String, retry: bool) -> Arc<TaskHandle> {
    let handle = Arc::new(TaskHandle {
        state: Mutex::new(ScanTask {
            id: id.into(),
            root_id: root.id.clone(),
            root_path: root.path.clone(),
            scope_key: key,
            stage: "queued".into(),
            current_directory: String::new(),
            visited_directories: 0,
            pending_directories: 0,
            discovered: 0,
            processed: 0,
            reused: 0,
            errors: vec![],
            failed_directories: vec![],
            retry,
        }),
        cancelled: AtomicBool::new(false),
    });
    let mut tasks = registry().lock().unwrap();
    tasks.retain(|_, task| {
        matches!(
            task.snapshot().stage.as_str(),
            "queued" | "scanning" | "indexing" | "committing"
        )
    });
    tasks.insert(id.into(), handle.clone());
    handle
}
pub async fn persist(pool: &SqlitePool, task: &TaskHandle) -> AppResult<()> {
    let snapshot = task.snapshot();
    let (_write_guard, mut transaction) = crate::db::begin_write(pool).await?;
    sqlx::query("INSERT INTO scan_task_state(job_id,payload_json) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET payload_json=excluded.payload_json")
        .bind(&snapshot.id).bind(serde_json::to_string(&snapshot)?).execute(&mut *transaction).await?;
    sqlx::query("DELETE FROM scan_task_state WHERE job_id IN (SELECT id FROM scan_jobs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT -1 OFFSET 50)")
        .execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(())
}
pub async fn list(pool: &SqlitePool) -> AppResult<Vec<ScanTask>> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT s.job_id,s.payload_json FROM scan_task_state s JOIN scan_jobs j ON j.id=s.job_id ORDER BY j.started_at DESC LIMIT 50")
        .fetch_all(pool).await?;
    let tasks = registry().lock().unwrap();
    rows.into_iter()
        .map(|(id, json)| {
            let mut task: ScanTask = if let Some(live) = tasks.get(&id) {
                live.snapshot()
            } else {
                serde_json::from_str(&json)?
            };
            if !tasks.contains_key(&id)
                && matches!(
                    task.stage.as_str(),
                    "queued" | "scanning" | "indexing" | "committing"
                )
            {
                task.stage = "interrupted".into();
                task.errors
                    .push("此前扫描未记录完成结果；请重新扫描该来源".into());
            }
            Ok(task)
        })
        .collect()
}
#[tauri::command]
pub async fn list_scan_tasks(state: State<'_, AppState>) -> AppResult<Vec<ScanTask>> {
    list(&state.pool).await
}
#[tauri::command]
pub async fn cancel_scan_task(id: String, state: State<'_, AppState>) -> AppResult<()> {
    cancel(&state.pool, &id).await
}
pub async fn cancel(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM scan_jobs WHERE id=?)")
        .bind(id)
        .fetch_one(pool)
        .await?;
    let tasks = registry().lock().unwrap();
    let task = tasks
        .get(id)
        .filter(|_| exists)
        .ok_or_else(|| AppError::Validation("任务不在当前应用中运行".into()))?;
    let snapshot = task.state.lock().unwrap();
    if !matches!(snapshot.stage.as_str(), "queued" | "scanning" | "indexing") {
        return Err(AppError::Validation("任务已结束或正在提交索引".into()));
    }
    task.cancelled.store(true, Ordering::Relaxed);
    Ok(())
}
#[tauri::command]
pub async fn retry_scan_task(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<crate::models::ScanResult> {
    let task = list(&state.pool)
        .await?
        .into_iter()
        .find(|task| task.id == id)
        .ok_or_else(|| AppError::NotFound("扫描记录不存在".into()))?;
    if !matches!(task.stage.as_str(), "completed" | "failed") || task.failed_directories.is_empty()
    {
        return Err(AppError::Validation("该任务没有可重试的失败目录".into()));
    }
    crate::scanner::scan_with_options(
        &state.pool,
        &task.root_id,
        Some((task.scope_key, task.failed_directories)),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_interrupts_wait_and_commit_boundary_rejects_it() {
        let task = TaskHandle {
            state: Mutex::new(ScanTask {
                id: "test".into(),
                root_id: "test".into(),
                root_path: "test".into(),
                scope_key: "test".into(),
                stage: "scanning".into(),
                current_directory: String::new(),
                visited_directories: 0,
                pending_directories: 0,
                discovered: 0,
                processed: 0,
                reused: 0,
                errors: vec![],
                failed_directories: vec![],
                retry: false,
            }),
            cancelled: AtomicBool::new(true),
        };
        tokio::time::timeout(std::time::Duration::from_millis(200), task.cancellation())
            .await
            .unwrap();
        assert!(task.committing().is_err());
    }
}
