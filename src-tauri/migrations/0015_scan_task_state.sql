CREATE TABLE scan_task_state (
    job_id TEXT PRIMARY KEY REFERENCES scan_jobs(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL
);
