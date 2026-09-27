CREATE TABLE recognition_history (
  id TEXT PRIMARY KEY NOT NULL,
  target_work_id TEXT NOT NULL,
  target_title TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  scope_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE INDEX idx_recognition_history_created ON recognition_history(created_at DESC);
