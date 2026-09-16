PRAGMA foreign_keys = ON;

ALTER TABLE media_files ADD COLUMN content_fingerprint TEXT;
ALTER TABLE media_files ADD COLUMN thumbnail_path TEXT;

CREATE INDEX idx_media_files_fingerprint
  ON media_files(content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

ALTER TABLE work_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'metadata'));

UPDATE work_tags
SET source = 'metadata'
WHERE work_id IN (
  SELECT work_id
  FROM work_field_sources
  WHERE field_name = 'tags'
);

-- Older scans could represent one moved episode as a missing row plus a current row.
-- Remove only exact database duplicates; no user file is touched.
DELETE FROM media_files
WHERE id IN (
  SELECT old.id
  FROM media_files old
  JOIN media_files current
    ON current.id != old.id
   AND current.work_id = old.work_id
   AND current.missing = 0
   AND current.file_name = old.file_name COLLATE NOCASE
   AND current.size = old.size
   AND COALESCE(current.parsed_season, -1) = COALESCE(old.parsed_season, -1)
   AND COALESCE(current.parsed_episode_start, -1) = COALESCE(old.parsed_episode_start, -1)
   AND COALESCE(current.parsed_episode_end, -1) = COALESCE(old.parsed_episode_end, -1)
  WHERE old.missing = 1
    AND old.work_id IS NOT NULL
);

CREATE TABLE media_episode_links (
  media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  episode_external_id TEXT NOT NULL,
  match_method TEXT NOT NULL CHECK (match_method IN ('parsed', 'manual')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (work_id, provider, episode_external_id)
    REFERENCES anime_episodes(work_id, provider, external_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_media_episode_links_work
  ON media_episode_links(work_id, provider, episode_external_id);
