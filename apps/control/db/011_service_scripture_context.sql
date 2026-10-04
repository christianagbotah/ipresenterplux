BEGIN;

ALTER TABLE scripture_detections
  ADD COLUMN IF NOT EXISTS source_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_ordinal integer NOT NULL DEFAULT 0;

UPDATE scripture_detections
SET source_observed_at = detected_at
WHERE source_observed_at IS NULL;

ALTER TABLE scripture_detections
  ALTER COLUMN source_observed_at SET DEFAULT now(),
  ALTER COLUMN source_observed_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scripture_detections_source_ordinal_nonnegative'
  ) THEN
    ALTER TABLE scripture_detections
      ADD CONSTRAINT scripture_detections_source_ordinal_nonnegative CHECK (source_ordinal >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scripture_detections_service_source_order
  ON scripture_detections(service_id, source_observed_at DESC, source_ordinal DESC, detected_at DESC);

CREATE TABLE IF NOT EXISTS service_scripture_context (
  service_id uuid PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
  book text NOT NULL,
  chapter integer NOT NULL CHECK (chapter > 0),
  verse_start integer NOT NULL CHECK (verse_start > 0),
  verse_end integer,
  bible_version text NOT NULL,
  source_observed_at timestamptz NOT NULL,
  source_ordinal integer NOT NULL DEFAULT 0 CHECK (source_ordinal >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verse_end IS NULL OR verse_end >= verse_start)
);

INSERT INTO service_scripture_context
  (service_id,book,chapter,verse_start,verse_end,bible_version,source_observed_at,source_ordinal,updated_at)
SELECT DISTINCT ON (service_id)
  service_id,book,chapter,verse_start,verse_end,bible_version,source_observed_at,source_ordinal,now()
FROM scripture_detections
WHERE book IS NOT NULL
  AND chapter IS NOT NULL AND chapter > 0
  AND verse_start IS NOT NULL AND verse_start > 0
  AND (verse_end IS NULL OR verse_end >= verse_start)
  AND state <> 'dismissed'
ORDER BY service_id,source_observed_at DESC,source_ordinal DESC,detected_at DESC,id DESC
ON CONFLICT (service_id) DO NOTHING;

COMMIT;
