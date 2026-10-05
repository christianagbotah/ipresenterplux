BEGIN;

ALTER TABLE voice_profiles
  ADD COLUMN IF NOT EXISTS consent_method text,
  ADD COLUMN IF NOT EXISTS consent_reference text,
  ADD COLUMN IF NOT EXISTS consent_recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

ALTER TABLE voice_profiles
  ADD CONSTRAINT voice_profiles_consent_method_check
    CHECK (consent_method IS NULL OR consent_method IN ('written','recorded_verbal','self_service')),
  ADD CONSTRAINT voice_profiles_consent_evidence_check
    CHECK (
      (consent_status='pending'
        AND consented_at IS NULL AND revoked_at IS NULL
        AND consent_method IS NULL AND consent_reference IS NULL
        AND consent_recorded_by IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
      OR
      (consent_status='consented'
        AND consented_at IS NOT NULL AND revoked_at IS NULL
        AND consent_method IS NOT NULL
        AND consent_reference IS NOT NULL AND length(btrim(consent_reference)) >= 3
        AND consent_recorded_by IS NOT NULL
        AND revoked_by IS NULL AND revocation_reason IS NULL)
      OR
      (consent_status='revoked'
        AND consented_at IS NOT NULL AND revoked_at IS NOT NULL
        AND consent_method IS NOT NULL
        AND consent_reference IS NOT NULL AND length(btrim(consent_reference)) >= 3
        AND consent_recorded_by IS NOT NULL
        AND revoked_by IS NOT NULL
        AND revocation_reason IS NOT NULL AND length(btrim(revocation_reason)) >= 3)
    );

CREATE INDEX IF NOT EXISTS idx_voice_profiles_org_created
  ON voice_profiles(organization_id, created_at DESC, id);

COMMIT;
