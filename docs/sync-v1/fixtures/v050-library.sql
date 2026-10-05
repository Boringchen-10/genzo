-- Fictional pre-sync library. Run only after migrations 1..24 on a disposable database.
INSERT INTO works(id,title,type,favorite,rating,notes,created_at,updated_at)
VALUES('legacy-video','已整理动画','video',1,8.5,'原有个人笔记','2026-10-01','2026-10-01'),
      ('legacy-book','保留的小说','novel',0,7,'原有阅读笔记','2026-10-01','2026-10-01');
INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,size,created_at,updated_at)
VALUES('legacy-file','legacy-video','C:/FixtureOnly/01.mkv','01.mkv','mkv','video',123,'now','now');
INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at)
VALUES('legacy-video','bangumi','12345','now','now');
INSERT INTO work_field_locks(work_id,field_name,locked,updated_at) VALUES('legacy-video','title',1,'now');
INSERT INTO tags(id,name,created_at) VALUES('legacy-tag','人工标签','now');
INSERT INTO work_tags(work_id,tag_id,source) VALUES('legacy-video','legacy-tag','manual');
INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,completed,updated_at)
VALUES('legacy-file',45000,90000,0,'2026-10-01T00:00:00Z');
