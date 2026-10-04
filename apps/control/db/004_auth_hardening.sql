BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS force_password_change boolean NOT NULL DEFAULT false;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
  ON auth_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id bigserial PRIMARY KEY,
  email_hash char(64) NOT NULL,
  ip_hash char(64),
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_email_time
  ON auth_login_attempts(email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_ip_time
  ON auth_login_attempts(ip_hash, created_at DESC);

COMMIT;
