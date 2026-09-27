-- Complete the original migration 16 without modifying its historical checksum.
CREATE INDEX IF NOT EXISTS idx_recognition_preferences_work ON recognition_preferences(work_id);
CREATE INDEX IF NOT EXISTS idx_media_episode_overrides_work ON media_episode_overrides(work_id);
