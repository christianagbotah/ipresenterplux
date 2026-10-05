BEGIN;

CREATE TABLE IF NOT EXISTS voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  source_speaker_id text,
  consent_status text NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending','consented','revoked')),
  consented_at timestamptz,
  revoked_at timestamptz,
  provider text,
  provider_voice_id text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, id),
  CHECK (
    provider_voice_id IS NULL
    OR (consent_status='consented' AND consented_at IS NOT NULL AND revoked_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS speech_synthesis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  translation_job_id uuid NOT NULL UNIQUE REFERENCES transcript_translation_jobs(id) ON DELETE CASCADE,
  language_channel_id uuid NOT NULL REFERENCES language_channels(id) ON DELETE CASCADE,
  target_language_code text NOT NULL,
  voice_profile_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','succeeded','failed')),
  provider text,
  audio_storage_key text,
  audio_content_type text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, voice_profile_id)
    REFERENCES voice_profiles(organization_id, id) ON DELETE SET NULL (voice_profile_id),
  CHECK (
    status <> 'succeeded'
    OR (
      audio_storage_key IS NOT NULL AND length(btrim(audio_storage_key)) > 0
      AND audio_content_type IS NOT NULL AND audio_content_type LIKE 'audio/%'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_speech_synthesis_jobs_status_created
  ON speech_synthesis_jobs(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_speech_synthesis_jobs_channel_status
  ON speech_synthesis_jobs(language_channel_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_org_status
  ON voice_profiles(organization_id, consent_status, display_name);

INSERT INTO speech_synthesis_jobs
  (organization_id,translation_job_id,language_channel_id,target_language_code)
SELECT s.organization_id,j.id,j.language_channel_id,j.target_language_code
FROM transcript_translation_jobs j
JOIN transcript_segments ts ON ts.id=j.transcript_segment_id
JOIN services s ON s.id=ts.service_id
JOIN language_channels lc ON lc.id=j.language_channel_id
WHERE j.status='succeeded'
  AND j.channel_mode='translation_audio'
  AND j.translated_text IS NOT NULL
  AND length(btrim(j.translated_text)) > 0
  AND lc.organization_id=s.organization_id
  AND lc.channel_mode='translation_audio'
ON CONFLICT (translation_job_id) DO NOTHING;

COMMIT;
