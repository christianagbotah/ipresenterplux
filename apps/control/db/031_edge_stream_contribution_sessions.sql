BEGIN;

CREATE TABLE IF NOT EXISTS edge_stream_contribution_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  edge_device_id uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  protocol text NOT NULL CHECK (protocol IN ('srt','rtmps','whip')),
  token_hash text NOT NULL UNIQUE,
  router_authority text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_edge_stream_contribution_device_service
  ON edge_stream_contribution_sessions(edge_device_id, service_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_stream_contribution_expiry
  ON edge_stream_contribution_sessions(expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
