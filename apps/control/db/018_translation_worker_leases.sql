BEGIN;

ALTER TABLE transcript_translation_jobs
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_translation_jobs_claimable
  ON transcript_translation_jobs(status,next_attempt_at,lease_expires_at,created_at,id);

COMMIT;
