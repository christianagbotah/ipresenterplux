BEGIN;

CREATE TABLE IF NOT EXISTS portable_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  source_kind text NOT NULL
    CHECK (source_kind IN ('song_text','song_csv','service_rundown_json','media_url_manifest')),
  source_name text NOT NULL CHECK (length(btrim(source_name)) BETWEEN 1 AND 240),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  duplicate_policy text NOT NULL DEFAULT 'skip'
    CHECK (duplicate_policy IN ('skip','import_copy')),
  status text NOT NULL DEFAULT 'committed'
    CHECK (status IN ('committed','undo_blocked','undone')),
  preview_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preview_summary)='object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance)='object'),
  committed_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,organization_id)
);

CREATE INDEX IF NOT EXISTS idx_portable_import_batches_org_created
  ON portable_import_batches(organization_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_portable_import_batches_org_fingerprint
  ON portable_import_batches(organization_id,source_fingerprint,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_portable_import_batches_status
  ON portable_import_batches(organization_id,status,updated_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS portable_import_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  target_type text NOT NULL CHECK (length(btrim(target_type)) BETWEEN 1 AND 64),
  candidate_fingerprint text NOT NULL CHECK (candidate_fingerprint ~ '^[a-f0-9]{64}$'),
  disposition text NOT NULL
    CHECK (disposition IN ('created','skipped_duplicate','rejected','undone')),
  entity_type text,
  entity_id text,
  entity_updated_at_snapshot timestamptz,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  CONSTRAINT portable_import_batch_items_batch_scope_fk
    FOREIGN KEY (batch_id,organization_id)
    REFERENCES portable_import_batches(id,organization_id) ON DELETE CASCADE,
  UNIQUE (batch_id,ordinal)
);

CREATE INDEX IF NOT EXISTS idx_portable_import_batch_items_batch
  ON portable_import_batch_items(organization_id,batch_id,ordinal,id);
CREATE INDEX IF NOT EXISTS idx_portable_import_batch_items_entity
  ON portable_import_batch_items(organization_id,entity_type,entity_id)
  WHERE entity_id IS NOT NULL;

COMMIT;
