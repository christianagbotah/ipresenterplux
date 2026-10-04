BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  country_code varchar(2) NOT NULL DEFAULT 'GH',
  timezone text NOT NULL DEFAULT 'Africa/Accra',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  city text,
  country_code varchar(2) NOT NULL DEFAULT 'GH',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL,
  title text NOT NULL,
  service_type text NOT NULL DEFAULT 'sunday_service',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','live','ended','archived')),
  scheduled_start timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  active_bible_version text NOT NULL DEFAULT 'KJV',
  auto_preview_threshold numeric(5,2) NOT NULL DEFAULT 90.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_type text NOT NULL
    CHECK (item_type IN ('scripture','song','slide','media','announcement','lower_third','camera','custom')),
  title text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','preview','live','played','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scripture_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  scripture_reference text NOT NULL,
  book text NOT NULL,
  chapter integer NOT NULL,
  verse_start integer,
  verse_end integer,
  bible_version text NOT NULL DEFAULT 'KJV',
  source_text text,
  confidence numeric(5,2) NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'detected'
    CHECK (state IN ('detected','preview','live','dismissed')),
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS output_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  destination_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected','ready','connecting','live','warning','error')),
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS language_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  language_name text NOT NULL,
  channel_mode text NOT NULL
    CHECK (channel_mode IN ('original','captions','translation_text','translation_audio')),
  enabled boolean NOT NULL DEFAULT true,
  listener_count integer NOT NULL DEFAULT 0,
  voice_profile text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, language_code, channel_mode)
);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  integration_type text NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','configured','connected','warning','error')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE TABLE IF NOT EXISTS stream_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','starting','live','stopping','ended','error')),
  video_profile text NOT NULL DEFAULT '1080p30',
  started_at timestamptz,
  ended_at timestamptz,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'offline'
    CHECK (status IN ('offline','ready','live','warning','error')),
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_org_status ON services(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_scripture_detections_service_time ON scripture_detections(service_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_presentation_items_service_sort ON presentation_items(service_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_time ON audit_events(organization_id, created_at DESC);

INSERT INTO organizations (id, name, slug, country_code, timezone)
VALUES ('00000000-0000-4000-8000-000000000001', 'iPresenterPlux Demo Church', 'demo-church', 'GH', 'Africa/Accra')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO campuses (id, organization_id, name, slug, city, country_code)
VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Main Auditorium', 'main-auditorium', 'Accra', 'GH')
ON CONFLICT (organization_id, slug) DO NOTHING;

INSERT INTO services (id, organization_id, campus_id, title, service_type, status, active_bible_version)
VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Sunday Worship Service', 'sunday_service', 'ready', 'KJV')
ON CONFLICT (id) DO NOTHING;

INSERT INTO output_destinations (organization_id, name, destination_type, enabled, status, public_config)
VALUES
('00000000-0000-4000-8000-000000000001','YouTube Live','youtube',false,'disconnected','{"protocol":"RTMPS"}'),
('00000000-0000-4000-8000-000000000001','Facebook Live','facebook',false,'disconnected','{"protocol":"RTMPS"}'),
('00000000-0000-4000-8000-000000000001','TikTok LIVE','tiktok',false,'disconnected','{"protocol":"RTMPS"}'),
('00000000-0000-4000-8000-000000000001','Church Web','web_webrtc',true,'ready','{"protocol":"WebRTC"}'),
('00000000-0000-4000-8000-000000000001','NDI Program','ndi',true,'ready','{"format":"1080p30"}')
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO language_channels (organization_id, language_code, language_name, channel_mode, enabled)
VALUES
('00000000-0000-4000-8000-000000000001','en','English · Original','original',true),
('00000000-0000-4000-8000-000000000001','en','English · Captions','captions',true),
('00000000-0000-4000-8000-000000000001','fr','French','translation_audio',true),
('00000000-0000-4000-8000-000000000001','ak','Twi / Akan','translation_text',true),
('00000000-0000-4000-8000-000000000001','ee','Ewe','translation_text',true),
('00000000-0000-4000-8000-000000000001','gaa','Ga','translation_text',true)
ON CONFLICT (organization_id, language_code, channel_mode) DO NOTHING;

INSERT INTO integrations (organization_id, provider, integration_type, status, capabilities)
VALUES
('00000000-0000-4000-8000-000000000001','EasyWorship','presentation','planned','["preview","program_feed"]'),
('00000000-0000-4000-8000-000000000001','OBS / vMix','broadcast','planned','["ndi","rtmp","srt"]'),
('00000000-0000-4000-8000-000000000001','ProPresenter','presentation','planned','["ndi","program_feed"]'),
('00000000-0000-4000-8000-000000000001','NDI','media_transport','configured','["video_in","video_out","alpha_graphics"]')
ON CONFLICT (organization_id, provider) DO NOTHING;

INSERT INTO audit_events (organization_id, action, entity_type, entity_id, details)
SELECT '00000000-0000-4000-8000-000000000001', 'platform.foundation.created', 'organization',
       '00000000-0000-4000-8000-000000000001', '{"version":"0.1.0"}'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_events
  WHERE action='platform.foundation.created'
    AND entity_id='00000000-0000-4000-8000-000000000001'
);

COMMIT;
