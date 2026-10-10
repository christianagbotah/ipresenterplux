BEGIN;

CREATE TABLE IF NOT EXISTS service_preparation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'sermon_notes'
    CHECK (note_type IN ('sermon_notes','service_notes','operator_notes')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 100000),
  source_label text CHECK (source_label IS NULL OR char_length(source_label) <= 240),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_preparation_notes_service_scope_fk
    FOREIGN KEY (service_id,organization_id)
    REFERENCES services(id,organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_preparation_notes_service
  ON service_preparation_notes(organization_id,service_id,updated_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS service_memories (
  service_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  source_fingerprint text CHECK (source_fingerprint IS NULL OR source_fingerprint ~ '^[0-9a-f]{64}$'),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 20000),
  key_scriptures jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(key_scriptures)='array'),
  speakers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(speakers)='array'),
  songs_media jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(songs_media)='array'),
  incidents jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(incidents)='array'),
  languages_outputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(languages_outputs)='object'),
  generator_version text NOT NULL DEFAULT 'deterministic-v1' CHECK (char_length(generator_version) BETWEEN 1 AND 80),
  generated_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_memories_service_scope_fk
    FOREIGN KEY (service_id,organization_id)
    REFERENCES services(id,organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_memories_org_generated
  ON service_memories(organization_id,generated_at DESC NULLS LAST,service_id);

CREATE TABLE IF NOT EXISTS service_memory_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000),
  started_at timestamptz,
  ended_at timestamptz,
  source_kind text NOT NULL DEFAULT 'mixed' CHECK (source_kind IN ('transcript','scripture','rundown','mixed')),
  confidence numeric(5,2) NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_memory_chapters_time_order CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),
  CONSTRAINT service_memory_chapters_service_scope_fk
    FOREIGN KEY (service_id,organization_id)
    REFERENCES services(id,organization_id) ON DELETE CASCADE,
  UNIQUE (service_id,ordinal)
);

CREATE INDEX IF NOT EXISTS idx_service_memory_chapters_service
  ON service_memory_chapters(organization_id,service_id,ordinal);

COMMIT;
