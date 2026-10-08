-- Keep imported identities even when a receiver already has its own export identity.
CREATE TABLE portable_work_aliases (
    portable_id TEXT PRIMARY KEY NOT NULL,
    local_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE
);
INSERT INTO portable_work_aliases SELECT portable_id, local_work_id FROM portable_work_identity;
CREATE INDEX idx_portable_work_aliases_work ON portable_work_aliases(local_work_id);
