BEGIN;

ALTER TABLE leases
  ADD COLUMN renewed_from_lease_id uuid;

ALTER TABLE leases
  ADD CONSTRAINT leases_renewed_from_fk
    FOREIGN KEY (organization_id, renewed_from_lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE SET NULL;

CREATE INDEX leases_renewed_from_idx
  ON leases (organization_id, renewed_from_lease_id)
  WHERE renewed_from_lease_id IS NOT NULL;

COMMIT;
