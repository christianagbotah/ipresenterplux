BEGIN;

CREATE TABLE IF NOT EXISTS transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(btrim(text)) > 0),
  source_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_service_source_order
  ON transcript_segments(service_id, source_observed_at DESC, created_at DESC, id DESC);

COMMIT;
