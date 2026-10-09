BEGIN;

ALTER TABLE scripture_detections
  DROP CONSTRAINT IF EXISTS scripture_detections_detection_method_check;

ALTER TABLE scripture_detections
  ADD CONSTRAINT scripture_detections_detection_method_check
  CHECK (detection_method IN ('unknown','reference','context','quote','manual'));

COMMIT;
