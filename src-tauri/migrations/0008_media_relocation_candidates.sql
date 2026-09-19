-- Legacy scans may leave unowned, unparsed rows at the old location. Root IDs
-- and parsed episode numbers are not file identity. This view only proposes
-- pairs; Rust also verifies both paths and installment markers before merging.
CREATE VIEW media_relocation_candidates AS
SELECT old.id AS old_id, current.id AS current_id,
       old.path AS old_path, current.path AS current_path,
       old.file_name AS old_name, current.file_name AS current_name,
       current.size AS size
FROM media_files old
JOIN media_files current
  ON current.work_id = old.work_id
 AND current.id != old.id
 AND current.media_type = 'video'
 AND current.missing = 0
 AND current.size = old.size
WHERE old.missing = 1
  AND old.media_type = 'video'
  AND old.work_id IS NOT NULL
  AND (
    (old.content_fingerprint IS NOT NULL AND current.content_fingerprint = old.content_fingerprint)
    OR (
      (old.content_fingerprint IS NULL OR current.content_fingerprint IS NULL)
      AND current.file_name = old.file_name COLLATE NOCASE
      AND old.modified_at IS NOT NULL
      AND current.modified_at = old.modified_at
    )
  );
