//! Notifications invalidate snapshots; SQLite remains the recovery source.
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock}, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static REVISION: AtomicU64 = AtomicU64::new(0);
static SCANS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

pub fn init(app: &AppHandle) {
    #[cfg(target_os = "android")]
    let _ = APP.set(app.clone());
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

fn publish(name: &str, payload: Value) {
    if let Some(app) = APP.get() { let _ = app.emit(name, payload); }
}

fn revision() -> u64 { REVISION.fetch_add(1, Ordering::Relaxed) + 1 }

pub fn scan(task: &crate::scan_tasks::ScanTask) {
    if APP.get().is_none() { return; }
    let terminal = !matches!(task.stage.as_str(), "queued" | "scanning" | "indexing" | "committing");
    let mut times = SCANS.get_or_init(Default::default).lock().unwrap();
    let now = Instant::now();
    if !terminal && times.get(&task.id).is_some_and(|last| now.duration_since(*last) < Duration::from_millis(500)) { return; }
    if terminal { times.remove(&task.id); } else { times.insert(task.id.clone(), now); }
    // Serialize and emit under the same ordering boundary as the revision.
    publish("scan-task-updated", json!({"revision":revision(),"task":task}));
}

pub fn source(source: &crate::android_sources::VideoSource) {
    let mut value = serde_json::to_value(source).unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        let id = object.remove("id").unwrap_or(Value::Null);
        object.insert("sourceId".into(), id);
        object.insert("revision".into(), json!(revision()));
        object.remove("label"); object.remove("enabled"); object.remove("kind"); object.remove("lastScannedAt");
    }
    publish("android-source-state", value);
}

pub fn player(snapshot: Value) { publish("player-state", snapshot); }

pub fn recognition(media_ids: Vec<String>, work_ids: Vec<String>) {
    publish("recognition-updated", json!({"revision":revision(),"mediaFileIds":media_ids,"workIds":work_ids}));
}
