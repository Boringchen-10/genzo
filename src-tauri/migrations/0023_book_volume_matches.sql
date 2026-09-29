CREATE TABLE book_volume_matches (
  media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'bangumi' CHECK (provider = 'bangumi'),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  volume_number REAL,
  cover_path TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_book_volume_matches_external_id ON book_volume_matches(provider, external_id);
