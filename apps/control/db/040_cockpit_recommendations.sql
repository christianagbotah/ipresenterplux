BEGIN;

CREATE TABLE IF NOT EXISTS cockpit_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 220),
  recommendation_type text NOT NULL CHECK (length(btrim(recommendation_type)) BETWEEN 1 AND 96),
  target_type text NOT NULL CHECK (length(btrim(target_type)) BETWEEN 1 AND 64),
  target_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  confidence numeric(5,2) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  evidence text NOT NULL DEFAULT '' CHECK (length(evidence) <= 2000),
  source_observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'suggested'
    CHECK (state IN ('suggested','prepared','accepted','dismissed','expired')),
  preview_result_type text,
  preview_result_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_recommendations_service_scope_fk
    FOREIGN KEY (service_id,organization_id)
    REFERENCES services(id,organization_id) ON DELETE CASCADE,
  UNIQUE (service_id,source_key)
);

CREATE INDEX IF NOT EXISTS idx_cockpit_recommendations_service_state
  ON cockpit_recommendations(organization_id,service_id,state,confidence DESC,source_observed_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_cockpit_recommendations_expiry
  ON cockpit_recommendations(expires_at)
  WHERE state IN ('suggested','prepared');

CREATE TABLE IF NOT EXISTS cockpit_service_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  target_type text NOT NULL CHECK (length(btrim(target_type)) BETWEEN 1 AND 64),
  target_id text NOT NULL CHECK (length(btrim(target_id)) BETWEEN 1 AND 220),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_service_pins_service_scope_fk
    FOREIGN KEY (service_id,organization_id)
    REFERENCES services(id,organization_id) ON DELETE CASCADE,
  UNIQUE (service_id,target_type,target_id)
);

CREATE INDEX IF NOT EXISTS idx_cockpit_service_pins_service
  ON cockpit_service_pins(organization_id,service_id,updated_at DESC,id DESC);

COMMIT;
