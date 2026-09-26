BEGIN;

CREATE TABLE room_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  room_id uuid NOT NULL,
  name text NOT NULL,
  brand text,
  model_or_serial text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  condition_status text NOT NULL DEFAULT 'GOOD'
    CHECK (condition_status IN ('EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'NEEDS_REPAIR')),
  compensation_value_vnd bigint NOT NULL DEFAULT 0 CHECK (compensation_value_vnd >= 0),
  note text,
  installed_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, room_id)
    REFERENCES rooms (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX room_equipment_room_idx
  ON room_equipment (organization_id, room_id, created_at DESC);

CREATE INDEX room_equipment_property_idx
  ON room_equipment (organization_id, property_id, name);

COMMIT;
