-- File identity survives rematching and path reconciliation; no media is modified.
CREATE TABLE playback_progress (
    media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    tool_id TEXT REFERENCES external_tools(id) ON DELETE SET NULL,
    position_ms INTEGER NOT NULL CHECK(position_ms >= 0),
    duration_ms INTEGER NOT NULL CHECK(duration_ms > 0 AND position_ms <= duration_ms),
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_playback_progress_updated ON playback_progress(updated_at DESC);
