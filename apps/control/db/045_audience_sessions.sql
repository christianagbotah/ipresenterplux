BEGIN;

CREATE TABLE IF NOT EXISTS audience_sessions (
  id uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  language_channel_id uuid REFERENCES language_channels(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_audience_sessions_service_seen
  ON audience_sessions(service_id,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_sessions_channel_seen
  ON audience_sessions(service_id,language_channel_id,last_seen_at DESC)
  WHERE language_channel_id IS NOT NULL;

COMMIT;
