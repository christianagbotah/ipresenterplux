BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE speech_synthesis_jobs
  ADD COLUMN IF NOT EXISTS source_text_hash char(64);

UPDATE speech_synthesis_jobs sj
SET source_text_hash=encode(digest(j.translated_text,'sha256'),'hex')
FROM transcript_translation_jobs j
WHERE j.id=sj.translation_job_id
  AND sj.source_text_hash IS NULL
  AND j.translated_text IS NOT NULL
  AND length(btrim(j.translated_text)) > 0;

ALTER TABLE speech_synthesis_jobs
  ALTER COLUMN source_text_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='speech_synthesis_jobs_source_hash_check'
  ) THEN
    ALTER TABLE speech_synthesis_jobs
      ADD CONSTRAINT speech_synthesis_jobs_source_hash_check
      CHECK (source_text_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='language_channels_organization_id_id_key'
  ) THEN
    ALTER TABLE language_channels
      ADD CONSTRAINT language_channels_organization_id_id_key UNIQUE (organization_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='speech_synthesis_jobs_org_channel_fk'
  ) THEN
    ALTER TABLE speech_synthesis_jobs
      ADD CONSTRAINT speech_synthesis_jobs_org_channel_fk
      FOREIGN KEY (organization_id, language_channel_id)
      REFERENCES language_channels(organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
