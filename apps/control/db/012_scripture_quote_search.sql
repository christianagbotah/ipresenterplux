BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE scripture_detections
  ADD COLUMN IF NOT EXISTS detection_method text NOT NULL DEFAULT 'reference';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scripture_detections_detection_method_check'
  ) THEN
    ALTER TABLE scripture_detections
      ADD CONSTRAINT scripture_detections_detection_method_check
      CHECK (detection_method IN ('reference','context','quote'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bible_verses_text_trgm
  ON bible_verses USING gin (lower(text) gin_trgm_ops);

COMMIT;
