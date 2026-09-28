ALTER TABLE library_roots ADD COLUMN destination TEXT NOT NULL DEFAULT 'media'
    CHECK (destination IN ('media', 'bookshelf'));

UPDATE library_roots SET destination = 'bookshelf' WHERE kind IN ('comic', 'novel');
