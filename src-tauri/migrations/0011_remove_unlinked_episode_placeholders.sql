-- A reverted build persisted local/unverified placeholders alongside the
-- official episodes. Remove only redundant, unreferenced generated rows.
-- Never cascade a user's episode association or remove unmatched local episodes.
DELETE FROM anime_episodes
WHERE provider = 'local'
  AND substr(external_id, 1, 17) = 'local/unverified:'
  AND description = 'local/unverified'
  AND EXISTS (
    SELECT 1 FROM anime_episodes official
    WHERE official.work_id = anime_episodes.work_id
      AND official.provider = 'bangumi'
      AND official.episode_number = anime_episodes.episode_number
  )
  AND NOT EXISTS (
    SELECT 1 FROM media_episode_links link
    WHERE link.work_id = anime_episodes.work_id
      AND link.provider = anime_episodes.provider
      AND link.episode_external_id = anime_episodes.external_id
  );
