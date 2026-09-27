-- Source-scoped recommendations, never automatic ownership changes.
CREATE TABLE recognition_preferences (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
    title_key TEXT NOT NULL,
    season_key TEXT NOT NULL,
    special_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('anime','movie','tv')),
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL,
    UNIQUE(root_id,title_key,season_key,special_key,kind,work_id)
);
CREATE TABLE media_episode_overrides (
    media_file_id TEXT PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    season INTEGER CHECK(season IS NULL OR season BETWEEN 0 AND 999),
    episode INTEGER CHECK(episode IS NULL OR episode BETWEEN 0 AND 9999),
    episode_type INTEGER NOT NULL CHECK(episode_type BETWEEN 0 AND 6),
    updated_at TEXT NOT NULL
);
