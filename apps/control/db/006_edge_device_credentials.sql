BEGIN;

CREATE TABLE IF NOT EXISTS edge_device_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_device_id uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  credential_hash char(64) NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','rotation_required','revoked')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  replaces_credential_id uuid REFERENCES edge_device_credentials(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state = 'revoked' AND revoked_at IS NOT NULL)
    OR (state <> 'revoked' AND revoked_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_edge_device_credentials_device
  ON edge_device_credentials(edge_device_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_device_credentials_lookup
  ON edge_device_credentials(credential_hash, state, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_edge_device_current_credential
  ON edge_device_credentials(edge_device_id)
  WHERE state IN ('active','rotation_required');

CREATE INDEX IF NOT EXISTS idx_pairing_code_available
  ON device_pairing_codes(code_hash, expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
