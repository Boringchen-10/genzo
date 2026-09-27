-- Artwork supplements never change the canonical work or episode identity.
CREATE TABLE episode_artwork_sources (
    work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
    anchor TEXT NOT NULL,
    series_id INTEGER NOT NULL CHECK(series_id > 0),
    season_number INTEGER NOT NULL CHECK(season_number BETWEEN 1 AND 999),
    method TEXT NOT NULL CHECK(method IN ('verified', 'manual')),
    updated_at TEXT NOT NULL
);
