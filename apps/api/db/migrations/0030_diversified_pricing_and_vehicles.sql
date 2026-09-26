-- Migration: 0030_diversified_pricing_and_vehicles.sql
-- Description: Expand pricing items (WATER_PER_PERSON, WATER_PER_ROOM, VEHICLE_PARKING, SERVICE_PER_PERSON),
--              add lease_vehicles management, and renter_invoice_adjustments for discounts/surcharges.

ALTER TABLE pricing_policy_items
  DROP CONSTRAINT IF EXISTS pricing_policy_items_item_type_check;

ALTER TABLE pricing_policy_items
  ADD CONSTRAINT pricing_policy_items_item_type_check
  CHECK (item_type IN (
    'ELECTRICITY_PER_KWH',
    'WATER_PER_M3',
    'WATER_PER_PERSON',
    'WATER_PER_ROOM',
    'VEHICLE_PARKING',
    'SERVICE_PER_PERSON',
    'INTERNET',
    'PARKING',
    'TRASH',
    'CUSTOM'
  ));

CREATE TABLE IF NOT EXISTS lease_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  vehicle_type text NOT NULL DEFAULT 'MOTORBIKE'
    CHECK (vehicle_type IN ('MOTORBIKE', 'ELECTRIC_BIKE', 'BICYCLE', 'CAR', 'OTHER')),
  license_plate text NOT NULL,
  brand_model text,
  owner_name text,
  is_active boolean NOT NULL DEFAULT true,
  registered_at date NOT NULL DEFAULT CURRENT_DATE,
  unregistered_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lease_vehicles_org_lease_idx
  ON lease_vehicles (organization_id, lease_id, is_active, registered_at);

CREATE TABLE IF NOT EXISTS renter_invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  adjustment_type text NOT NULL
    CHECK (adjustment_type IN ('DISCOUNT', 'SURCHARGE', 'COMPENSATION', 'OTHER')),
  description text NOT NULL,
  amount_vnd bigint NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES renter_invoices (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS renter_invoice_adjustments_org_invoice_idx
  ON renter_invoice_adjustments (organization_id, invoice_id, created_at);
