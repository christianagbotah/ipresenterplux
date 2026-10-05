BEGIN;

ALTER TABLE voice_profiles
  ADD CONSTRAINT voice_profiles_provider_check
  CHECK (provider IS NULL OR provider IN ('google'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_profiles_active_speaker
  ON voice_profiles(organization_id, lower(source_speaker_id))
  WHERE source_speaker_id IS NOT NULL
    AND consent_status IN ('pending','consented');

COMMIT;
