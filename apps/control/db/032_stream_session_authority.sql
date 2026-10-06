BEGIN;

ALTER TABLE stream_sessions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS router_path text,
  ADD COLUMN IF NOT EXISTS router_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS router_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS router_not_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_sessions_one_active_service
  ON stream_sessions(service_id)
  WHERE status IN ('starting','live','stopping');

CREATE INDEX IF NOT EXISTS idx_stream_sessions_service_created
  ON stream_sessions(service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stream_session_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_session_id uuid NOT NULL REFERENCES stream_sessions(id) ON DELETE CASCADE,
  output_destination_id uuid NOT NULL REFERENCES output_destinations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','connecting','live','warning','error','ended','skipped')),
  last_error_code text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stream_session_id, output_destination_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_session_destinations_session_status
  ON stream_session_destinations(stream_session_id, status);

COMMIT;
