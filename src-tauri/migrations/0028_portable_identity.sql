-- Portable identities are independent of device IDs, paths and authorization.
CREATE TABLE portable_work_identity (
    local_work_id TEXT PRIMARY KEY NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    portable_id TEXT NOT NULL UNIQUE
);
