BEGIN;

ALTER TABLE transcript_segments
  ADD COLUMN IF NOT EXISTS source_language text,
  ADD COLUMN IF NOT EXISTS speaker_id text,
  ADD COLUMN IF NOT EXISTS asr_confidence double precision;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='transcript_segments_asr_confidence_range'
  ) THEN
    ALTER TABLE transcript_segments
      ADD CONSTRAINT transcript_segments_asr_confidence_range
      CHECK (asr_confidence IS NULL OR (asr_confidence >= 0 AND asr_confidence <= 1));
  END IF;
END $$;

COMMIT;
