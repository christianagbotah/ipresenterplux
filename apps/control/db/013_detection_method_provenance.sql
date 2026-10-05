BEGIN;

ALTER TABLE scripture_detections
  DROP CONSTRAINT IF EXISTS scripture_detections_detection_method_check;

UPDATE scripture_detections
SET detection_method = 'unknown'
WHERE detection_method = 'reference'
  AND detected_at < COALESCE(
    (SELECT applied_at FROM schema_migrations WHERE filename = '012_scripture_quote_search.sql'),
    now()
  );

ALTER TABLE scripture_detections
  ADD CONSTRAINT scripture_detections_detection_method_check
  CHECK (detection_method IN ('unknown','reference','context','quote'));

COMMIT;
