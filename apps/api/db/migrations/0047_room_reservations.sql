BEGIN;

CREATE TABLE room_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  room_id uuid NOT NULL,
  prospective_tenant_name text NOT NULL,
  prospective_tenant_phone text NOT NULL,
  prospective_tenant_id_number text,
  deposit_amount_vnd bigint NOT NULL CHECK (deposit_amount_vnd >= 0),
  reserved_from date NOT NULL DEFAULT current_date,
  reserved_until date NOT NULL,
  expected_move_in_date date,
  expected_monthly_rent_vnd bigint CHECK (expected_monthly_rent_vnd IS NULL OR expected_monthly_rent_vnd >= 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CONVERTED_TO_LEASE', 'CANCELLED_REFUNDED', 'CANCELLED_FORFEITED', 'EXPIRED')),
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, room_id)
    REFERENCES rooms (organization_id, id)
    ON DELETE CASCADE,
  CHECK (reserved_until >= reserved_from)
);

CREATE INDEX room_reservations_org_room_idx
  ON room_reservations (organization_id, room_id, status);

CREATE INDEX room_reservations_org_property_idx
  ON room_reservations (organization_id, property_id, status);

CREATE INDEX room_reservations_until_idx
  ON room_reservations (organization_id, reserved_until, status);

COMMIT;
