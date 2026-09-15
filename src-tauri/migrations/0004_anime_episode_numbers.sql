PRAGMA foreign_keys = ON;

ALTER TABLE media_files ADD COLUMN parsed_episode_start INTEGER
  CHECK (parsed_episode_start IS NULL OR parsed_episode_start >= 0);
ALTER TABLE media_files ADD COLUMN parsed_episode_end INTEGER
  CHECK (parsed_episode_end IS NULL OR parsed_episode_end >= parsed_episode_start);

CREATE INDEX idx_media_files_episode_number
  ON media_files(work_id, parsed_season, parsed_episode_start, parsed_episode_end);
