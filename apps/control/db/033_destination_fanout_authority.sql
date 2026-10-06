BEGIN;

CREATE TABLE IF NOT EXISTS output_destination_credentials (
  output_destination_id uuid PRIMARY KEY REFERENCES output_destinations(id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  configured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stream_session_destinations
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS worker_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS process_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS process_exited_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_stream_session_destinations_worker_pending
  ON stream_session_destinations(status, updated_at)
  WHERE status IN ('pending','connecting','live');

CREATE INDEX IF NOT EXISTS idx_stream_session_destinations_heartbeat
  ON stream_session_destinations(last_heartbeat_at)
  WHERE status IN ('connecting','live');

-- Configuration state is not live state. Existing social rows that were marked
-- live/connecting before per-session fan-out authority existed are reduced to
-- ready/disconnected so the UI cannot inherit a stale global "live" claim.
UPDATE output_destinations
SET status=CASE WHEN enabled THEN 'ready' ELSE 'disconnected' END,
    updated_at=now()
WHERE destination_type IN ('youtube','facebook','tiktok','tiktok_rtmp','custom_rtmp')
  AND status IN ('connecting','live');

COMMIT;
