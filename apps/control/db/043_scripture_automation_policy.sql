BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS auto_scripture_live_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS scripture_automation_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS auto_scripture_reference_threshold numeric(5,2) NOT NULL DEFAULT 98.00,
  ADD COLUMN IF NOT EXISTS auto_scripture_quote_threshold numeric(5,2) NOT NULL DEFAULT 96.00,
  ADD COLUMN IF NOT EXISTS scripture_automation_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS scripture_automation_armed_by uuid,
  ADD COLUMN IF NOT EXISTS scripture_automation_suspended_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='services_scripture_automation_mode_check' AND conrelid='services'::regclass) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_scripture_automation_mode_check
      CHECK (scripture_automation_mode IN ('manual','auto_preview','auto_live'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='services_auto_scripture_reference_threshold_check' AND conrelid='services'::regclass) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_auto_scripture_reference_threshold_check
      CHECK (auto_scripture_reference_threshold >= 98.00 AND auto_scripture_reference_threshold <= 100.00);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='services_auto_scripture_quote_threshold_check' AND conrelid='services'::regclass) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_auto_scripture_quote_threshold_check
      CHECK (auto_scripture_quote_threshold >= 96.00 AND auto_scripture_quote_threshold <= 100.00);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='services_scripture_automation_armed_by_fkey' AND conrelid='services'::regclass) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_scripture_automation_armed_by_fkey
      FOREIGN KEY (scripture_automation_armed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMIT;
