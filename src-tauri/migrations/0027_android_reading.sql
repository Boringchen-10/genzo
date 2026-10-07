-- 0026 is reserved for the shared personal-sync migration.
CREATE TABLE android_reading_progress (
    kind TEXT NOT NULL CHECK(kind IN ('comic', 'novel')),
    book_id TEXT NOT NULL,
    group_id TEXT NOT NULL DEFAULT '',
    entry_id TEXT NOT NULL,
    location_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(kind, book_id, group_id, entry_id)
);
CREATE TABLE android_reading_bookmarks (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('comic', 'novel')),
    book_id TEXT NOT NULL,
    group_id TEXT NOT NULL DEFAULT '',
    entry_id TEXT NOT NULL,
    location_json TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(kind, book_id, group_id, entry_id, location_json)
);
CREATE INDEX idx_android_reading_bookmarks_book
    ON android_reading_bookmarks(kind, book_id, group_id, created_at);
