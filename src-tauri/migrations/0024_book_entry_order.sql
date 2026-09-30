CREATE TABLE book_entry_order (
  work_id TEXT PRIMARY KEY NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('asc', 'desc', 'custom')),
  entry_ids TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
