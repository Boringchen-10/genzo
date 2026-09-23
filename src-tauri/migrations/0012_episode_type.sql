PRAGMA foreign_keys = ON;

-- Bangumi 分集类型：0 正片、1 特别篇、2 OP、3 ED、4 预告、5 MAD、6 其他。
-- 旧记录留空，按正片处理；刷新一次作品元数据即可补齐类型。
ALTER TABLE anime_episodes ADD COLUMN episode_type INTEGER
  CHECK (episode_type IS NULL OR episode_type >= 0);