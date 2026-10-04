BEGIN;

DROP INDEX IF EXISTS uq_edge_device_current_credential;

CREATE UNIQUE INDEX IF NOT EXISTS uq_edge_device_active_credential
  ON edge_device_credentials(edge_device_id)
  WHERE state='active';

COMMIT;
