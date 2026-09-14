PRAGMA foreign_keys = ON;

CREATE TABLE subtitle_links (
  subtitle_media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  video_media_file_id TEXT NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  episode TEXT,
  match_method TEXT NOT NULL CHECK (match_method IN ('episode', 'file_name', 'single_file')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (subtitle_media_file_id != video_media_file_id)
);

CREATE INDEX idx_subtitle_links_video ON subtitle_links(video_media_file_id);
CREATE INDEX idx_subtitle_links_work ON subtitle_links(work_id);
