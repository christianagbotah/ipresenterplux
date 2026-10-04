BEGIN;

CREATE TABLE IF NOT EXISTS edge_event_receipts (
  edge_device_id uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK (event_kind IN ('transcript','health','media')),
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  payload_hash char(64) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (edge_device_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_event_receipts_org_received
  ON edge_event_receipts(organization_id, received_at DESC);

COMMIT;
