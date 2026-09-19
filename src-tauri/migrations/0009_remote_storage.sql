ALTER TABLE library_roots ADD COLUMN source_type TEXT NOT NULL DEFAULT 'local' CHECK(source_type IN ('local', 'mounted', 'webdav'));
ALTER TABLE library_roots ADD COLUMN availability TEXT NOT NULL DEFAULT 'unknown';
CREATE TABLE remote_sources (
  id TEXT PRIMARY KEY NOT NULL REFERENCES library_roots(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  directory TEXT NOT NULL,
  credential_id TEXT NOT NULL
);
CREATE TABLE remote_files (
  media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES remote_sources(id) ON DELETE RESTRICT,
  href TEXT NOT NULL COLLATE BINARY,
  etag TEXT,
  UNIQUE(source_id, href)
);
CREATE TABLE remote_cache (
  media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES remote_files(media_file_id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  accessed_at TEXT NOT NULL
);
INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES ('storage.cache_limit_gib', '20', datetime('now'));
