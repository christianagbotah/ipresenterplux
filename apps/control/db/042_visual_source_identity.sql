BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM media_sources
     WHERE edge_device_id IS NOT NULL
       AND source_key IS NOT NULL
     GROUP BY organization_id, edge_device_id, source_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'visual_source_identity_duplicate_preflight_failed: duplicate non-null organization/edge/source tuples exist in media_sources';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_sources_edge_source_identity
  ON media_sources(organization_id, edge_device_id, source_key)
  WHERE edge_device_id IS NOT NULL AND source_key IS NOT NULL;

COMMIT;
