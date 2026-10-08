BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_sources_id_organization
  ON media_sources(id,organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_id_organization
  ON services(id,organization_id);

CREATE TABLE IF NOT EXISTS media_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('song','slide','media')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  planner_input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(planner_input)='object'),
  media_source_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,organization_id),
  CONSTRAINT media_library_source_scope_fk
    FOREIGN KEY (media_source_id,organization_id)
    REFERENCES media_sources(id,organization_id)
    ON DELETE SET NULL (media_source_id),
  CHECK ((item_type='media') = (media_source_id IS NOT NULL) OR item_type <> 'media')
);

CREATE INDEX IF NOT EXISTS idx_media_library_org_updated
  ON media_library_items(organization_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_media_library_org_type
  ON media_library_items(organization_id,item_type,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_library_source
  ON media_library_items(media_source_id)
  WHERE media_source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK (length(btrim(artifact_type)) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('pending','available','missing','expired','unavailable')),
  storage_kind text NOT NULL DEFAULT 'metadata_only'
    CHECK (storage_kind IN ('metadata_only','edge_local','external','control_managed')),
  storage_locator text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_artifacts_service_scope_fk
    FOREIGN KEY (service_id,organization_id)
    REFERENCES services(id,organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_artifacts_service
  ON service_artifacts(organization_id,service_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_artifacts_status
  ON service_artifacts(organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS camera_source_preferences (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  media_source_id uuid NOT NULL,
  operator_label text CHECK (operator_label IS NULL OR length(btrim(operator_label)) BETWEEN 1 AND 160),
  preferred boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,media_source_id),
  CONSTRAINT camera_source_preferences_scope_fk
    FOREIGN KEY (media_source_id,organization_id)
    REFERENCES media_sources(id,organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_camera_source_preferences_preferred
  ON camera_source_preferences(organization_id,preferred DESC,updated_at DESC);

COMMIT;
