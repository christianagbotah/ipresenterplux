BEGIN;

-- Contribution paths are stable per service (`service/<uuid>`), so they must be
-- reusable across broadcasts. Migration 031 made stream_path globally unique,
-- which prevents a second grant for the same service even after revocation.
-- Preserve history while allowing exactly one unrevoked owner of a path.
ALTER TABLE edge_stream_contribution_sessions
  DROP CONSTRAINT IF EXISTS edge_stream_contribution_sessions_stream_path_key;

WITH ranked_grants AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY stream_path
           ORDER BY coalesce(last_seen_at,issued_at) DESC,issued_at DESC,id DESC
         ) AS path_rank
  FROM edge_stream_contribution_sessions
  WHERE revoked_at IS NULL
)
UPDATE edge_stream_contribution_sessions ecs
SET revoked_at=coalesce(ecs.revoked_at,now()),updated_at=now()
FROM ranked_grants r
WHERE ecs.id=r.id
  AND r.path_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_edge_stream_contribution_active_path
  ON edge_stream_contribution_sessions(stream_path)
  WHERE revoked_at IS NULL;

ALTER TABLE stream_sessions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS router_path text,
  ADD COLUMN IF NOT EXISTS router_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS router_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS router_not_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text;

-- Before enforcing one active broadcast session per service, reconcile any
-- historical rows created before stream lifecycle authority existed. Keep the
-- strongest/newest active row and close every other active duplicate so this
-- additive migration cannot fail on legacy data.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY service_id
           ORDER BY
             CASE status
               WHEN 'live' THEN 0
               WHEN 'starting' THEN 1
               WHEN 'stopping' THEN 2
               ELSE 3
             END,
             created_at DESC,
             id DESC
         ) AS active_rank
  FROM stream_sessions
  WHERE status IN ('starting','live','stopping')
)
UPDATE stream_sessions ss
SET status='ended',
    ended_at=coalesce(ss.ended_at,now()),
    error_code=coalesce(ss.error_code,'migration_duplicate_active_session'),
    metrics=coalesce(ss.metrics,'{}'::jsonb) || jsonb_build_object(
      'migration',jsonb_build_object(
        'reconciledDuplicateActiveSession',true,
        'at',clock_timestamp()
      )
    ),
    updated_at=now()
FROM ranked r
WHERE ss.id=r.id
  AND r.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_sessions_one_active_service
  ON stream_sessions(service_id)
  WHERE status IN ('starting','live','stopping');

CREATE INDEX IF NOT EXISTS idx_stream_sessions_service_created
  ON stream_sessions(service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stream_session_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_session_id uuid NOT NULL REFERENCES stream_sessions(id) ON DELETE CASCADE,
  output_destination_id uuid NOT NULL REFERENCES output_destinations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','connecting','live','warning','error','ended','skipped')),
  last_error_code text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stream_session_id, output_destination_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_session_destinations_session_status
  ON stream_session_destinations(stream_session_id, status);

COMMIT;
