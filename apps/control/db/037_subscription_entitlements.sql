BEGIN;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  billing_interval text NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('none','month','year','custom')),
  billing_interval_count integer NOT NULL DEFAULT 1 CHECK (billing_interval_count > 0),
  default_device_seat_limit integer NOT NULL DEFAULT 1 CHECK (default_device_seat_limit > 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features)='object'),
  numeric_limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(numeric_limits)='object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial','active','past_due','suspended','expired','cancelled')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  renews_at timestamptz,
  expires_at timestamptz,
  grace_until timestamptz,
  device_seat_limit integer CHECK (device_seat_limit IS NULL OR device_seat_limit > 0),
  billing_provider text,
  billing_customer_reference text,
  billing_subscription_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CHECK (expires_at IS NULL OR expires_at >= starts_at),
  CHECK (grace_until IS NULL OR expires_at IS NULL OR grace_until >= expires_at)
);

CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_org_status
  ON organization_subscriptions(organization_id,status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_subscriptions_current
  ON organization_subscriptions(organization_id)
  WHERE status IN ('trial','active','past_due','suspended');

CREATE TABLE IF NOT EXISTS product_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL,
  key_prefix text NOT NULL,
  key_salt bytea NOT NULL CHECK (octet_length(key_salt)=16),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash)=32),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked','exhausted','expired')),
  activation_limit integer NOT NULL DEFAULT 1 CHECK (activation_limit > 0),
  valid_until timestamptz,
  first_activated_at timestamptz,
  last_activated_at timestamptz,
  issued_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason text,
  note text,
  batch_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id, subscription_id),
  CONSTRAINT product_keys_subscription_scope_fk
    FOREIGN KEY (subscription_id,organization_id)
    REFERENCES organization_subscriptions(id,organization_id) ON DELETE CASCADE,
  CHECK (key_prefix ~ '^IPLX[A-HJ-NP-Z2-9]{4,8}$'),
  CHECK ((status='revoked') = (revoked_at IS NOT NULL) OR status <> 'revoked')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_keys_prefix ON product_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_product_keys_org_status
  ON product_keys(organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS product_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL,
  product_key_id uuid NOT NULL,
  edge_device_id uuid REFERENCES edge_devices(id) ON DELETE SET NULL,
  installation_id text NOT NULL CHECK (length(installation_id) BETWEEN 16 AND 200),
  platform text NOT NULL CHECK (length(platform) BETWEEN 2 AND 40),
  app_version text NOT NULL CHECK (length(app_version) BETWEEN 1 AND 80),
  device_name text NOT NULL CHECK (length(device_name) BETWEEN 1 AND 120),
  activation_token_salt bytea NOT NULL CHECK (octet_length(activation_token_salt)=16),
  activation_token_hash bytea NOT NULL CHECK (octet_length(activation_token_hash)=32),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','deactivated','revoked')),
  state_reason text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  last_entitlement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,installation_id),
  UNIQUE (id,organization_id,subscription_id),
  CONSTRAINT product_activations_subscription_scope_fk
    FOREIGN KEY (subscription_id,organization_id)
    REFERENCES organization_subscriptions(id,organization_id) ON DELETE CASCADE,
  CONSTRAINT product_activations_key_scope_fk
    FOREIGN KEY (product_key_id,organization_id,subscription_id)
    REFERENCES product_keys(id,organization_id,subscription_id) ON DELETE RESTRICT,
  CHECK (deactivated_at IS NULL OR state <> 'active')
);

CREATE INDEX IF NOT EXISTS idx_product_activations_org_state
  ON product_activations(organization_id,state,activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_activations_installation
  ON product_activations(installation_id,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_activations_active_edge
  ON product_activations(edge_device_id)
  WHERE edge_device_id IS NOT NULL AND state='active';

CREATE TABLE IF NOT EXISTS entitlement_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  signing_key_id text NOT NULL CHECK (length(signing_key_id) BETWEEN 1 AND 80),
  issued_at timestamptz NOT NULL DEFAULT now(),
  online_valid_until timestamptz NOT NULL,
  offline_grace_until timestamptz NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features)='object'),
  limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limits)='object'),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entitlement_leases_subscription_scope_fk
    FOREIGN KEY (subscription_id,organization_id)
    REFERENCES organization_subscriptions(id,organization_id) ON DELETE CASCADE,
  CONSTRAINT entitlement_leases_activation_scope_fk
    FOREIGN KEY (activation_id,organization_id,subscription_id)
    REFERENCES product_activations(id,organization_id,subscription_id) ON DELETE CASCADE,
  CHECK (online_valid_until >= issued_at),
  CHECK (offline_grace_until >= online_valid_until)
);

CREATE INDEX IF NOT EXISTS idx_entitlement_leases_active
  ON entitlement_leases(activation_id,offline_grace_until DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entitlement_leases_org_time
  ON entitlement_leases(organization_id,issued_at DESC);

CREATE TABLE IF NOT EXISTS product_activation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  product_key_id uuid REFERENCES product_keys(id) ON DELETE SET NULL,
  activation_id uuid REFERENCES product_activations(id) ON DELETE SET NULL,
  key_prefix text,
  installation_id text NOT NULL CHECK (length(installation_id) BETWEEN 1 AND 200),
  source_ip inet,
  outcome text NOT NULL
    CHECK (outcome IN ('success','invalid_key','rate_limited','seat_limit','subscription_inactive','key_inactive','activation_inactive','error')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_activation_attempts_prefix_time
  ON product_activation_attempts(key_prefix,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_activation_attempts_installation_time
  ON product_activation_attempts(installation_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_activation_attempts_ip_time
  ON product_activation_attempts(source_ip,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_activation_attempts_org_time
  ON product_activation_attempts(organization_id,occurred_at DESC);

COMMIT;
