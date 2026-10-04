-- Local Android access uses SAF locators alongside the existing media identity.
-- Keep the shipped library_roots CHECK and all historical rows unchanged.
CREATE TABLE android_saf_sources (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES library_roots(id) ON DELETE RESTRICT,
  tree_uri TEXT NOT NULL COLLATE BINARY UNIQUE,
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 128)
);
CREATE TABLE android_documents (
  media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES android_saf_sources(source_id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL COLLATE BINARY,
  uri TEXT NOT NULL COLLATE BINARY,
  parent_uri TEXT NOT NULL COLLATE BINARY,
  relative_path TEXT NOT NULL,
  UNIQUE(source_id, document_id)
);
