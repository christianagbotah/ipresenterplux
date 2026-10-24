BEGIN;

ALTER TABLE voice_profiles
  DROP CONSTRAINT IF EXISTS voice_profiles_provider_check;

ALTER TABLE voice_profiles
  ADD CONSTRAINT voice_profiles_provider_check
  CHECK (provider IS NULL OR provider IN ('google','ghananlp'));

COMMIT;
