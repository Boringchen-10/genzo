-- V1 is opt-in. Existing business rows and IDs remain unchanged.
CREATE TABLE sync_runtime (
 id INTEGER PRIMARY KEY CHECK(id=1), device_id TEXT, counter INTEGER NOT NULL DEFAULT 0,
 clock_json TEXT NOT NULL DEFAULT '{}', applying INTEGER NOT NULL DEFAULT 0,
 tracking INTEGER NOT NULL DEFAULT 0, library_id TEXT, endpoint TEXT, credential_id TEXT,
 enabled INTEGER NOT NULL DEFAULT 0, allow_loopback_http INTEGER NOT NULL DEFAULT 0,
 creating INTEGER NOT NULL DEFAULT 0,
 last_success TEXT, error_code TEXT, device_name TEXT NOT NULL DEFAULT ''
);
INSERT INTO sync_runtime(id) VALUES(1);
CREATE TABLE sync_bindings (
 local_work_id TEXT PRIMARY KEY, entity_key TEXT NOT NULL UNIQUE, anchor TEXT,
 shadow_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE sync_journal (
 id INTEGER PRIMARY KEY AUTOINCREMENT, local_work_id TEXT NOT NULL, entity_key TEXT NOT NULL,
 context_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE sync_operations (id TEXT PRIMARY KEY, change_json TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 1);
CREATE INDEX sync_operations_pending ON sync_operations(pending);
CREATE TABLE sync_media_versions (
 media_file_id TEXT PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
 episode_key TEXT NOT NULL, version_key TEXT NOT NULL, size INTEGER NOT NULL,
 modified_at TEXT
);
CREATE TABLE sync_viewing_sessions (
 id TEXT PRIMARY KEY, media_file_id TEXT REFERENCES media_files(id) ON DELETE SET NULL,
 local_work_id TEXT NOT NULL, episode_key TEXT NOT NULL, version_key TEXT,
 started_at TEXT NOT NULL, observed_at TEXT NOT NULL, position_ms INTEGER NOT NULL,
 duration_ms INTEGER NOT NULL, completed INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sync_watched (
 local_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
 episode_key TEXT NOT NULL, watched INTEGER NOT NULL, PRIMARY KEY(local_work_id,episode_key)
);
CREATE VIEW sync_work_snapshot AS SELECT w.id local_work_id,b.entity_key,(SELECT json_group_object(key,json(CASE type WHEN 'text' THEN json_quote(value) WHEN 'null' THEN 'null' WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE value END)) FROM (SELECT key,value,type FROM json_each(json_object('title',w.title,'originalTitle',w.original_title,'description',w.description,'year',w.metadata_year,'status',w.status,'favorite',json(CASE w.favorite WHEN 1 THEN 'true' ELSE 'false' END),'rating',w.rating,'notes',w.notes)) UNION ALL SELECT key,value,type FROM json_each(CASE WHEN b.anchor IS NULL THEN '{}' ELSE json_object('anchor',b.anchor) END) UNION ALL SELECT key,value,type FROM json_each(CASE WHEN w.cover_path LIKE 'https://%' THEN json_object('coverUrl',w.cover_path) WHEN NOT EXISTS(SELECT 1 FROM work_field_locks WHERE work_id=w.id AND field_name='cover_path' AND locked=1) AND (SELECT json_extract(response_json,'$.coverUrl') FROM metadata_provider_records WHERE work_id=w.id AND json_valid(response_json) AND json_extract(response_json,'$.coverUrl') LIKE 'https://%' ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1) IS NOT NULL THEN json_object('coverUrl',(SELECT json_extract(response_json,'$.coverUrl') FROM metadata_provider_records WHERE work_id=w.id AND json_valid(response_json) AND json_extract(response_json,'$.coverUrl') LIKE 'https://%' ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1)) ELSE '{}' END) UNION ALL SELECT key,value,type FROM json_each(CASE WHEN w.banner_path LIKE 'https://%' THEN json_object('bannerUrl',w.banner_path) WHEN NOT EXISTS(SELECT 1 FROM work_field_locks WHERE work_id=w.id AND field_name='banner_path' AND locked=1) AND (SELECT json_extract(response_json,'$.bannerUrl') FROM metadata_provider_records WHERE work_id=w.id AND json_valid(response_json) AND json_extract(response_json,'$.bannerUrl') LIKE 'https://%' ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1) IS NOT NULL THEN json_object('bannerUrl',(SELECT json_extract(response_json,'$.bannerUrl') FROM metadata_provider_records WHERE work_id=w.id AND json_valid(response_json) AND json_extract(response_json,'$.bannerUrl') LIKE 'https://%' ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1)) ELSE '{}' END) UNION ALL SELECT key,value,type FROM json_each((SELECT json_group_object('id.'||provider,external_id) FROM work_external_ids WHERE work_id=w.id AND provider IN ('bangumi','tmdb','anilist'))) UNION ALL SELECT key,value,type FROM json_each((SELECT json_group_object('tag.'||lower(t.name),json('true')) FROM work_tags wt JOIN tags t ON t.id=wt.tag_id WHERE wt.work_id=w.id)) UNION ALL SELECT key,value,type FROM json_each((SELECT json_group_object('lock.'||CASE field_name WHEN 'original_title' THEN 'originalTitle' WHEN 'cover_path' THEN 'coverUrl' WHEN 'banner_path' THEN 'bannerUrl' WHEN 'metadata_year' THEN 'year' ELSE field_name END,json(CASE locked WHEN 1 THEN 'true' ELSE 'false' END)) FROM work_field_locks WHERE work_id=w.id AND field_name IN ('title','original_title','description','cover_path','banner_path','year','metadata_year','tags'))) UNION ALL SELECT key,value,type FROM json_each((SELECT json_group_object('source.'||CASE field_name WHEN 'original_title' THEN 'originalTitle' WHEN 'cover_path' THEN 'coverUrl' WHEN 'banner_path' THEN 'bannerUrl' WHEN 'metadata_year' THEN 'year' ELSE field_name END,provider) FROM work_field_sources WHERE work_id=w.id AND field_name IN ('title','original_title','description','cover_path','banner_path','year','metadata_year','tags') AND provider IN ('manual','bangumi','tmdb','anilist','sync'))) UNION ALL SELECT key,value,type FROM json_each((SELECT json_group_object('episode.'||provider||'/'||external_id,json_object('number',episode_number,'sort',sort_number,'episodeType',COALESCE(episode_type,0),'title',title,'originalTitle',original_title,'description',description,'airDate',air_date,'duration',duration)) FROM anime_episodes WHERE work_id=w.id AND provider IN ('bangumi','tmdb'))) UNION ALL SELECT key,value,type FROM json_each((SELECT json_group_object('watched.'||episode_key,json(CASE watched WHEN 1 THEN 'true' ELSE 'false' END)) FROM sync_watched WHERE local_work_id=w.id)) UNION ALL SELECT key,value,type FROM json_each((SELECT json_group_object('session.'||id,json_object('episodeKey',episode_key,'versionKey',version_key,'startedAt',started_at,'observedAt',observed_at,'positionMs',position_ms,'durationMs',duration_ms,'completed',json(CASE completed WHEN 1 THEN 'true' ELSE 'false' END),'ended',json(CASE ended WHEN 1 THEN 'true' ELSE 'false' END))) FROM sync_viewing_sessions WHERE local_work_id=w.id)))) snapshot_json FROM works w JOIN sync_bindings b ON b.local_work_id=w.id WHERE w.type='video';
CREATE TRIGGER sync_work_insert AFTER INSERT ON works WHEN NEW.type='video' AND (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT OR IGNORE INTO sync_bindings(local_work_id,entity_key) VALUES(NEW.id,'work/'||lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6))));
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.id;
END;
CREATE TRIGGER sync_work_update AFTER UPDATE ON works WHEN NEW.type='video' AND (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT OR IGNORE INTO sync_bindings(local_work_id,entity_key) VALUES(NEW.id,'work/'||lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6))));
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.id;
END;
CREATE TRIGGER sync_work_delete BEFORE DELETE ON works WHEN OLD.type='video' AND (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT OLD.id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),'{"deleted":true}',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_bindings WHERE local_work_id=OLD.id;
END;
CREATE TRIGGER sync_work_external_ids_insert AFTER INSERT ON work_external_ids WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 UPDATE sync_bindings SET anchor=CASE NEW.provider WHEN 'bangumi' THEN 'bangumi/'||NEW.external_id WHEN 'tmdb' THEN 'tmdb/'||NEW.external_id END WHERE local_work_id=NEW.work_id AND anchor IS NULL AND NEW.provider IN ('bangumi','tmdb');
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_external_ids_update AFTER UPDATE ON work_external_ids WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 UPDATE sync_bindings SET anchor=CASE NEW.provider WHEN 'bangumi' THEN 'bangumi/'||NEW.external_id WHEN 'tmdb' THEN 'tmdb/'||NEW.external_id END WHERE local_work_id=NEW.work_id AND anchor IS NULL AND NEW.provider IN ('bangumi','tmdb');
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_external_ids_delete AFTER DELETE ON work_external_ids WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.work_id;
END;
CREATE TRIGGER sync_work_field_locks_insert AFTER INSERT ON work_field_locks WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_field_locks_update AFTER UPDATE ON work_field_locks WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_field_locks_delete AFTER DELETE ON work_field_locks WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.work_id;
END;
CREATE TRIGGER sync_work_field_sources_insert AFTER INSERT ON work_field_sources WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_field_sources_update AFTER UPDATE ON work_field_sources WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_field_sources_delete AFTER DELETE ON work_field_sources WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.work_id;
END;
CREATE TRIGGER sync_work_tags_insert AFTER INSERT ON work_tags WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_tags_update AFTER UPDATE ON work_tags WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_work_tags_delete AFTER DELETE ON work_tags WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.work_id;
END;
CREATE TRIGGER sync_anime_episodes_insert AFTER INSERT ON anime_episodes WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_anime_episodes_update AFTER UPDATE ON anime_episodes WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_anime_episodes_delete AFTER DELETE ON anime_episodes WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.work_id;
END;
CREATE TRIGGER sync_sync_watched_insert AFTER INSERT ON sync_watched WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.local_work_id;
END;
CREATE TRIGGER sync_sync_watched_update AFTER UPDATE ON sync_watched WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.local_work_id;
END;
CREATE TRIGGER sync_sync_watched_delete AFTER DELETE ON sync_watched WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.local_work_id;
END;
CREATE TRIGGER sync_sync_viewing_sessions_insert AFTER INSERT ON sync_viewing_sessions WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.local_work_id;
END;
CREATE TRIGGER sync_sync_viewing_sessions_update AFTER UPDATE ON sync_viewing_sessions WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.local_work_id;
END;
CREATE TRIGGER sync_sync_viewing_sessions_delete AFTER DELETE ON sync_viewing_sessions WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.local_work_id;
END;
CREATE TRIGGER sync_provider_record_insert AFTER INSERT ON metadata_provider_records WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_provider_record_update AFTER UPDATE ON metadata_provider_records WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=NEW.work_id;
END;
CREATE TRIGGER sync_provider_record_delete AFTER DELETE ON metadata_provider_records WHEN (SELECT tracking=1 AND applying=0 FROM sync_runtime WHERE id=1) BEGIN
 INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM sync_work_snapshot WHERE local_work_id=OLD.work_id;
END;
