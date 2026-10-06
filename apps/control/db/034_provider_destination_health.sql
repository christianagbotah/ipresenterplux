BEGIN;

ALTER TABLE stream_session_destinations
  ADD COLUMN IF NOT EXISTS provider_health_state text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS provider_live_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS provider_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_issue_codes text[] NOT NULL DEFAULT ARRAY[]::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='stream_session_destinations_provider_health_state_check'
  ) THEN
    ALTER TABLE stream_session_destinations
      ADD CONSTRAINT stream_session_destinations_provider_health_state_check
      CHECK (provider_health_state IN ('unverified','checking','healthy','warning','error','unsupported'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='stream_session_destinations_provider_live_state_check'
  ) THEN
    ALTER TABLE stream_session_destinations
      ADD CONSTRAINT stream_session_destinations_provider_live_state_check
      CHECK (provider_live_state IN ('unknown','receiving','live','not_live','error'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='stream_session_destinations_provider_issue_codes_check'
  ) THEN
    ALTER TABLE stream_session_destinations
      ADD CONSTRAINT stream_session_destinations_provider_issue_codes_check
      CHECK (
        cardinality(provider_issue_codes) <= 8
        AND octet_length(array_to_string(provider_issue_codes, ',')) <= 512
      );
  END IF;
END $$;

-- Existing rows predate provider evidence. Custom/local destinations cannot be
-- verified by a social-provider API, while YouTube/Facebook/TikTok remain
-- explicitly unverified until an approved provider adapter is connected.
UPDATE stream_session_destinations ssd
SET provider_health_state = CASE
      WHEN od.destination_type IN ('youtube','facebook','tiktok','tiktok_rtmp') THEN 'unverified'
      ELSE 'unsupported'
    END,
    provider_live_state = 'unknown',
    provider_issue_codes = ARRAY[]::text[],
    updated_at = now()
FROM output_destinations od
WHERE od.id=ssd.output_destination_id
  AND ssd.provider_checked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stream_session_destinations_provider_health
  ON stream_session_destinations(stream_session_id, provider_health_state, provider_checked_at DESC);

COMMIT;
