BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='services_id_organization_id_key'
  ) THEN
    ALTER TABLE services ADD CONSTRAINT services_id_organization_id_key UNIQUE (id, organization_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_speaker_overrides (
  service_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  voice_profile_id uuid NOT NULL,
  set_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (service_id, organization_id)
    REFERENCES services(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, voice_profile_id)
    REFERENCES voice_profiles(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE transcript_segments
  ADD COLUMN IF NOT EXISTS speaker_source text;

UPDATE transcript_segments
SET speaker_source=CASE WHEN speaker_id IS NULL THEN 'unknown' ELSE 'asr' END
WHERE speaker_source IS NULL;

ALTER TABLE transcript_segments
  ALTER COLUMN speaker_source SET DEFAULT 'unknown',
  ALTER COLUMN speaker_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='transcript_segments_speaker_source_check'
  ) THEN
    ALTER TABLE transcript_segments
      ADD CONSTRAINT transcript_segments_speaker_source_check
      CHECK (speaker_source IN ('unknown','asr','operator_override'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_speaker_overrides_org
  ON service_speaker_overrides(organization_id, updated_at DESC);

COMMIT;
