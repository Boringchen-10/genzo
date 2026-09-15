PRAGMA foreign_keys = ON;

CREATE TABLE metadata_provider_records (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  response_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (work_id, provider)
);

CREATE TABLE anime_episodes (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  episode_number INTEGER,
  sort_number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  original_title TEXT,
  description TEXT NOT NULL DEFAULT '',
  air_date TEXT,
  duration TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (work_id, provider, external_id),
  CHECK (episode_number IS NULL OR episode_number >= 0),
  CHECK (sort_number >= 0)
);

CREATE INDEX idx_metadata_provider_external
  ON metadata_provider_records(provider, external_id);
CREATE INDEX idx_anime_episodes_work_sort
  ON anime_episodes(work_id, sort_number, episode_number);
