BEGIN;

CREATE TABLE pricing_policies (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, property_id, effective_from)
);

CREATE INDEX pricing_policies_property_effective_idx
  ON pricing_policies (
    organization_id,
    property_id,
    effective_from DESC,
    effective_to,
    id
  );

CREATE TABLE pricing_policy_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  item_type text NOT NULL
    CHECK (item_type IN (
      'ELECTRICITY_PER_KWH',
      'WATER_PER_M3',
      'INTERNET',
      'PARKING',
      'TRASH',
      'CUSTOM'
    )),
  description text NOT NULL,
  unit_price_vnd bigint NOT NULL CHECK (unit_price_vnd >= 0),
  fixed_quantity numeric(18, 3) NOT NULL DEFAULT 1 CHECK (fixed_quantity >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, policy_id)
    REFERENCES pricing_policies (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE INDEX pricing_policy_items_policy_idx
  ON pricing_policy_items (organization_id, policy_id, sort_order, id);

CREATE TABLE meters (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  room_id uuid NOT NULL,
  meter_type text NOT NULL CHECK (meter_type IN ('ELECTRICITY', 'WATER')),
  unit text NOT NULL CHECK (unit IN ('KWH', 'M3')),
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, room_id)
    REFERENCES rooms (organization_id, id)
    ON DELETE RESTRICT,
  CHECK (
    (meter_type = 'ELECTRICITY' AND unit = 'KWH')
    OR (meter_type = 'WATER' AND unit = 'M3')
  ),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX meters_one_active_type_per_room_idx
  ON meters (organization_id, room_id, meter_type)
  WHERE is_active = true;

CREATE INDEX meters_room_idx
  ON meters (organization_id, room_id, meter_type, is_active, id);

CREATE TABLE meter_readings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  meter_id uuid NOT NULL,
  reading_date date NOT NULL,
  reading_value numeric(18, 3) NOT NULL CHECK (reading_value >= 0),
  source text NOT NULL DEFAULT 'ADMIN'
    CHECK (source IN ('ADMIN', 'STAFF', 'IMPORT')),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, meter_id)
    REFERENCES meters (organization_id, id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, meter_id, reading_date)
);

CREATE INDEX meter_readings_meter_date_idx
  ON meter_readings (
    organization_id,
    meter_id,
    reading_date DESC,
    id
  );

ALTER TABLE renter_invoices
  ADD COLUMN calculation_status text NOT NULL DEFAULT 'READY'
    CHECK (calculation_status IN ('READY', 'REVIEW_REQUIRED')),
  ADD COLUMN review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(review_reasons) = 'array'),
  ADD COLUMN calculated_at timestamptz;

CREATE INDEX renter_invoices_calculation_status_idx
  ON renter_invoices (
    organization_id,
    billing_cycle_id,
    calculation_status,
    status,
    id
  );

COMMIT;
