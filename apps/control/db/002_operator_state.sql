BEGIN;

ALTER TABLE scripture_detections
  DROP CONSTRAINT IF EXISTS scripture_detections_state_check;

ALTER TABLE scripture_detections
  ADD CONSTRAINT scripture_detections_state_check
  CHECK (state IN ('detected','preview','live','played','dismissed'));

CREATE INDEX IF NOT EXISTS idx_scripture_detections_service_state
  ON scripture_detections(service_id, state, detected_at DESC);

COMMIT;
