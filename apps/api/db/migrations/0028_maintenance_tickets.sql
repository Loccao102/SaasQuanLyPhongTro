BEGIN;

CREATE TABLE maintenance_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  room_id uuid,
  lease_id uuid,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'OTHER'
    CHECK (category IN ('ELECTRICITY', 'PLUMBING', 'APPLIANCE', 'STRUCTURAL', 'INTERNET', 'OTHER')),
  priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED')),
  description text NOT NULL,
  resident_name text NOT NULL,
  resident_phone text,
  images text[] NOT NULL DEFAULT '{}',
  reported_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text,
  repair_cost_vnd bigint NOT NULL DEFAULT 0 CHECK (repair_cost_vnd >= 0),
  linked_expense_id uuid REFERENCES operating_expenses(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, room_id)
    REFERENCES rooms (organization_id, id)
    ON DELETE SET NULL,
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE SET NULL
);

CREATE INDEX maintenance_tickets_org_status_idx
  ON maintenance_tickets (organization_id, status, reported_at DESC);

CREATE INDEX maintenance_tickets_property_idx
  ON maintenance_tickets (organization_id, property_id, reported_at DESC);

CREATE INDEX maintenance_tickets_room_idx
  ON maintenance_tickets (organization_id, room_id, reported_at DESC);

COMMIT;
