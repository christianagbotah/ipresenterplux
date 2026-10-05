BEGIN;

CREATE TABLE IF NOT EXISTS translation_worker_status (
  worker_id text PRIMARY KEY,
  provider text NOT NULL,
  state text NOT NULL CHECK (state IN ('disabled','ready','degraded','stopping')),
  software_version text,
  claimed_count integer NOT NULL DEFAULT 0 CHECK (claimed_count >= 0),
  completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  error_code text,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_translation_worker_status_observed
  ON translation_worker_status(observed_at DESC, worker_id);

COMMIT;
