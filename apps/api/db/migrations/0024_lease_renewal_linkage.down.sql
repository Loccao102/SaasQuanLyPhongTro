BEGIN;

DROP INDEX IF EXISTS leases_renewed_from_idx;

ALTER TABLE leases
  DROP CONSTRAINT IF EXISTS leases_renewed_from_fk,
  DROP COLUMN IF EXISTS renewed_from_lease_id;

COMMIT;
