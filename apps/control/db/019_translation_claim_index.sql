BEGIN;

DROP INDEX IF EXISTS idx_translation_jobs_claimable;
CREATE INDEX idx_translation_jobs_claimable
  ON transcript_translation_jobs(status,next_attempt_at,lease_expires_at,created_at,id)
  WHERE status IN ('pending','processing','failed');

COMMIT;
