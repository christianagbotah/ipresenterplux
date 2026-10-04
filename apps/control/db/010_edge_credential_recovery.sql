BEGIN;

ALTER TABLE edge_device_credentials
  ADD COLUMN IF NOT EXISTS enrollment_pairing_id uuid REFERENCES device_pairing_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recovery_envelope text,
  ADD COLUMN IF NOT EXISTS recovery_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_edge_credentials_recovery_pairing
  ON edge_device_credentials(enrollment_pairing_id, recovery_expires_at DESC)
  WHERE recovery_envelope IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_edge_credentials_recovery_replacement
  ON edge_device_credentials(replaces_credential_id, recovery_expires_at DESC)
  WHERE recovery_envelope IS NOT NULL;

COMMIT;
