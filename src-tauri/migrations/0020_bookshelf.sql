CREATE TABLE book_entry_overrides (
  media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  title TEXT,
  volume_number REAL,
  chapter_number REAL,
  read_state TEXT NOT NULL DEFAULT 'unread' CHECK (read_state IN ('unread', 'reading', 'read')),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_book_entry_read_state ON book_entry_overrides(read_state);
