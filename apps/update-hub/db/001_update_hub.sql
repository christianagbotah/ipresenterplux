BEGIN;

CREATE TABLE IF NOT EXISTS products (
  id bigserial PRIMARY KEY,
  product_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS releases (
  id bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id),
  version text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('beta','stable')),
  platform text NOT NULL,
  architecture text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','paused','withdrawn')),
  rollout integer NOT NULL DEFAULT 100 CHECK (rollout BETWEEN 0 AND 100),
  minimum_version text,
  release_notes text NOT NULL DEFAULT '',
  manifest_path text,
  signature_path text,
  rollback_release_id bigint REFERENCES releases(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, version, channel, platform, architecture)
);

CREATE TABLE IF NOT EXISTS release_artifacts (
  id bigserial PRIMARY KEY,
  release_id bigint NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('full','delta','installer')),
  source_version text,
  public_path text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS release_events (
  id bigserial PRIMARY KEY,
  release_id bigint REFERENCES releases(id) ON DELETE SET NULL,
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS releases_lookup_idx
  ON releases(product_id, channel, platform, architecture, state, published_at DESC);

COMMIT;
