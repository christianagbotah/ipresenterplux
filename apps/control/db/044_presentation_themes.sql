BEGIN;

CREATE TABLE IF NOT EXISTS presentation_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  template_key text NOT NULL CHECK (length(btrim(template_key)) BETWEEN 1 AND 80),
  appearance jsonb NOT NULL CHECK (jsonb_typeof(appearance)='object'),
  is_builtin boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,organization_id),
  UNIQUE (organization_id,name)
);

CREATE INDEX IF NOT EXISTS idx_presentation_themes_org_updated
  ON presentation_themes(organization_id,is_builtin DESC,updated_at DESC,id);

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS active_theme_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='services_active_theme_scope_fk' AND conrelid='services'::regclass
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_active_theme_scope_fk
      FOREIGN KEY (active_theme_id,organization_id)
      REFERENCES presentation_themes(id,organization_id)
      ON DELETE SET NULL (active_theme_id);
  END IF;
END
$$;

WITH builtins(name,template_key,appearance) AS (
  VALUES
  ('Sunday Modern','sunday_modern','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#090d14,#121b2a)"},"primaryTextColor":"#ffffff","secondaryTextColor":"#e5b95e","fontFamily":"Inter","titleSizeScale":1,"bodySizeScale":1,"footerSizeScale":1,"horizontalAlignment":"center","verticalAlignment":"center","shadow":true,"backingOpacity":0.18,"safeAreaPercent":6,"animation":"fade","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Lower Third Scripture','lower_third_scripture','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#090d14,#121b2a)"},"primaryTextColor":"#ffffff","secondaryTextColor":"#e5b95e","fontFamily":"Inter","titleSizeScale":1,"bodySizeScale":0.9,"footerSizeScale":1,"horizontalAlignment":"center","verticalAlignment":"bottom","shadow":true,"backingOpacity":0.62,"safeAreaPercent":6,"animation":"fade","lowerThird":{"mode":"always","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Sermon Scripture','sermon_scripture','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#090d14,#121b2a)"},"primaryTextColor":"#ffffff","secondaryTextColor":"#e5b95e","fontFamily":"Inter","titleSizeScale":1,"bodySizeScale":1.18,"footerSizeScale":1,"horizontalAlignment":"center","verticalAlignment":"center","shadow":true,"backingOpacity":0.18,"safeAreaPercent":8,"animation":"fade","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Worship Lyrics','worship_lyrics','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#090d14,#121b2a)"},"primaryTextColor":"#ffffff","secondaryTextColor":"#dbeafe","fontFamily":"Inter","titleSizeScale":1,"bodySizeScale":1.3,"footerSizeScale":1,"horizontalAlignment":"center","verticalAlignment":"center","shadow":true,"backingOpacity":0.18,"safeAreaPercent":6,"animation":"slide","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Announcement','announcement','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#090d14,#121b2a)"},"primaryTextColor":"#ffffff","secondaryTextColor":"#e5b95e","fontFamily":"Inter","titleSizeScale":1.25,"bodySizeScale":0.9,"footerSizeScale":1,"horizontalAlignment":"left","verticalAlignment":"center","shadow":true,"backingOpacity":0.18,"safeAreaPercent":9,"animation":"fade","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Youth Service','youth_service','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#312e81,#7c3aed,#db2777)"},"primaryTextColor":"#ffffff","secondaryTextColor":"#fde047","fontFamily":"Inter","titleSizeScale":1,"bodySizeScale":1,"footerSizeScale":1,"horizontalAlignment":"center","verticalAlignment":"center","shadow":true,"backingOpacity":0.18,"safeAreaPercent":6,"animation":"zoom","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Conference','conference','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#07111f,#0f3d56)"},"primaryTextColor":"#ffffff","secondaryTextColor":"#67e8f9","fontFamily":"Inter","titleSizeScale":1,"bodySizeScale":1,"footerSizeScale":1,"horizontalAlignment":"left","verticalAlignment":"center","shadow":true,"backingOpacity":0.18,"safeAreaPercent":7,"animation":"fade","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Funeral','funeral','{"version":1,"background":{"kind":"solid","value":"#111827"},"primaryTextColor":"#ffffff","secondaryTextColor":"#d1d5db","fontFamily":"Inter","titleSizeScale":1,"bodySizeScale":1,"footerSizeScale":1,"horizontalAlignment":"center","verticalAlignment":"center","shadow":false,"backingOpacity":0.18,"safeAreaPercent":6,"animation":"fade","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb),
  ('Wedding','wedding','{"version":1,"background":{"kind":"gradient","value":"linear-gradient(135deg,#fff7ed,#fce7f3)"},"primaryTextColor":"#3f2d2d","secondaryTextColor":"#9f1239","fontFamily":"Georgia","titleSizeScale":1,"bodySizeScale":1,"footerSizeScale":1,"horizontalAlignment":"center","verticalAlignment":"center","shadow":false,"backingOpacity":0.18,"safeAreaPercent":6,"animation":"fade","lowerThird":{"mode":"auto","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}'::jsonb)
)
INSERT INTO presentation_themes (organization_id,name,template_key,appearance,is_builtin)
SELECT o.id,b.name,b.template_key,b.appearance,true
  FROM organizations o
  CROSS JOIN builtins b
ON CONFLICT (organization_id,name) DO NOTHING;

COMMIT;
