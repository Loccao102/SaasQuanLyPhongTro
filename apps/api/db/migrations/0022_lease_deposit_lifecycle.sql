BEGIN;

CREATE TABLE lease_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'HELD'
    CHECK (status IN ('HELD', 'PARTIALLY_SETTLED', 'SETTLED')),
  deposit_required_vnd bigint NOT NULL DEFAULT 0 CHECK (deposit_required_vnd >= 0),
  total_collected_vnd bigint NOT NULL DEFAULT 0 CHECK (total_collected_vnd >= 0),
  total_deducted_vnd bigint NOT NULL DEFAULT 0 CHECK (total_deducted_vnd >= 0),
  total_refunded_vnd bigint NOT NULL DEFAULT 0 CHECK (total_refunded_vnd >= 0),
  remaining_held_vnd bigint NOT NULL DEFAULT 0 CHECK (remaining_held_vnd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, lease_id),
  UNIQUE (organization_id, id)
);

CREATE INDEX lease_deposits_org_status_idx
  ON lease_deposits (organization_id, status, updated_at DESC);

CREATE TABLE lease_deposit_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  movement_type text NOT NULL
    CHECK (movement_type IN ('COLLECTION', 'DEDUCTION', 'REFUND', 'FORFEITURE')),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER'
    CHECK (payment_method IN ('BANK_TRANSFER', 'CASH', 'OTHER')),
  reference text,
  notes text,
  occurred_at date NOT NULL DEFAULT CURRENT_DATE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE INDEX lease_deposit_movements_org_lease_idx
  ON lease_deposit_movements (organization_id, lease_id, occurred_at DESC, created_at DESC);

COMMIT;
