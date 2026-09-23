BEGIN;

CREATE TABLE renter_billing_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  cycle_code text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'FINALIZED', 'CANCELLED')),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  finalized_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE RESTRICT,
  CHECK (period_end >= period_start),
  CHECK (due_date >= period_start),
  UNIQUE (organization_id, cycle_code),
  UNIQUE (organization_id, property_id, period_start, period_end),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, property_id, id)
);

CREATE INDEX renter_billing_cycles_property_period_idx
  ON renter_billing_cycles (
    organization_id,
    property_id,
    period_start DESC,
    period_end DESC,
    id
  );

CREATE TABLE renter_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  billing_cycle_id uuid NOT NULL,
  property_id uuid NOT NULL,
  room_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  invoice_number text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ISSUED', 'VOID')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_date date NOT NULL,
  property_name_snapshot text NOT NULL,
  room_code_snapshot text NOT NULL,
  lease_code_snapshot text NOT NULL,
  primary_resident_name_snapshot text NOT NULL,
  subtotal_vnd bigint NOT NULL DEFAULT 0 CHECK (subtotal_vnd >= 0),
  adjustment_vnd bigint NOT NULL DEFAULT 0,
  previous_balance_vnd bigint NOT NULL DEFAULT 0 CHECK (previous_balance_vnd >= 0),
  total_vnd bigint NOT NULL DEFAULT 0 CHECK (total_vnd >= 0),
  issued_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id, billing_cycle_id)
    REFERENCES renter_billing_cycles (organization_id, property_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, room_id)
    REFERENCES rooms (organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE RESTRICT,
  CHECK (period_end >= period_start),
  CHECK (due_date >= period_start),
  CHECK (total_vnd = subtotal_vnd + adjustment_vnd + previous_balance_vnd),
  UNIQUE (organization_id, invoice_number),
  UNIQUE (organization_id, billing_cycle_id, lease_id),
  UNIQUE (organization_id, id)
);

CREATE INDEX renter_invoices_cycle_idx
  ON renter_invoices (organization_id, billing_cycle_id, status, room_id, id);

CREATE INDEX renter_invoices_lease_history_idx
  ON renter_invoices (organization_id, lease_id, period_start DESC, id);

CREATE TABLE renter_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  line_type text NOT NULL
    CHECK (line_type IN (
      'RENT',
      'ELECTRICITY',
      'WATER',
      'SERVICE',
      'ADJUSTMENT',
      'PREVIOUS_DEBT'
    )),
  description text NOT NULL,
  quantity numeric(18, 3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price_vnd bigint NOT NULL DEFAULT 0,
  amount_vnd bigint NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES renter_invoices (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE INDEX renter_invoice_lines_invoice_idx
  ON renter_invoice_lines (organization_id, invoice_id, sort_order, id);

COMMIT;
