-- Local relocation heuristics must never merge an offline remote/mounted copy
-- into a local one just because name, size and timestamp happen to match.
DROP VIEW media_relocation_candidates;
CREATE VIEW media_relocation_candidates AS
SELECT old.id AS old_id, current.id AS current_id,
       old.path AS old_path, current.path AS current_path,
       old.file_name AS old_name, current.file_name AS current_name,
       current.size AS size
FROM media_files old
JOIN media_files current ON current.work_id = old.work_id AND current.id != old.id
 AND current.media_type = 'video' AND current.missing = 0 AND current.size = old.size
WHERE old.missing = 1 AND old.media_type = 'video' AND old.work_id IS NOT NULL
 AND old.path NOT LIKE 'webdav:%' AND current.path NOT LIKE 'webdav:%'
 AND NOT EXISTS(SELECT 1 FROM library_roots r WHERE r.id IN (old.library_root_id,current.library_root_id) AND r.source_type != 'local')
 AND ((old.content_fingerprint IS NOT NULL AND current.content_fingerprint = old.content_fingerprint)
   OR ((old.content_fingerprint IS NULL OR current.content_fingerprint IS NULL)
       AND current.file_name = old.file_name COLLATE NOCASE
       AND old.modified_at IS NOT NULL AND current.modified_at = old.modified_at));
