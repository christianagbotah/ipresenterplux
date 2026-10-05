BEGIN;

CREATE TABLE IF NOT EXISTS transcript_translation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_segment_id uuid NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
  language_channel_id uuid NOT NULL REFERENCES language_channels(id) ON DELETE CASCADE,
  target_language_code text NOT NULL,
  channel_mode text NOT NULL CHECK (channel_mode IN ('translation_text','translation_audio')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed')),
  translated_text text,
  provider text,
  error_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transcript_segment_id, language_channel_id),
  CHECK (
    status <> 'succeeded'
    OR (translated_text IS NOT NULL AND length(btrim(translated_text)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_transcript_translation_jobs_status_created
  ON transcript_translation_jobs(status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_transcript_translation_jobs_segment
  ON transcript_translation_jobs(transcript_segment_id, language_channel_id, status);

COMMIT;
