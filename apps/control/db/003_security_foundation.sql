BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','disabled')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email));

CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_organization_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, organization_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash char(64),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expiry
  ON auth_sessions(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS edge_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL,
  name text NOT NULL,
  platform text NOT NULL DEFAULT 'windows',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','offline','revoked')),
  credential_hash char(64),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  software_version text,
  last_seen_at timestamptz,
  last_ip inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_device_id uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_pairing_expiry
  ON device_pairing_codes(edge_device_id, expires_at DESC);

INSERT INTO roles (id, name, description)
VALUES
  ('owner', 'Owner', 'Full organization administration and licensing control'),
  ('admin', 'Administrator', 'Organization configuration and user administration'),
  ('pastor', 'Pastor', 'Service, sermon, pastoral and ministry oversight'),
  ('presenter_operator', 'Presenter Operator', 'Presentation queue, Preview and Program control'),
  ('media_operator', 'Media Operator', 'Cameras, audio, scenes, recording and livestream control'),
  ('translator', 'Translator', 'Translation channels, captions and interpretation controls'),
  ('finance', 'Finance', 'Future giving, finance and accounting workflows'),
  ('welfare', 'Welfare', 'Future welfare workflows with restricted records'),
  ('group_leader', 'Group Leader', 'Future ministry/group membership and attendance scope'),
  ('viewer', 'Viewer', 'Read-only operational dashboards')
ON CONFLICT (id) DO UPDATE
SET name=excluded.name,
    description=excluded.description;

COMMIT;
