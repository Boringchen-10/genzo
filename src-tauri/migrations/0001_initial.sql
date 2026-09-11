PRAGMA foreign_keys = ON;

CREATE TABLE works (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  original_title TEXT,
  type TEXT NOT NULL CHECK (type IN ('video', 'comic', 'novel', 'game', 'other')),
  description TEXT NOT NULL DEFAULT '',
  cover_path TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'paused', 'dropped')),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  rating REAL CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE library_roots (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL COLLATE NOCASE UNIQUE,
  kind TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto', 'video', 'comic', 'novel', 'game', 'mixed')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE media_files (
  id TEXT PRIMARY KEY NOT NULL,
  work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
  library_root_id TEXT REFERENCES library_roots(id) ON DELETE SET NULL,
  path TEXT NOT NULL COLLATE NOCASE UNIQUE,
  file_name TEXT NOT NULL,
  extension TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('video', 'comic', 'novel', 'game', 'other')),
  size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  modified_at TEXT,
  missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE external_tools (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  executable_path TEXT NOT NULL COLLATE NOCASE,
  supported_media_types TEXT NOT NULL DEFAULT '[]',
  arguments_template TEXT NOT NULL DEFAULT '{file}',
  working_directory TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name, executable_path)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE work_tags (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, tag_id)
);

CREATE TABLE scan_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  library_root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_works_title ON works(title COLLATE NOCASE);
CREATE INDEX idx_works_type ON works(type);
CREATE INDEX idx_works_updated_at ON works(updated_at DESC);
CREATE INDEX idx_media_files_work_id ON media_files(work_id);
CREATE INDEX idx_media_files_root_id ON media_files(library_root_id);
CREATE INDEX idx_media_files_missing ON media_files(missing);
CREATE INDEX idx_work_tags_tag_id ON work_tags(tag_id);
CREATE INDEX idx_scan_jobs_root_started ON scan_jobs(library_root_id, started_at DESC);
