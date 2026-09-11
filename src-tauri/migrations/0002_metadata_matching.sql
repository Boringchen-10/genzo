PRAGMA foreign_keys = ON;

ALTER TABLE works ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'manually_created'
  CHECK (metadata_status IN ('unmatched', 'candidate_pending', 'matched', 'manually_created', 'error'));
ALTER TABLE works ADD COLUMN metadata_year INTEGER
  CHECK (metadata_year IS NULL OR (metadata_year >= 1900 AND metadata_year <= 2200));
ALTER TABLE works ADD COLUMN last_recognized_at TEXT;

ALTER TABLE media_files ADD COLUMN recognition_status TEXT NOT NULL DEFAULT 'unmatched'
  CHECK (recognition_status IN ('unmatched', 'candidate_pending', 'matched', 'error'));
ALTER TABLE media_files ADD COLUMN parsed_title TEXT;
ALTER TABLE media_files ADD COLUMN parsed_original_title TEXT;
ALTER TABLE media_files ADD COLUMN parsed_season INTEGER;
ALTER TABLE media_files ADD COLUMN parsed_episode TEXT;
ALTER TABLE media_files ADD COLUMN parsed_year INTEGER;
ALTER TABLE media_files ADD COLUMN parsed_release_group TEXT;
ALTER TABLE media_files ADD COLUMN parsed_special_type TEXT;
ALTER TABLE media_files ADD COLUMN parsed_media_info TEXT NOT NULL DEFAULT '[]';
ALTER TABLE media_files ADD COLUMN last_recognized_at TEXT;
ALTER TABLE media_files ADD COLUMN recognition_error TEXT;

CREATE TABLE work_external_ids (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, provider),
  UNIQUE (provider, external_id)
);

CREATE TABLE metadata_cache (
  provider TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, cache_key)
);

CREATE TABLE match_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  media_file_id TEXT NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  subject_type TEXT NOT NULL,
  year INTEGER,
  season INTEGER,
  cover_url TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  match_reasons_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (media_file_id, provider, external_id)
);

CREATE TABLE work_field_sources (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, field_name)
);

CREATE TABLE work_field_locks (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1 CHECK (locked IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, field_name)
);

CREATE INDEX idx_media_files_recognition ON media_files(media_type, recognition_status, missing);
CREATE INDEX idx_match_candidates_media_score ON match_candidates(media_file_id, confidence DESC);
CREATE INDEX idx_external_ids_lookup ON work_external_ids(provider, external_id);
CREATE INDEX idx_metadata_cache_expiry ON metadata_cache(expires_at);
