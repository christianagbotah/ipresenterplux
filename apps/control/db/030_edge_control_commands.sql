BEGIN;

CREATE TABLE IF NOT EXISTS edge_control_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  edge_device_id uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  command_type text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','delivered','succeeded','failed','expired')),
  issued_by uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  delivered_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at timestamptz,
  resulting_state text,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at),
  CHECK (
    (state IN ('pending','delivered') AND completed_at IS NULL)
    OR (state IN ('succeeded','failed','expired'))
  )
);

CREATE INDEX IF NOT EXISTS idx_edge_control_commands_delivery
  ON edge_control_commands(edge_device_id, issued_at)
  WHERE state IN ('pending','delivered');

CREATE INDEX IF NOT EXISTS idx_edge_control_commands_org_time
  ON edge_control_commands(organization_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_control_commands_service_time
  ON edge_control_commands(service_id, issued_at DESC)
  WHERE service_id IS NOT NULL;

COMMIT;
