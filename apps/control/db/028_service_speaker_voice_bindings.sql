BEGIN;

CREATE TABLE IF NOT EXISTS service_speaker_voice_bindings (
  service_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  speaker_id text NOT NULL CHECK (
    length(btrim(speaker_id)) BETWEEN 1 AND 64
    AND speaker_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  voice_profile_id uuid NOT NULL,
  set_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (service_id, speaker_id),
  FOREIGN KEY (service_id, organization_id)
    REFERENCES services(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, voice_profile_id)
    REFERENCES voice_profiles(organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_speaker_voice_binding_label
  ON service_speaker_voice_bindings(service_id, lower(speaker_id));

CREATE INDEX IF NOT EXISTS idx_service_speaker_voice_bindings_profile
  ON service_speaker_voice_bindings(organization_id, voice_profile_id, updated_at DESC);

COMMIT;
