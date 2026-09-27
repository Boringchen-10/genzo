-- Provider season numbering is independent of Bangumi's work/episode identity.
ALTER TABLE episode_artwork_sources ADD COLUMN episode_offset INTEGER NOT NULL DEFAULT 0 CHECK(episode_offset BETWEEN -9999 AND 9999);
