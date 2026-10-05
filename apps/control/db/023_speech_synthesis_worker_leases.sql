BEGIN;

ALTER TABLE speech_synthesis_jobs
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_speech_synthesis_jobs_claimable
  ON speech_synthesis_jobs(status,next_attempt_at,lease_expires_at,created_at,id)
  WHERE status IN ('pending','processing');

COMMIT;
