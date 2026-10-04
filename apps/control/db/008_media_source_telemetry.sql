BEGIN;

ALTER TABLE media_sources
  ADD COLUMN IF NOT EXISTS edge_device_id uuid REFERENCES edge_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_media_sources_device_seen
  ON media_sources(edge_device_id, last_seen_at DESC)
  WHERE edge_device_id IS NOT NULL;

COMMIT;
