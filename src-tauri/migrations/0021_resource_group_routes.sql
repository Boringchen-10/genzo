CREATE TABLE resource_group_routes (
    group_key TEXT PRIMARY KEY,
    destination TEXT NOT NULL CHECK (destination IN ('media', 'bookshelf')),
    updated_at TEXT NOT NULL
);
