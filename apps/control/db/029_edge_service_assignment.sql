BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='services_id_organization_unique'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_id_organization_unique
      UNIQUE (id, organization_id);
  END IF;
END $$;

ALTER TABLE edge_devices
  ADD COLUMN IF NOT EXISTS active_service_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='edge_devices_active_service_scope_fk'
  ) THEN
    ALTER TABLE edge_devices
      ADD CONSTRAINT edge_devices_active_service_scope_fk
      FOREIGN KEY (active_service_id, organization_id)
      REFERENCES services(id, organization_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_edge_devices_active_service
  ON edge_devices(active_service_id)
  WHERE active_service_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_one_live_per_campus
  ON services(organization_id, campus_id)
  WHERE status='live' AND campus_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_one_live_without_campus
  ON services(organization_id)
  WHERE status='live' AND campus_id IS NULL;

WITH best AS (
  SELECT d.id,
         (
           SELECT s.id
           FROM services s
           WHERE s.organization_id=d.organization_id
             AND s.campus_id IS NOT DISTINCT FROM d.campus_id
             AND s.status IN ('live','ready')
           ORDER BY CASE s.status WHEN 'live' THEN 0 ELSE 1 END,
                    s.updated_at DESC,
                    s.id DESC
           LIMIT 1
         ) AS service_id
  FROM edge_devices d
  WHERE d.status='active' AND d.active_service_id IS NULL
)
UPDATE edge_devices d
SET active_service_id=best.service_id,
    updated_at=clock_timestamp()
FROM best
WHERE d.id=best.id AND best.service_id IS NOT NULL;

COMMIT;
