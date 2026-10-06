BEGIN;

CREATE TABLE IF NOT EXISTS output_destination_provider_accounts (
  output_destination_id uuid PRIMARY KEY REFERENCES output_destinations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('youtube')),
  token_ciphertext text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  provider_stream_id text,
  connected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  token_expires_at timestamptz,
  refreshed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(scopes) <= 8 AND octet_length(array_to_string(scopes, ',')) <= 1024),
  CHECK (provider_stream_id IS NULL OR octet_length(provider_stream_id) <= 512)
);

CREATE TABLE IF NOT EXISTS output_destination_oauth_states (
  state_hash char(64) PRIMARY KEY,
  output_destination_id uuid NOT NULL REFERENCES output_destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('youtube')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_output_destination_oauth_states_expiry
  ON output_destination_oauth_states(expires_at)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_output_destination_provider_accounts_updated
  ON output_destination_provider_accounts(provider, updated_at DESC);

COMMIT;
