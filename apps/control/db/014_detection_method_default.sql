BEGIN;

ALTER TABLE scripture_detections
  DROP CONSTRAINT IF EXISTS scripture_detections_detection_method_check;

ALTER TABLE scripture_detections
  ALTER COLUMN detection_method SET DEFAULT 'unknown';

UPDATE scripture_detections
SET detection_method = 'unknown'
WHERE detection_method = 'reference';

ALTER TABLE scripture_detections
  ADD CONSTRAINT scripture_detections_detection_method_check
  CHECK (detection_method IN ('unknown','reference','context','quote'));

COMMIT;
